import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { materialAmount, manpowerCost } from '../../calc/cost.js';
import type { RiskForReserve } from '../../calc/risk.js';
import { computeBaseline } from './cost.rollup.js';
import type { ActualCostInput, DirectLineInput, IndirectLineInput } from './cost.schemas.js';

const dec = (v: Prisma.Decimal | number | null | undefined): number =>
  v == null ? 0 : Number(v);

// Like dec() but preserves null so `amount ?? manpowerCost` selection stays correct
// (a manpower line has amount=null; coercing it to 0 would shadow manpowerCost).
const decN = (v: Prisma.Decimal | number | null | undefined): number | null =>
  v == null ? null : Number(v);

// Cost can only be detailed once the charter is committed (status past DRAFT).
async function ensureChartered(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true },
  });
  if (!project) throw NotFound('Project not found');
  if (project.status === 'DRAFT') {
    throw BadRequest('Commit the Project Charter before detailing costs');
  }
}

// Map persisted risks into the shape the contingency calculator expects.
async function loadRisksForReserve(projectId: string): Promise<RiskForReserve[]> {
  const risks = await prisma.risk.findMany({
    // Only active risks fund the contingency reserve. A CLOSED threat is no
    // longer a threat, and an OCCURRED one has already materialized (its cost
    // belongs in Actual Cost, not the reserve) — neither should keep inflating
    // the cost baseline / BAC.
    where: { projectId, status: { notIn: ['CLOSED', 'OCCURRED'] } },
    select: { kind: true, emv: true, residualEmv: true, includeInReserve: true },
  });
  return risks.map((r) => ({
    kind: r.kind,
    emv: dec(r.emv),
    residualEmv: r.residualEmv == null ? null : dec(r.residualEmv),
    includeInReserve: r.includeInReserve,
  }));
}

// Recompute and persist the CostBaseline. Called after every cost/risk mutation.
export async function recomputeBaseline(projectId: string) {
  const [directs, indirects, risks, existing] = await Promise.all([
    prisma.costItemDirect.findMany({ where: { projectId }, select: { amount: true, manpowerCost: true } }),
    prisma.costItemIndirect.findMany({ where: { projectId }, select: { amount: true } }),
    loadRisksForReserve(projectId),
    prisma.costBaseline.findUnique({ where: { projectId }, select: { managementReserve: true } }),
  ]);

  const result = computeBaseline({
    directLines: directs.map((d) => ({ amount: decN(d.amount), manpowerCost: decN(d.manpowerCost) })),
    indirectLines: indirects.map((i) => ({ amount: dec(i.amount) })),
    risks,
    managementReserve: dec(existing?.managementReserve),
  });

  return prisma.costBaseline.upsert({
    where: { projectId },
    create: {
      projectId,
      directTotal: result.directTotal,
      indirectTotal: result.indirectTotal,
      contingencyReserve: result.contingencyReserve,
      managementReserve: result.managementReserve,
      costBaseline: result.costBaseline,
      budgetAtCompletion: result.budgetAtCompletion,
    },
    update: {
      directTotal: result.directTotal,
      indirectTotal: result.indirectTotal,
      contingencyReserve: result.contingencyReserve,
      costBaseline: result.costBaseline,
      budgetAtCompletion: result.budgetAtCompletion,
    },
  });
}

// --- DIRECT COST ---

// Resolve manpower role & rate, inheriting from the resource pool when a
// resourceId is given (an explicit value on the input still wins). Also back-fills
// the legacy resourceUserId and a default label from the resource.
async function resolveManpower(input: DirectLineInput) {
  let personnelRole = input.personnelRole ?? null;
  let unitCostPerManday = input.unitCostPerManday ?? null;
  let resourceUserId = input.resourceUserId ?? null;
  let label = input.label;
  if (input.resourceId) {
    const r = await prisma.resource.findUnique({
      where: { id: input.resourceId },
      select: { name: true, personnelRole: true, unitCostPerManday: true, userId: true },
    });
    if (!r) throw NotFound('Resource not found');
    personnelRole = personnelRole ?? r.personnelRole;
    if (unitCostPerManday == null) unitCostPerManday = Number(r.unitCostPerManday);
    resourceUserId = resourceUserId ?? r.userId ?? null;
    if (!label) label = r.name;
  }
  return { personnelRole, unitCostPerManday: unitCostPerManday ?? 0, resourceUserId, label: label ?? '' };
}

