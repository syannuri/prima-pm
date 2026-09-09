import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequest, NotFound, Conflict, Forbidden } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { createProject } from '../projects/projects.service.js';
import { assignProject } from '../program/program.service.js';
import type { UpsertProposalInput, ScoreInput, DecisionInput, WeightsInput } from './intake.schemas.js';

// ── Scoring ───────────────────────────────────────────────────────────────────────────────────
// Five 1..5 criteria. Strategic / value / urgency are benefit-type (higher = better); risk & cost are
// cost-type (higher raw = worse) and are inverted (6 − score) so a higher weighted TOTAL is always
// better. Weights are per-tenant (Tenant.intakeWeights JSON) with a balanced default.
export type Weights = { strategic: number; value: number; risk: number; cost: number; urgency: number };
export const DEFAULT_WEIGHTS: Weights = { strategic: 3, value: 3, risk: 2, cost: 2, urgency: 1 };

export async function getWeights(): Promise<Weights> {
  const tenantId = getTenantStore()?.tenantId;
  if (!tenantId) return { ...DEFAULT_WEIGHTS };
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { intakeWeights: true } });
  const w = t?.intakeWeights as Partial<Weights> | null | undefined;
  if (!w) return { ...DEFAULT_WEIGHTS };
  return {
    strategic: num(w.strategic, DEFAULT_WEIGHTS.strategic),
    value: num(w.value, DEFAULT_WEIGHTS.value),
    risk: num(w.risk, DEFAULT_WEIGHTS.risk),
    cost: num(w.cost, DEFAULT_WEIGHTS.cost),
    urgency: num(w.urgency, DEFAULT_WEIGHTS.urgency),
  };
}
const num = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) ? v : d);

// The requester owns their idea; ADMIN/PMO may manage any proposal.
const PMO: Role[] = ['ADMIN', 'PMO'];
function ownGuard(before: { requestedByUserId: string | null }, actorId: string, role: Role) {
  if (PMO.includes(role) || before.requestedByUserId === actorId) return;
  throw Forbidden('You can only edit proposals you submitted');
}

type Scores = { scoreStrategic?: number | null; scoreValue?: number | null; scoreRisk?: number | null; scoreCost?: number | null; scoreUrgency?: number | null };
// Weighted total across whatever criteria have been scored (null while none are). Cost-type inverted.
export function weightedScore(s: Scores, w: Weights): number | null {
  const parts: number[] = [];
  if (s.scoreStrategic != null) parts.push(w.strategic * s.scoreStrategic);
  if (s.scoreValue != null) parts.push(w.value * s.scoreValue);
  if (s.scoreUrgency != null) parts.push(w.urgency * s.scoreUrgency);
  if (s.scoreRisk != null) parts.push(w.risk * (6 - s.scoreRisk));
  if (s.scoreCost != null) parts.push(w.cost * (6 - s.scoreCost));
  if (!parts.length) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
}

export async function setWeights(input: WeightsInput, actorId: string): Promise<Weights> {
  const tenantId = getTenantStore()?.tenantId;
  const before = await getWeights();
  if (tenantId) {
    await prisma.tenant.update({ where: { id: tenantId }, data: { intakeWeights: input } });
    // Existing proposals keep their scores but their weighted totals must reflect the new weights.
    const rows = await prisma.proposal.findMany({ select: { id: true, scoreStrategic: true, scoreValue: true, scoreRisk: true, scoreCost: true, scoreUrgency: true } });
    for (const r of rows) {
      await prisma.proposal.update({ where: { id: r.id }, data: { weightedScore: weightedScore(r, input) } });
    }
  }
  await writeAudit({ userId: actorId, entity: 'AppSetting', entityId: 'intakeWeights', action: 'UPDATE', before, after: input });
  return { ...input };
}

