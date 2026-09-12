import type { Prisma } from '@prisma/client';
import { prisma, type TxClient } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { activeTenantIsPersonal } from '../../lib/tenant/context.js';
import { materialAmount, manpowerCost } from '../../calc/cost.js';
import type { RiskForReserve } from '../../calc/risk.js';
import { computeBaseline } from './cost.rollup.js';
import { assertBaselineUnlocked } from '../projects/baseline.service.js';
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
// `db` is the prisma client or a transaction client, so the baseline recompute
// can run atomically inside the same transaction as the mutation that triggered it.
// TxClient (extended-client-derived) accepts both the full client and an interactive tx.
type Db = TxClient;

async function loadRisksForReserve(projectId: string, db: Db = prisma): Promise<RiskForReserve[]> {
  const risks = await db.risk.findMany({
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
// Pass a transaction client so the recompute commits/rolls back atomically with
// the triggering write (a failure here must not leave a stale baseline behind).
export async function recomputeBaseline(projectId: string, db: Db = prisma) {
  const [directs, indirects, risks, existing] = await Promise.all([
    db.costItemDirect.findMany({ where: { projectId }, select: { amount: true, manpowerCost: true } }),
    db.costItemIndirect.findMany({ where: { projectId }, select: { amount: true } }),
    loadRisksForReserve(projectId, db),
    db.costBaseline.findUnique({ where: { projectId }, select: { managementReserve: true } }),
  ]);

  const result = computeBaseline({
    directLines: directs.map((d) => ({ amount: decN(d.amount), manpowerCost: decN(d.manpowerCost) })),
    indirectLines: indirects.map((i) => ({ amount: dec(i.amount) })),
    risks,
    managementReserve: dec(existing?.managementReserve),
  });

  return db.costBaseline.upsert({
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
    // A cross-workspace resource can't even load — tenant scoping limits this to the caller's
    // tenant's resources — so a null result IS the isolation (no explicit workspace check needed).
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
  if (input.rateCardId) {
    const rc = await prisma.rateCard.findUnique({ where: { id: input.rateCardId }, select: { id: true } });
    if (!rc) throw NotFound('Rate card not found');
  }
  // In a guest's PERSONAL tenant a line never links a corporate login account (the resourceUserId→User
  // relation would otherwise attach a corporate identity to a guest's line). Guest-owned resources
  // already force userId=null; enforce the raw field too.
  if (activeTenantIsPersonal()) resourceUserId = null;
  return { personnelRole, unitCostPerManday: unitCostPerManday ?? 0, resourceUserId, label: label ?? '' };
}

// Convenience prefill (Manpower → task Owner): when a manpower line is linked to a task
// (taskId) and carries a resource, and that task has NO owner yet, set the task's Owner (PIC)
// to the same resource. Never overwrites an existing owner and never touches cost (picResource
// isn't baseline-gated). Runs inside the caller's transaction; returns the task id if it set an
// owner, so the caller can audit it. Only the safe Manpower→Owner direction is synced.
async function prefillTaskOwner(tx: Db, taskId: string | null | undefined, resourceId: string | null | undefined): Promise<string | null> {
  if (!taskId || !resourceId) return null;
  const task = await tx.task.findFirst({ where: { id: taskId }, select: { id: true, picResourceId: true, picUserId: true } });
  if (!task || task.picResourceId || task.picUserId) return null; // don't overwrite an existing owner
  // Set the lead owner AND add the matching owner link (idempotent) so the owner set stays in sync.
  await tx.task.update({
    where: { id: taskId },
    data: {
      picResourceId: resourceId,
      owners: { connectOrCreate: { where: { taskId_resourceId: { taskId, resourceId } }, create: { resourceId } } },
    },
  });
  return taskId;
}

export async function addDirectLine(projectId: string, input: DirectLineInput, actorId: string) {
  await ensureChartered(projectId);
  await assertBaselineUnlocked(projectId);

  const data: Prisma.CostItemDirectUncheckedCreateInput = {
    projectId,
    type: input.type,
    label: input.label ?? '',
    subCategory: input.type === 'OTHER' ? input.subCategory?.trim() ?? null : null,
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

  const { line, ownerSetTaskId } = await prisma.$transaction(async (tx) => {
    // Append after the current lines (max sortOrder + 1) so new entries land at the end of their list.
    const agg = await tx.costItemDirect.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    data.sortOrder = (agg._max.sortOrder ?? 0) + 1;
    const created = await tx.costItemDirect.create({ data });
    await recomputeBaseline(projectId, tx);
    const ownerSetTaskId = input.type === 'MANPOWER' ? await prefillTaskOwner(tx, created.taskId, created.resourceId) : null;
    return { line: created, ownerSetTaskId };
  });
  await writeAudit({ projectId, userId: actorId, entity: 'CostItemDirect', entityId: line.id, action: 'CREATE', after: line });
  if (ownerSetTaskId) {
    await writeAudit({ projectId, userId: actorId, entity: 'Task', entityId: ownerSetTaskId, action: 'UPDATE', after: { picResourceId: line.resourceId, via: 'manpower-owner-prefill' } });
  }
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
  await assertBaselineUnlocked(projectId);

  const data: Prisma.CostItemDirectUncheckedUpdateInput = {
    type: input.type,
    label: input.label ?? '',
    subCategory: input.type === 'OTHER' ? input.subCategory?.trim() ?? null : null,
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
    // Only touch taskId when the payload actually carries it. Writing `?? null`
    // here silently severed the manpower↔task link (the EVM budget weight + the
    // resource time-phasing key) whenever an edit form omitted taskId.
    if (input.taskId !== undefined) data.taskId = input.taskId;
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

  const { line, ownerSetTaskId } = await prisma.$transaction(async (tx) => {
    const updated = await tx.costItemDirect.update({ where: { id: itemId }, data });
    await recomputeBaseline(projectId, tx);
    const ownerSetTaskId = input.type === 'MANPOWER' ? await prefillTaskOwner(tx, updated.taskId, updated.resourceId) : null;
    return { line: updated, ownerSetTaskId };
  });
  await writeAudit({ projectId, userId: actorId, entity: 'CostItemDirect', entityId: itemId, action: 'UPDATE', before: existing, after: line });
  if (ownerSetTaskId) {
    await writeAudit({ projectId, userId: actorId, entity: 'Task', entityId: ownerSetTaskId, action: 'UPDATE', after: { picResourceId: line.resourceId, via: 'manpower-owner-prefill' } });
  }
  return line;
}

export async function deleteDirectLine(projectId: string, itemId: string, actorId: string) {
  const existing = await prisma.costItemDirect.findFirst({ where: { id: itemId, projectId } });
  if (!existing) throw NotFound('Direct cost line not found');
  await assertBaselineUnlocked(projectId);
  await prisma.$transaction(async (tx) => {
    await tx.costItemDirect.delete({ where: { id: itemId } });
    await recomputeBaseline(projectId, tx);
  });
  await writeAudit({ projectId, userId: actorId, entity: 'CostItemDirect', entityId: itemId, action: 'DELETE', before: existing });
}

// Reorder direct cost lines (drag-to-reorder within a category). Presentational only — it never
// touches amounts, so it's allowed even when the baseline is locked. The client sends the FULL
// ordered id list of all direct lines; each gets sortOrder = its 1-based index in that list.
export async function reorderDirectLines(projectId: string, ids: string[], actorId: string) {
  const lines = await prisma.costItemDirect.findMany({ where: { projectId }, select: { id: true } });
  const known = new Set(lines.map((l) => l.id));
  const clean = ids.filter((id) => known.has(id));
  if (clean.length === 0) return;
  await prisma.$transaction(clean.map((id, i) => prisma.costItemDirect.update({ where: { id }, data: { sortOrder: i + 1 } })));
  await writeAudit({ projectId, userId: actorId, entity: 'CostItemDirect', entityId: clean[0], action: 'UPDATE', after: { reordered: clean } });
}

// --- INDIRECT COST ---

export async function addIndirectLine(projectId: string, input: IndirectLineInput, actorId: string) {
  await ensureChartered(projectId);
  await assertBaselineUnlocked(projectId);
  const line = await prisma.$transaction(async (tx) => {
    const created = await tx.costItemIndirect.create({
      data: {
        projectId,
        type: input.type,
        description: input.description,
        subCategory: input.type === 'OTHER' ? input.subCategory?.trim() ?? null : null,
        amount: input.amount,
      },
    });
    await recomputeBaseline(projectId, tx);
    return created;
  });
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
  await assertBaselineUnlocked(projectId);
  const line = await prisma.$transaction(async (tx) => {
    const updated = await tx.costItemIndirect.update({
      where: { id: itemId },
      data: {
        type: input.type,
        description: input.description,
        subCategory: input.type === 'OTHER' ? input.subCategory?.trim() ?? null : null,
        amount: input.amount,
      },
    });
    await recomputeBaseline(projectId, tx);
    return updated;
  });
  await writeAudit({ projectId, userId: actorId, entity: 'CostItemIndirect', entityId: itemId, action: 'UPDATE', before: existing, after: line });
  return line;
}

export async function deleteIndirectLine(projectId: string, itemId: string, actorId: string) {
  const existing = await prisma.costItemIndirect.findFirst({ where: { id: itemId, projectId } });
  if (!existing) throw NotFound('Indirect cost line not found');
  await assertBaselineUnlocked(projectId);
  await prisma.$transaction(async (tx) => {
    await tx.costItemIndirect.delete({ where: { id: itemId } });
    await recomputeBaseline(projectId, tx);
  });
  await writeAudit({ projectId, userId: actorId, entity: 'CostItemIndirect', entityId: itemId, action: 'DELETE', before: existing });
}

// --- MANAGEMENT RESERVE & SUMMARY ---

export async function setManagementReserve(projectId: string, amount: number, actorId: string) {
  await ensureChartered(projectId);
  await assertBaselineUnlocked(projectId);
  const baseline = await prisma.$transaction(async (tx) => {
    await tx.costBaseline.upsert({
      where: { projectId },
      create: { projectId, managementReserve: amount },
      update: { managementReserve: amount },
    });
    return recomputeBaseline(projectId, tx);
  });
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
  // When attributed to a budget line, verify it belongs to this project and derive the
  // drawn-down category from the line (a picked line wins over any category in the payload).
  let category = input.category ?? 'DIRECT';
  if (input.directLineId) {
    const line = await prisma.costItemDirect.findFirst({ where: { id: input.directLineId, projectId }, select: { id: true } });
    if (!line) throw NotFound('Direct cost line not found');
    category = 'DIRECT';
  } else if (input.indirectLineId) {
    const line = await prisma.costItemIndirect.findFirst({ where: { id: input.indirectLineId, projectId }, select: { id: true } });
    if (!line) throw NotFound('Indirect cost line not found');
    category = 'INDIRECT';
  }
  const entry = await prisma.actualCostEntry.create({
    data: {
      projectId,
      date: input.date,
      amount: input.amount,
      description: input.description ?? null,
      category,
      directLineId: input.directLineId ?? null,
      indirectLineId: input.indirectLineId ?? null,
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

const round2 = (n: number) => Math.round(n * 100) / 100;

// Labour cost implied by logged timesheets = Σ (consumed man-days × day-rate) over manpower lines.
async function computeLabourActual(projectId: string) {
  const [lines, mandaySums] = await Promise.all([
    prisma.costItemDirect.findMany({ where: { projectId, type: 'MANPOWER' }, select: { id: true, unitCostPerManday: true } }),
    prisma.mandayEntry.groupBy({ by: ['costItemId'], where: { projectId }, _sum: { mandays: true } }),
  ]);
  const consumedByLine = new Map(mandaySums.map((m) => [m.costItemId, dec(m._sum.mandays)]));
  let labourActual = 0;
  let labourConsumedMandays = 0;
  for (const l of lines) {
    const consumed = consumedByLine.get(l.id) ?? 0;
    labourConsumedMandays += consumed;
    labourActual += consumed * dec(l.unitCostPerManday);
  }
  return { labourActual: round2(labourActual), labourConsumedMandays: round2(labourConsumedMandays) };
}

// Sentinel description that marks the single auto-derived "labour from timesheet" AC entry.
// Repeated fills replace it (never stack), so labour AC stays in sync without double-counting.
export const LABOUR_AC_DESC = 'Labour actual (from timesheet)';

// Core: replace the single auto-derived labour AC entry with the current timesheet-implied
// labour cost (Σ md × day-rate). Idempotent — deletes its own prior sentinel entry then
// re-creates it (or none, when labour is 0), so labour AC never double-counts and manual AC
// entries are untouched. `via` tags the audit ('timesheet-fill' manual · 'timesheet-auto').
async function resyncLabourAc(projectId: string, actorId: string, via: 'timesheet-fill' | 'timesheet-auto') {
  const { labourActual, labourConsumedMandays } = await computeLabourActual(projectId);
  // Date it at the latest logged man-day so it feeds CPI within the effort period.
  const latest = await prisma.mandayEntry.aggregate({ where: { projectId }, _max: { date: true } });
  const entryDate = latest._max.date ?? new Date();

  const result = await prisma.$transaction(async (tx) => {
    const removed = await tx.actualCostEntry.deleteMany({ where: { projectId, description: LABOUR_AC_DESC } });
    const entry = labourActual > 0
      ? await tx.actualCostEntry.create({ data: { projectId, date: entryDate, amount: labourActual, description: LABOUR_AC_DESC, category: 'DIRECT', recordedBy: actorId } })
      : null;
    return { entry, replaced: removed.count };
  });
  await writeAudit({
    projectId, userId: actorId, entity: 'ActualCostEntry', entityId: result.entry?.id ?? projectId,
    action: 'UPDATE', after: { via, amount: labourActual, mandays: labourConsumedMandays, replaced: result.replaced },
  });
  return { entry: result.entry, labourActual, labourConsumedMandays, replaced: result.replaced };
}

// One-click: set the auto-derived labour Actual Cost entry to the current timesheet-implied
// labour cost. Idempotent (replaces its own prior entry); manual AC entries are untouched.
export async function fillActualCostFromTimesheet(projectId: string, actorId: string) {
  await ensureChartered(projectId);
  return resyncLabourAc(projectId, actorId, 'timesheet-fill');
}

// Called after any man-day mutation (from the timesheet module). When the project has opted
// in to auto-posting, re-sync the labour AC so it always tracks timesheets without a manual
// click. Best-effort: never let an AC-sync failure break the timesheet write itself (a later
// log re-syncs); no-op when the flag is off. Returns whether a sync ran.
export async function syncLabourAcIfAuto(projectId: string, actorId: string): Promise<boolean> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { autoPostLabourAc: true } });
  if (!project?.autoPostLabourAc) return false;
  try {
    await resyncLabourAc(projectId, actorId, 'timesheet-auto');
    return true;
  } catch (err) {
    console.error(`[cost] auto labour-AC sync failed for project ${projectId}:`, err);
    return false;
  }
}

// Toggle the per-project auto-post flag. Turning it ON immediately syncs so AC reflects the
// current timesheet right away; turning it OFF leaves the existing auto entry in place (it is
// real spend already in AC — the manual "Fill AC" control simply reappears).
export async function setAutoPostLabourAc(projectId: string, enabled: boolean, actorId: string) {
  await ensureChartered(projectId);
  await prisma.project.update({ where: { id: projectId }, data: { autoPostLabourAc: enabled } });
  await writeAudit({ projectId, userId: actorId, entity: 'Project', entityId: projectId, action: 'UPDATE', after: { autoPostLabourAc: enabled } });
  if (enabled) await resyncLabourAc(projectId, actorId, 'timesheet-auto');
  return { autoPostLabourAc: enabled };
}

export async function getCostSummary(projectId: string) {
  const [directCosts, indirectCosts, baseline, charter, actualCosts, mandaySums, project, committedProcurements] = await Promise.all([
    prisma.costItemDirect.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        resource: { select: { id: true, name: true } },
        resourceRef: { select: { id: true, name: true, resourceType: true } },
      },
    }),
    prisma.costItemIndirect.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
    prisma.costBaseline.findUnique({ where: { projectId } }),
    prisma.projectCharter.findUnique({ where: { projectId }, select: { hiCostIdr: true } }),
    prisma.actualCostEntry.findMany({ where: { projectId }, orderBy: { date: 'asc' } }),
    prisma.mandayEntry.groupBy({ by: ['costItemId'], where: { projectId }, _sum: { mandays: true } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { autoPostLabourAc: true } }),
    // Committed cost = value of contracts/POs charged to a budget line and currently obligated
    // (awarded → delivered). PLANNED/SOLICITATION aren't committed yet; CLOSED/CANCELLED are done.
    prisma.procurement.findMany({
      where: { projectId, status: { in: ['AWARDED', 'IN_PROGRESS', 'DELIVERED'] } },
      select: { amount: true, costDirectLineId: true, costIndirectLineId: true },
    }),
  ]);

  const directLineCommitted = new Map<string, number>();
  const indirectLineCommitted = new Map<string, number>();
  let committedDirect = 0;
  let committedIndirect = 0;
  for (const pc of committedProcurements) {
    const amt = dec(pc.amount);
    if (amt <= 0) continue;
    if (pc.costDirectLineId) { directLineCommitted.set(pc.costDirectLineId, (directLineCommitted.get(pc.costDirectLineId) ?? 0) + amt); committedDirect += amt; }
    else if (pc.costIndirectLineId) { indirectLineCommitted.set(pc.costIndirectLineId, (indirectLineCommitted.get(pc.costIndirectLineId) ?? 0) + amt); committedIndirect += amt; }
  }

  const actualCostTotal = actualCosts.reduce((s, a) => s + dec(a.amount), 0);

  // Read-only reference: labour cost implied by logged timesheets = Σ (consumed man-days ×
  // day-rate) over manpower lines. Purely informational — it does NOT feed AC or EVM (AC is
  // entered manually and also covers non-labour spend like materials/licenses).
  const consumedByLine = new Map(mandaySums.map((m) => [m.costItemId, dec(m._sum.mandays)]));
  let labourActual = 0;
  let labourConsumedMandays = 0;
  for (const d of directCosts) {
    if (d.type !== 'MANPOWER') continue;
    const consumed = consumedByLine.get(d.id) ?? 0;
    labourConsumedMandays += consumed;
    labourActual += consumed * dec(d.unitCostPerManday);
  }

  // Actual spend split by the budget it draws down. Labour is added via labourActual
  // (the live timesheet figure), so the labour sentinel AC entry is skipped here to
  // avoid double-counting even after "Fill AC from timesheet". Everything else is
  // attributed by its category (legacy rows default to DIRECT in the schema).
  // Per-component (per-line) attribution is accumulated in parallel so each budget line can
  // report how much of it has been spent / is still remaining.
  const directLineActual = new Map<string, number>(); // material lines only (manpower uses timesheet)
  const indirectLineActual = new Map<string, number>();
  let directMaterialActual = 0;
  let indirectActual = 0;
  for (const a of actualCosts) {
    if (a.description === LABOUR_AC_DESC) continue;
    const amt = dec(a.amount);
    if (a.category === 'INDIRECT') {
      indirectActual += amt;
      if (a.indirectLineId) indirectLineActual.set(a.indirectLineId, (indirectLineActual.get(a.indirectLineId) ?? 0) + amt);
    } else {
      directMaterialActual += amt;
      if (a.directLineId) directLineActual.set(a.directLineId, (directLineActual.get(a.directLineId) ?? 0) + amt);
    }
  }
  const directActual = labourActual + directMaterialActual;

  // Attach per-line spent-to-date + remaining. Manpower draws its actual from the timesheet
  // (consumed md × rate); material & indirect lines from attributed Actual Cost entries.
  const attributedDirect = [...directLineActual.values()].reduce((s, v) => s + v, 0);
  const attributedIndirect = [...indirectLineActual.values()].reduce((s, v) => s + v, 0);
  // Available = budget still free to spend AND not yet obligated by a contract:
  //   available = budget − actualToDate − committed  (⊂ remaining, which only nets actual).
  // Lets a line read "budget left" (remaining) vs "truly uncommitted" (available) side by side.
  const directCostsWithSpend = directCosts.map((d) => {
    const budget = dec(d.type === 'MANPOWER' ? d.manpowerCost : d.amount);
    const actualToDate = d.type === 'MANPOWER'
      ? round2((consumedByLine.get(d.id) ?? 0) * dec(d.unitCostPerManday))
      : round2(directLineActual.get(d.id) ?? 0);
    const committed = round2(directLineCommitted.get(d.id) ?? 0);
    return { ...d, actualToDate, remaining: round2(budget - actualToDate), committed, available: round2(budget - actualToDate - committed) };
  });
  const indirectCostsWithSpend = indirectCosts.map((i) => {
    const actualToDate = round2(indirectLineActual.get(i.id) ?? 0);
    const committed = round2(indirectLineCommitted.get(i.id) ?? 0);
    return { ...i, actualToDate, remaining: round2(dec(i.amount) - actualToDate), committed, available: round2(dec(i.amount) - actualToDate - committed) };
  });
  const availableDirect = round2(directCostsWithSpend.reduce((s, d) => s + d.available, 0));
  const availableIndirect = round2(indirectCostsWithSpend.reduce((s, i) => s + i.available, 0));

  return {
    directCosts: directCostsWithSpend,
    indirectCosts: indirectCostsWithSpend,
    baseline: baseline ?? null,
    highLevelCharterCost: charter ? dec(charter.hiCostIdr) : null,
    actualCosts,
    actualCostTotal,
    labourActual: Math.round(labourActual * 100) / 100,
    labourConsumedMandays: Math.round(labourConsumedMandays * 100) / 100,
    directActual: Math.round(directActual * 100) / 100,
    indirectActual: Math.round(indirectActual * 100) / 100,
    // Spend not booked against any specific line — rolls up to the category bucket only.
    unattributedDirectActual: round2(directMaterialActual - attributedDirect),
    unattributedIndirectActual: round2(indirectActual - attributedIndirect),
    // Committed cost = obligated via awarded→delivered contracts charged to budget lines.
    committedDirect: round2(committedDirect),
    committedIndirect: round2(committedIndirect),
    committedTotal: round2(committedDirect + committedIndirect),
    // Available (uncommitted) = budget − spent − committed, rolled up per category + overall.
    availableDirect,
    availableIndirect,
    availableTotal: round2(availableDirect + availableIndirect),
    autoPostLabourAc: project?.autoPostLabourAc ?? false,
  };
}

export interface PortfolioActualRow { projectId: string; directActual: number; indirectActual: number; actualTotal: number }
export interface PortfolioActuals { projects: PortfolioActualRow[]; totals: { directActual: number; indirectActual: number; actualTotal: number } }

// Compare a project's LIVE actual cost (getCostSummary: manpower from timesheet + attributed AC —
// the same basis as the Cost tab & the AI assistant) against the EVM AC it was given (actualCostAsOf =
// posted ActualCostEntry ledger). `acUnposted` is the slack — typically logged timesheet labour that
// hasn't been posted to the ledger yet — which makes CPI (= EV/AC) read optimistically low on cost.
// Used to surface a "CPI may be optimistic" hint on the Health panel; does NOT change the EVM math.
export async function actualCostBasis(projectId: string, evmAc: number): Promise<{ acLive: number; acUnposted: number }> {
  const c = await getCostSummary(projectId);
  const acLive = round2((c.directActual ?? 0) + (c.indirectActual ?? 0));
  return { acLive, acUnposted: Math.max(0, round2(acLive - evmAc)) };
}

// Live actual-cost rollup across several projects. Deliberately reuses getCostSummary per project so
// each figure — and the total — matches EXACTLY what get_project_costs reports (never the stale EVM
// snapshot AC, and never a re-derived formula that could drift). getCostSummary is ~8 queries each, so
// we bound the fan-out with a small concurrency window; the caller caps how many projectIds it passes.
export async function getPortfolioActualCosts(projectIds: string[]): Promise<PortfolioActuals> {
  const CONCURRENCY = 6;
  const projects: PortfolioActualRow[] = [];
  for (let i = 0; i < projectIds.length; i += CONCURRENCY) {
    const batch = await Promise.all(projectIds.slice(i, i + CONCURRENCY).map(async (projectId) => {
      const c = await getCostSummary(projectId);
      const directActual = c.directActual ?? 0;
      const indirectActual = c.indirectActual ?? 0;
      return { projectId, directActual, indirectActual, actualTotal: round2(directActual + indirectActual) };
    }));
    projects.push(...batch);
  }
  const totals = projects.reduce(
    (a, r) => ({ directActual: a.directActual + r.directActual, indirectActual: a.indirectActual + r.indirectActual, actualTotal: a.actualTotal + r.actualTotal }),
    { directActual: 0, indirectActual: 0, actualTotal: 0 },
  );
  return { projects, totals: { directActual: round2(totals.directActual), indirectActual: round2(totals.indirectActual), actualTotal: round2(totals.actualTotal) } };
}
