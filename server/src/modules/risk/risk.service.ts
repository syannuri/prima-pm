import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { recomputeBaseline } from '../cost/cost.service.js';
import { enqueueWebhookEvent } from '../webhook/webhook.service.js';
import {
  deriveRiskMetrics,
  generateRiskCode,
  buildHeatmap,
  summarizeRisks,
} from './risk.helpers.js';
import type { UpsertRiskInput } from './risk.schemas.js';

const dec = (v: Prisma.Decimal | number | null | undefined): number =>
  v == null ? 0 : Number(v);

// Risk register requires a committed charter (project past DRAFT).
async function ensureChartered(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true },
  });
  if (!project) throw NotFound('Project not found');
  if (project.status === 'DRAFT') {
    throw BadRequest('Commit the Project Charter before registering risks');
  }
}

function buildRiskData(input: UpsertRiskInput) {
  const metrics = deriveRiskMetrics({
    probabilityScore: input.probabilityScore,
    impactScore: input.impactScore,
    probabilityPct: input.probabilityPct,
    impactCostIdr: input.impactCostIdr,
    kind: input.kind,
    residualProbabilityPct: input.residualProbabilityPct ?? null,
    residualImpactCost: input.residualImpactCost ?? null,
  });

  return {
    title: input.title,
    description: input.description ?? null,
    category: input.category ?? null,
    kind: input.kind,
    status: input.status,
    ownerUserId: input.ownerUserId ?? null,
    probabilityScore: input.probabilityScore,
    impactScore: input.impactScore,
    riskScore: metrics.riskScore,
    severity: metrics.severity,
    probabilityPct: input.probabilityPct,
    impactCostIdr: input.impactCostIdr,
    emv: metrics.emv,
    responseStrategy: input.responseStrategy ?? null,
    responseCost: input.responseCost ?? null,
    residualEmv: metrics.residualEmv,
    includeInReserve: input.includeInReserve,
  };
}

export async function listRisks(projectId: string) {
  return prisma.risk.findMany({ where: { projectId }, orderBy: { code: 'asc' } });
}

export async function createRisk(projectId: string, input: UpsertRiskInput, actorId: string) {
  await ensureChartered(projectId);

  // Risks change the Contingency Reserve -> refresh the cost baseline in the
  // same transaction so the risk and the baseline can never diverge on failure.
  const risk = await prisma.$transaction(async (tx) => {
    const count = await tx.risk.count({ where: { projectId } });
    const code = generateRiskCode(count + 1);
    const created = await tx.risk.create({
      data: { ...buildRiskData(input), projectId, code },
    });
    await recomputeBaseline(projectId, tx);
    return created;
  });

  await writeAudit({ projectId, userId: actorId, entity: 'Risk', entityId: risk.id, action: 'CREATE', after: risk });
  await enqueueWebhookEvent('risk.created', { projectId, riskId: risk.id, code: risk.code, title: risk.title, severity: risk.severity });
  return risk;
}

export async function updateRisk(
  projectId: string,
  riskId: string,
  input: UpsertRiskInput,
  actorId: string,
) {
  const existing = await prisma.risk.findFirst({ where: { id: riskId, projectId } });
  if (!existing) throw NotFound('Risk not found');

  // The raw residual P%/cost aren't persisted (only residualEmv), so the edit form can't prefill
  // them. When the caller omits the residual pair, KEEP the existing residualEmv instead of nulling
  // it — otherwise editing just the Status/Response would silently wipe the residual and shift the
  // contingency reserve. To change residual, the form sends a fresh pair (buildRiskData recomputes).
  const keepResidual = input.residualProbabilityPct == null && input.residualImpactCost == null;
  const risk = await prisma.$transaction(async (tx) => {
    const updated = await tx.risk.update({
      where: { id: riskId },
      data: { ...buildRiskData(input), ...(keepResidual ? { residualEmv: existing.residualEmv } : {}) },
    });
    await recomputeBaseline(projectId, tx);
    return updated;
  });
  await writeAudit({ projectId, userId: actorId, entity: 'Risk', entityId: riskId, action: 'UPDATE', before: existing, after: risk });
  return risk;
}

export async function deleteRisk(projectId: string, riskId: string, actorId: string) {
  const existing = await prisma.risk.findFirst({ where: { id: riskId, projectId } });
  if (!existing) throw NotFound('Risk not found');
  await prisma.$transaction(async (tx) => {
    await tx.risk.delete({ where: { id: riskId } });
    await recomputeBaseline(projectId, tx);
  });
  await writeAudit({ projectId, userId: actorId, entity: 'Risk', entityId: riskId, action: 'DELETE', before: existing });
}

// Dashboard payload: heatmap (5x5), severity counts, EMV ranking, reserve.
export async function getRiskAnalysis(projectId: string) {
  const risks = await prisma.risk.findMany({ where: { projectId } });

  const heatmap = buildHeatmap(
    risks.map((r) => ({ probabilityScore: r.probabilityScore, impactScore: r.impactScore })),
  );

  const summary = summarizeRisks(
    risks.map((r) => ({
      id: r.id,
      code: r.code,
      title: r.title,
      severity: r.severity,
      kind: r.kind,
      emv: dec(r.emv),
      residualEmv: r.residualEmv == null ? null : dec(r.residualEmv),
      includeInReserve: r.includeInReserve,
    })),
  );

  return { heatmap, ...summary };
}