// ── Codes ─────────────────────────────────────────────────────────────────────────────────────
function nextCode(existing: string[], year: number): string {
  let max = 0;
  const re = new RegExp(`^INT-${year}-(\\d+)$`);
  for (const c of existing) { const m = re.exec(c); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `INT-${year}-${String(max + 1).padStart(4, '0')}`;
}

// ── CRUD + lifecycle ────────────────────────────────────────────────────────────────────────────
export async function listProposals(filters: { status?: string; includeArchived?: boolean } = {}) {
  const where: Record<string, unknown> = {};
  if (!filters.includeArchived) where.archivedAt = null;
  if (filters.status) where.status = filters.status;
  return prisma.proposal.findMany({
    where,
    orderBy: [{ priorityRank: 'asc' }, { weightedScore: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getProposal(id: string) {
  const p = await prisma.proposal.findFirst({ where: { id } });
  if (!p) throw NotFound('Proposal not found');
  return p;
}

export async function createProposal(input: UpsertProposalInput, actorId: string) {
  const year = new Date().getFullYear();
  for (let attempt = 0; ; attempt++) {
    try {
      const existing = await prisma.proposal.findMany({ where: { code: { startsWith: `INT-${year}-` } }, select: { code: true } });
      const code = nextCode(existing.map((e) => e.code), year);
      const p = await prisma.proposal.create({ data: { ...toData(input), code, requestedByUserId: actorId, status: 'DRAFT' } });
      await writeAudit({ userId: actorId, entity: 'Proposal', entityId: p.id, action: 'CREATE', after: p });
      return p;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002' && attempt < 4) continue; // code race
      throw err;
    }
  }
}

export async function updateProposal(id: string, input: UpsertProposalInput, actorId: string, role: Role) {
  const before = await getProposal(id);
  ownGuard(before, actorId, role);
  if (before.status === 'CONVERTED') throw BadRequest('A converted proposal can no longer be edited');
  const p = await prisma.proposal.update({ where: { id }, data: toData(input) });
  await writeAudit({ userId: actorId, entity: 'Proposal', entityId: id, action: 'UPDATE', before, after: p });
  return p;
}

// Submit a DRAFT (or resubmit a DEFERRED) for review.
export async function submitProposal(id: string, actorId: string, role: Role) {
  const before = await getProposal(id);
  ownGuard(before, actorId, role);
  if (!['DRAFT', 'DEFERRED'].includes(before.status)) throw BadRequest(`Cannot submit a ${before.status.toLowerCase()} proposal`);
  const p = await prisma.proposal.update({ where: { id }, data: { status: 'SUBMITTED' } });
  await writeAudit({ userId: actorId, entity: 'Proposal', entityId: id, action: 'UPDATE', before, after: p });
  return p;
}

// PMO scoring. Moves SUBMITTED → UNDER_REVIEW and recomputes the weighted total.
export async function scoreProposal(id: string, input: ScoreInput, actorId: string) {
  const before = await getProposal(id);
  if (before.status === 'CONVERTED') throw BadRequest('A converted proposal can no longer be scored');
  const merged: Scores = {
    scoreStrategic: input.scoreStrategic !== undefined ? input.scoreStrategic : before.scoreStrategic,
    scoreValue: input.scoreValue !== undefined ? input.scoreValue : before.scoreValue,
    scoreRisk: input.scoreRisk !== undefined ? input.scoreRisk : before.scoreRisk,
    scoreCost: input.scoreCost !== undefined ? input.scoreCost : before.scoreCost,
    scoreUrgency: input.scoreUrgency !== undefined ? input.scoreUrgency : before.scoreUrgency,
  };
  const w = await getWeights();
  const status = before.status === 'SUBMITTED' ? 'UNDER_REVIEW' : before.status;
  const p = await prisma.proposal.update({ where: { id }, data: { ...merged, weightedScore: weightedScore(merged, w), status } });
  await writeAudit({ userId: actorId, entity: 'Proposal', entityId: id, action: 'UPDATE', before, after: p });
  return p;
}

// PMO decision: approve / reject / defer.
export async function decideProposal(id: string, input: DecisionInput, actorId: string) {
  const before = await getProposal(id);
  if (before.status === 'CONVERTED') throw BadRequest('A converted proposal is already realised');
  const status = input.decision === 'APPROVE' ? 'APPROVED' : input.decision === 'REJECT' ? 'REJECTED' : 'DEFERRED';
  const p = await prisma.proposal.update({
    where: { id },
    data: { status, reviewedByUserId: actorId, decidedAt: new Date(), decisionNote: input.note?.trim() || null },
  });
  await writeAudit({ userId: actorId, entity: 'Proposal', entityId: id, action: 'UPDATE', before, after: p });
  return p;
}

// Convert an APPROVED proposal into a real Project (DRAFT), carrying its fields over. One-shot.
export async function convertProposal(id: string, pmUserId: string | null | undefined, actorId: string, actorRole: Role) {
  const p = await getProposal(id);
  if (p.convertedProjectId || p.status === 'CONVERTED') throw Conflict('This proposal has already been converted');
  if (p.status !== 'APPROVED') throw BadRequest('Only an approved proposal can be converted');
  const project = await createProject(
    {
      name: p.title,
      sponsor: p.sponsor ?? undefined,
      clientName: p.clientName ?? undefined,
      category: (p.category ?? undefined) as never,
      categoryOther: p.categoryOther ?? undefined,
      deliveryApproach: (p.deliveryApproach ?? undefined) as never,
      costBaselineIdr: p.estCostIdr != null ? Number(p.estCostIdr) : undefined,
      totalRevenueIdr: p.estRevenueIdr != null ? Number(p.estRevenueIdr) : undefined,
      pmUserId: pmUserId ?? undefined,
    } as never,
    actorId,
    actorRole,
  );
  if (p.programId) { try { await assignProject(p.programId, project.id); } catch { /* program may be gone — non-fatal */ } }
  const updated = await prisma.proposal.update({ where: { id }, data: { status: 'CONVERTED', convertedProjectId: project.id, convertedAt: new Date() } });
  await writeAudit({ userId: actorId, entity: 'Proposal', entityId: id, action: 'UPDATE', before: p, after: updated });
  return { proposal: updated, project };
}

export async function setRank(order: string[], actorId: string) {
  await prisma.$transaction(order.map((id, i) => prisma.proposal.update({ where: { id }, data: { priorityRank: i + 1 } })));
  await writeAudit({ userId: actorId, entity: 'Proposal', entityId: 'rank', action: 'UPDATE', after: { order } });
}

export async function archiveProposal(id: string, archived: boolean, actorId: string) {
  const before = await getProposal(id);
  const p = await prisma.proposal.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
  await writeAudit({ userId: actorId, entity: 'Proposal', entityId: id, action: 'UPDATE', before, after: p });
  return p;
}

export async function deleteProposal(id: string, actorId: string, role: Role) {
  const before = await getProposal(id);
  ownGuard(before, actorId, role);
  await prisma.proposal.delete({ where: { id } });
  await writeAudit({ userId: actorId, entity: 'Proposal', entityId: id, action: 'DELETE', before });
}

// Map the validated input onto the Prisma columns (OTHER-detail cleared unless category is OTHER).
function toData(input: UpsertProposalInput) {
  return {
    title: input.title,
    summary: input.summary ?? null,
    sponsor: input.sponsor ?? null,
    clientName: input.clientName ?? null,
    category: input.category ?? null,
    categoryOther: input.category === 'OTHER' ? (input.categoryOther?.trim() || null) : null,
    deliveryApproach: input.deliveryApproach ?? 'PREDICTIVE',
    estCostIdr: input.estCostIdr ?? null,
    estRevenueIdr: input.estRevenueIdr ?? null,
    targetStart: input.targetStart ?? null,
    targetFinish: input.targetFinish ?? null,
    programId: input.programId ?? null,
  };
}