export async function addDirectLine(projectId: string, input: DirectLineInput, actorId: string) {
  await ensureChartered(projectId);

  const data: Prisma.CostItemDirectUncheckedCreateInput = {
    projectId,
    type: input.type,
    label: input.label ?? '',
  };

  if (input.type === 'MANPOWER') {
    const m = await resolveManpower(input);
    data.label = m.label;
    data.personnelRole = m.personnelRole;
    data.resourceId = input.resourceId ?? null;
    data.resourceUserId = m.resourceUserId;
    data.rateCardId = input.rateCardId ?? null;
    data.unitCostPerManday = m.unitCostPerManday;
    data.planMandays = input.planMandays;
    data.manpowerCost = manpowerCost(m.unitCostPerManday, input.planMandays!);
    data.taskId = input.taskId ?? null;
  } else {
    data.qty = input.qty;
    data.unitCost = input.unitCost;
    data.amount = materialAmount(input.qty!, input.unitCost!);
  }

  const line = await prisma.costItemDirect.create({ data });
  await recomputeBaseline(projectId);
  await writeAudit({ projectId, userId: actorId, entity: 'CostItemDirect', entityId: line.id, action: 'CREATE', after: line });
  return line;
}

export async function updateDirectLine(
  projectId: string,
  itemId: string,
  input: DirectLineInput,
  actorId: string,
) {
  const existing = await prisma.costItemDirect.findFirst({ where: { id: itemId, projectId } });
  if (!existing) throw NotFound('Direct cost line not found');

  const data: Prisma.CostItemDirectUncheckedUpdateInput = { type: input.type, label: input.label ?? '' };
  if (input.type === 'MANPOWER') {
    const m = await resolveManpower(input);
    data.label = m.label;
    data.personnelRole = m.personnelRole;
    data.resourceId = input.resourceId ?? null;
    data.resourceUserId = m.resourceUserId;
    data.rateCardId = input.rateCardId ?? null;
    data.unitCostPerManday = m.unitCostPerManday;
    data.planMandays = input.planMandays;
    data.manpowerCost = manpowerCost(m.unitCostPerManday, input.planMandays!);
    data.taskId = input.taskId ?? null;
    // clear material fields
    data.qty = null;
    data.unitCost = null;
    data.amount = null;
  } else {
    data.qty = input.qty;
    data.unitCost = input.unitCost;
    data.amount = materialAmount(input.qty!, input.unitCost!);
    // clear manpower fields
    data.personnelRole = null;
    data.resourceId = null;
    data.resourceUserId = null;
    data.rateCardId = null;
    data.unitCostPerManday = null;
    data.planMandays = null;
    data.manpowerCost = null;
    data.taskId = null;
  }

  const line = await prisma.costItemDirect.update({ where: { id: itemId }, data });
  await recomputeBaseline(projectId);
  await writeAudit({ projectId, userId: actorId, entity: 'CostItemDirect', entityId: itemId, action: 'UPDATE', before: existing, after: line });
  return line;
}

export async function deleteDirectLine(projectId: string, itemId: string, actorId: string) {
  const existing = await prisma.costItemDirect.findFirst({ where: { id: itemId, projectId } });
  if (!existing) throw NotFound('Direct cost line not found');
  await prisma.costItemDirect.delete({ where: { id: itemId } });
  await recomputeBaseline(projectId);
  await writeAudit({ projectId, userId: actorId, entity: 'CostItemDirect', entityId: itemId, action: 'DELETE', before: existing });
}

// --- INDIRECT COST ---

export async function addIndirectLine(projectId: string, input: IndirectLineInput, actorId: string) {
  await ensureChartered(projectId);
  const line = await prisma.costItemIndirect.create({
    data: { projectId, type: input.type, description: input.description, amount: input.amount },
  });
  await recomputeBaseline(projectId);
  await writeAudit({ projectId, userId: actorId, entity: 'CostItemIndirect', entityId: line.id, action: 'CREATE', after: line });
  return line;
}

