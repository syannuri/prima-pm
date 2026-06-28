import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { recomputeBaseline } from '../cost/cost.service.js';
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

  const risk = await prisma.$transaction(async (tx) => {
    const count = await tx.risk.count({ where: { projectId } });
    const code = generateRiskCode(count + 1);
    return tx.risk.create({
      data: { ...buildRiskData(input), projectId, code },
    });
  });

  // Risks change the Contingency Reserve -> refresh the cost baseline.
  await recomputeBaseline(projectId);
  await writeAudit({ projectId, userId: actorId, entity: 'Risk', entityId: risk.id, action: 'CREATE', after: risk });
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

  const risk = await prisma.risk.update({
    where: { id: riskId },
    data: buildRiskData(input),
  });
  await recomputeBaseline(projectId);
  await writeAudit({ projectId, userId: actorId, entity: 'Risk', entityId: riskId, action: 'UPDATE', before: existing, after: risk });
  return risk;
}

export async function deleteRisk(projectId: string, riskId: string, actorId: string) {
  const existing = await prisma.risk.findFirst({ where: { id: riskId, projectId } });
  if (!existing) throw NotFound('Risk not found');
  await prisma.risk.delete({ where: { id: riskId } });
  await recomputeBaseline(projectId);
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