export async function updateIndirectLine(
  projectId: string,
  itemId: string,
  input: IndirectLineInput,
  actorId: string,
) {
  const existing = await prisma.costItemIndirect.findFirst({ where: { id: itemId, projectId } });
  if (!existing) throw NotFound('Indirect cost line not found');
  const line = await prisma.costItemIndirect.update({
    where: { id: itemId },
    data: { type: input.type, description: input.description, amount: input.amount },
  });
  await recomputeBaseline(projectId);
  await writeAudit({ projectId, userId: actorId, entity: 'CostItemIndirect', entityId: itemId, action: 'UPDATE', before: existing, after: line });
  return line;
}

export async function deleteIndirectLine(projectId: string, itemId: string, actorId: string) {
  const existing = await prisma.costItemIndirect.findFirst({ where: { id: itemId, projectId } });
  if (!existing) throw NotFound('Indirect cost line not found');
  await prisma.costItemIndirect.delete({ where: { id: itemId } });
  await recomputeBaseline(projectId);
  await writeAudit({ projectId, userId: actorId, entity: 'CostItemIndirect', entityId: itemId, action: 'DELETE', before: existing });
}

// --- MANAGEMENT RESERVE & SUMMARY ---

export async function setManagementReserve(projectId: string, amount: number, actorId: string) {
  await ensureChartered(projectId);
  await prisma.costBaseline.upsert({
    where: { projectId },
    create: { projectId, managementReserve: amount },
    update: { managementReserve: amount },
  });
  const baseline = await recomputeBaseline(projectId);
  await writeAudit({ projectId, userId: actorId, entity: 'CostBaseline', entityId: projectId, action: 'UPDATE', after: { managementReserve: amount } });
  return baseline;
}

// --- ACTUAL COST (time-phased, feeds EVM CPI) ---

// Cumulative Actual Cost up to (and including) a status date.
export async function actualCostAsOf(projectId: string, asOf: Date): Promise<number> {
  const agg = await prisma.actualCostEntry.aggregate({
    where: { projectId, date: { lte: asOf } },
    _sum: { amount: true },
  });
  return dec(agg._sum.amount);
}

export async function listActualCosts(projectId: string) {
  return prisma.actualCostEntry.findMany({ where: { projectId }, orderBy: { date: 'asc' } });
}

export async function addActualCost(projectId: string, input: ActualCostInput, actorId: string) {
  await ensureChartered(projectId);
  const entry = await prisma.actualCostEntry.create({
    data: {
      projectId,
      date: input.date,
      amount: input.amount,
      description: input.description ?? null,
      recordedBy: actorId,
    },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'ActualCostEntry', entityId: entry.id, action: 'CREATE', after: entry });
  return entry;
}

export async function deleteActualCost(projectId: string, id: string, actorId: string) {
  const existing = await prisma.actualCostEntry.findFirst({ where: { id, projectId } });
  if (!existing) throw NotFound('Actual cost entry not found');
  await prisma.actualCostEntry.delete({ where: { id } });
  await writeAudit({ projectId, userId: actorId, entity: 'ActualCostEntry', entityId: id, action: 'DELETE', before: existing });
}

export async function getCostSummary(projectId: string) {
  const [directCosts, indirectCosts, baseline, charter, actualCosts] = await Promise.all([
    prisma.costItemDirect.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: {
        resource: { select: { id: true, name: true } },
        resourceRef: { select: { id: true, name: true, resourceType: true } },
      },
    }),
    prisma.costItemIndirect.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
    prisma.costBaseline.findUnique({ where: { projectId } }),
    prisma.projectCharter.findUnique({ where: { projectId }, select: { hiCostIdr: true } }),
    prisma.actualCostEntry.findMany({ where: { projectId }, orderBy: { date: 'asc' } }),
  ]);

  const actualCostTotal = actualCosts.reduce((s, a) => s + dec(a.amount), 0);

  return {
    directCosts,
    indirectCosts,
    baseline: baseline ?? null,
    highLevelCharterCost: charter ? dec(charter.hiCostIdr) : null,
    actualCosts,
    actualCostTotal,
  };
}
