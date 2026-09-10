import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, Conflict, NotFound } from '../../lib/errors.js';
import { activeTenantIsPersonal, getTenantStore } from '../../lib/tenant/context.js';
import { computeEvm, type EvmTask } from '../../calc/evm.js';
import { actualCostAsOf } from '../cost/cost.service.js';
import { assertBaselineUnlocked } from '../projects/baseline.service.js';
import { getTemplate, listTemplates } from './schedule.templates.js';
import {
  durationDays,
  generateTaskCode,
  buildGanttTree,
  hasDependencyCycle,
  reconcileManpower,
  isCostLoaded,
  computeCpm,
  computeLeafWeights,
  deriveStepProgress,
  autoSchedule,
  type DependencyEdge,
  type CpmDepType,
  type AutoTaskInput,
  type AutoScheduleMode,
} from './schedule.helpers.js';
import type { DependencyInput, DependencyEditInput, TaskActualsInput, TaskStepsInput, UpsertTaskInput } from './schedule.schemas.js';
import { simulateSchedule, seedFromString, type SchedDistribution } from './scheduleSimulation.js';

const dec = (v: Prisma.Decimal | number | null | undefined): number =>
  v == null ? 0 : Number(v);

async function ensureChartered(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true },
  });
  if (!project) throw NotFound('Project not found');
  if (project.status === 'DRAFT') {
    throw BadRequest('Commit the Project Charter before building the schedule');
  }
}

// Σ manpowerCost / Σ planMandays per task, from linked Direct (MANPOWER) cost lines.
// Used by the manpower<->schedule reconciliation (mandays are manpower-specific).
async function manpowerByTask(projectId: string) {
  const items = await prisma.costItemDirect.findMany({
    where: { projectId, type: 'MANPOWER', taskId: { not: null } },
    select: { taskId: true, manpowerCost: true, planMandays: true },
  });
  const cost = new Map<string, number>();
  const mandays = new Map<string, number>();
  for (const it of items) {
    const id = it.taskId!;
    cost.set(id, (cost.get(id) ?? 0) + dec(it.manpowerCost));
    mandays.set(id, (mandays.get(id) ?? 0) + dec(it.planMandays));
  }
  return { cost, mandays };
}

// Σ direct cost per task across ALL direct types (manpower + material/license),
// using each line's value = amount ?? manpowerCost. This is the work-package
// budget weight that distributes BAC across leaves for EVM.
async function directCostByTask(projectId: string) {
  const items = await prisma.costItemDirect.findMany({
    where: { projectId, taskId: { not: null } },
    select: { taskId: true, amount: true, manpowerCost: true },
  });
  const cost = new Map<string, number>();
  for (const it of items) {
    const id = it.taskId!;
    const value = it.amount != null ? dec(it.amount) : dec(it.manpowerCost);
    cost.set(id, (cost.get(id) ?? 0) + value);
  }
  return cost;
}

export async function listSchedule(projectId: string) {
  const [tasks, dependencies] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, orderBy: [{ sortOrder: 'asc' }, { wbsCode: 'asc' }] }),
    prisma.taskDependency.findMany({
      where: { predecessor: { projectId } },
    }),
  ]);
  return { tasks, dependencies };
}

// Gantt payload: nested tree enriched with duration, linked manpower mandays and the
// per-task budget. budgetCost = ALL linked direct cost (manpower + material/license), so
// the Gantt "Budget" column matches the EVM cost weighting + the PDF/Excel export — NOT
// manpower-only.
export async function getGantt(projectId: string) {
  const [tasks, deps, mp, dc, project] = await Promise.all([
    prisma.task.findMany({
      where: { projectId },
      include: {
        pic: { select: { id: true, name: true } },
        picResource: { select: { id: true, name: true } },
        owners: { select: { resource: { select: { id: true, name: true } } } },
        _count: { select: { steps: true } },
      },
    }),
    prisma.taskDependency.findMany({ where: { predecessor: { projectId } } }),
    manpowerByTask(projectId),
    directCostByTask(projectId),
    prisma.project.findUnique({ where: { id: projectId }, select: { scheduleBaselinedAt: true, baselineLockedAt: true } }),
  ]);

  // Effective work-package share per node (Model B) — the authoritative weight each task
  // contributes to project %, honouring manual `weight` overrides. Lets the client show a
  // Main Task's real share so partial/mixed weighting is self-correcting.
  const parentIds = new Set(tasks.filter((t) => t.parentTaskId).map((t) => t.parentTaskId!));
  const leafIds = tasks.filter((t) => !parentIds.has(t.id)).map((t) => t.id);
  const leafDur = new Map(tasks.map((t) => [t.id, durationDays(t.planStart, t.planEnd)]));
  const costLoaded = isCostLoaded(leafIds.map((id) => ({ cost: dc.get(id) ?? 0, durationDays: leafDur.get(id)! })));
  const leafProxy = new Map(leafIds.map((id) => [id, costLoaded ? (dc.get(id) ?? 0) : leafDur.get(id)!]));
  if ([...leafProxy.values()].every((v) => v === 0)) for (const k of leafProxy.keys()) leafProxy.set(k, 1);
  // Match the EVM engine: weight against the frozen baselineWeight once a baseline exists, so the
  // displayed share == the number actually driving EV/% complete.
  const baselined = !!project?.scheduleBaselinedAt;
  const leafWeight = computeLeafWeights(
    tasks.map((t) => ({ id: t.id, parentTaskId: t.parentTaskId, weight: baselined ? t.baselineWeight : t.weight, proxy: leafProxy.get(t.id) ?? 0 })),
  );
  const totalWeight = [...leafWeight.values()].reduce((s, w) => s + w, 0);
  // Roll each leaf's weight up to all its ancestors so parents show their subtree share.
  const parentById = new Map(tasks.map((t) => [t.id, t.parentTaskId]));
  const subtreeWeight = new Map<string, number>();
  for (const [leafId, w] of leafWeight) {
    for (let cursor: string | null = leafId, hops = 0; cursor && hops <= tasks.length; hops++) {
      subtreeWeight.set(cursor, (subtreeWeight.get(cursor) ?? 0) + w);
      cursor = parentById.get(cursor) ?? null;
    }
  }

  const enriched = tasks.map((t) => ({
    ...t,
    // Flatten the owner join to the shape the client expects; lead is still `picResource`.
    owners: t.owners.map((o) => o.resource),
    durationDays: durationDays(t.planStart, t.planEnd),
    budgetCost: dc.get(t.id) ?? 0,
    linkedPlanMandays: mp.mandays.get(t.id) ?? 0,
    // Share of the project's total weight this task (or its subtree) carries, 0..100.
    effectiveWeightPct: totalWeight > 0 ? Math.round(((subtreeWeight.get(t.id) ?? 0) / totalWeight) * 1000) / 10 : 0,
    // Count of weighted progress steps — when > 0 the % is derived (read-only) from the steps.
    stepCount: t._count?.steps ?? 0,
  }));

  // baselineLocked freezes task dates + dependencies (assertBaselineUnlocked), so the client
  // disables drag-reschedule and dependency editing when it's set.
  return { tree: buildGanttTree(enriched), dependencies: deps, baselinedAt: project?.scheduleBaselinedAt ?? null, baselineLocked: !!project?.baselineLockedAt };
}

// Critical Path Method over the leaf tasks (activities) and their FS/SS/FF/SF
// dependencies: early/late start & finish, total float, and the critical path.
export async function getCpm(projectId: string) {
  const [tasks, deps] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, select: { id: true, parentTaskId: true, wbsCode: true, name: true, planStart: true, planEnd: true } }),
    prisma.taskDependency.findMany({ where: { predecessor: { projectId } }, select: { predecessorId: true, successorId: true, type: true, lagDays: true } }),
  ]);
  // Activities = leaf tasks (a task that is no other task's parent).
  const parentIds = new Set(tasks.map((t) => t.parentTaskId).filter(Boolean) as string[]);
  const leaves = tasks.filter((t) => !parentIds.has(t.id));
  const cpm = computeCpm(
    leaves.map((t) => ({ id: t.id, duration: durationDays(t.planStart, t.planEnd) })),
    deps.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId, type: d.type as CpmDepType, lagDays: d.lagDays })),
  );
  const rows = leaves
    .map((t) => {
      const r = cpm.tasks[t.id] ?? { es: 0, ef: 0, ls: 0, lf: 0, totalFloat: 0, critical: false };
      return { id: t.id, wbsCode: t.wbsCode, name: t.name, planStart: t.planStart, planEnd: t.planEnd, duration: durationDays(t.planStart, t.planEnd), ...r };
    })
    .sort((a, b) => a.es - b.es || a.wbsCode.localeCompare(b.wbsCode));
  return {
    hasNetwork: cpm.hasNetwork,
    cyclic: cpm.cyclic,
    projectDuration: cpm.projectDuration,
    criticalCount: cpm.criticalTaskIds.length,
    taskCount: leaves.length,
    tasks: rows,
  };
}

const DAY_MS = 86_400_000;
const addDays = (base: Date, days: number): Date => new Date(base.getTime() + Math.round(days) * DAY_MS);

// Schedule-risk Monte-Carlo: sample each leaf activity's duration from a 3-point (PERT/triangular)
// distribution around its planned duration and propagate through the dependency network (CPM) each
// trial → distribution of the project finish (P50/P80/P90) + a per-activity criticality index.
// Global uncertainty bands (no per-task data); seeded per project for reproducibility. See
// scheduleSimulation.ts. Opts: iterations, confidence, optimisticPct, pessimisticPct, distribution.
export async function getScheduleSimulation(
  projectId: string,
  opts: { iterations?: number; confidence?: number; optimisticPct?: number; pessimisticPct?: number; distribution?: SchedDistribution } = {},
) {
  const [tasks, deps] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, select: { id: true, parentTaskId: true, name: true, wbsCode: true, planStart: true, planEnd: true } }),
    prisma.taskDependency.findMany({ where: { predecessor: { projectId } }, select: { predecessorId: true, successorId: true, type: true, lagDays: true } }),
  ]);
  const parentIds = new Set(tasks.map((t) => t.parentTaskId).filter(Boolean) as string[]);
  const leaves = tasks.filter((t) => !parentIds.has(t.id));

  const projectStart = leaves.length
    ? new Date(Math.min(...leaves.map((t) => t.planStart.getTime())))
    : new Date();

  const activities = leaves.map((t) => ({
    id: t.id,
    duration: durationDays(t.planStart, t.planEnd),
    startOffset: Math.round((t.planStart.getTime() - projectStart.getTime()) / DAY_MS),
  }));
  const edges = deps.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId, type: d.type as CpmDepType, lagDays: d.lagDays }));

  const sim = simulateSchedule(activities, edges, { ...opts, seed: seedFromString(projectId) });

  const nameById = new Map(leaves.map((t) => [t.id, { name: t.name, wbsCode: t.wbsCode }]));
  return {
    ...sim,
    projectStart,
    // Map day-durations from the project start onto calendar finish dates for the UI.
    deterministicFinish: addDays(projectStart, sim.deterministicDays),
    recommendedFinish: addDays(projectStart, sim.recommendedDays),
    finishDates: {
      p10: addDays(projectStart, sim.percentiles.p10),
      p50: addDays(projectStart, sim.percentiles.p50),
      p80: addDays(projectStart, sim.percentiles.p80),
      p90: addDays(projectStart, sim.percentiles.p90),
      p95: addDays(projectStart, sim.percentiles.p95),
    },
    // Top activities by criticality index, with names for the UI.
    criticality: sim.criticality.slice(0, 12).map((c) => ({ ...c, name: nameById.get(c.id)?.name ?? '', wbsCode: nameById.get(c.id)?.wbsCode ?? '' })),
  };
}

// Available WBS templates (list only — see schedule.templates.ts for the task bodies).
export function getWbsTemplates() {
  return listTemplates();
}

// Seed a project's WBS from a curated template. Requires a chartered project with an UNLOCKED
// baseline and an EMPTY schedule (so it can't duplicate/clobber an existing WBS). Dates are
// relative to `startDate`.
export async function applyTemplate(projectId: string, templateId: string, startDate: Date, actorId: string) {
  await ensureChartered(projectId);
  await assertBaselineUnlocked(projectId);
  const template = getTemplate(templateId);
  if (!template) throw NotFound('Template not found');
  const existing = await prisma.task.count({ where: { projectId } });
  if (existing > 0) throw BadRequest('The WBS already has tasks — a template can only seed an empty schedule.');

  const DAY = 86_400_000;
  const base = new Date(startDate);
  base.setUTCHours(0, 0, 0, 0);
  const rows = template.tasks.map((t, i) => {
    const planStart = new Date(+base + t.offsetDays * DAY);
    const planEnd = new Date(+planStart + t.durationDays * DAY);
    return {
      projectId,
      wbsCode: generateTaskCode(i + 1),
      sortOrder: i,
      name: t.name,
      isMilestone: !!t.isMilestone,
      planStart,
      planEnd,
      deliverable: t.deliverable ?? null,
      acceptanceCriteria: t.acceptanceCriteria ?? null,
      progressPct: 0,
      weight: t.weight ?? null,
    };
  });
  await prisma.task.createMany({ data: rows });
  await writeAudit({ projectId, userId: actorId, entity: 'Task', entityId: projectId, action: 'CREATE', after: { appliedTemplate: templateId, taskCount: rows.length } });
  return { created: rows.length, template: template.name };
}

// Validate that the PIC resource, if given, exists. Cross-workspace isolation is now the tenant
// extension's job — a resource from another tenant simply doesn't load (null) — so no explicit
// personalOwnerId workspace check is needed.
async function assertPicResource(picResourceId: string | null | undefined): Promise<void> {
  if (!picResourceId) return;
  const resource = await prisma.resource.findUnique({ where: { id: picResourceId }, select: { id: true } });
  if (!resource) throw NotFound('Resource not found');
}

// Validate every owner resource id exists (in one query).
async function assertOwnerResources(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await prisma.resource.count({ where: { id: { in: ids } } });
  if (found !== new Set(ids).size) throw NotFound('Resource not found');
}

// Resolve the LEAD owner + the full owner set from an upsert input.
// - `ownerIds === undefined` means the caller didn't send `ownerResourceIds`, so owner links must
//   be left untouched on update (unrelated edits keep the assignments).
// - When a set IS given, the lead is folded in (always an owner); with no explicit lead the first
//   owner leads.
function resolveOwners(input: UpsertTaskInput): { leadId: string | null; ownerIds: string[] | undefined } {
  let leadId = input.picResourceId ?? null;
  let ownerIds = input.ownerResourceIds ? [...new Set(input.ownerResourceIds)] : undefined;
  if (ownerIds) {
    if (leadId && !ownerIds.includes(leadId)) ownerIds = [leadId, ...ownerIds];
    if (!leadId) leadId = ownerIds[0] ?? null;
  }
  return { leadId, ownerIds };
}

export async function createTask(projectId: string, input: UpsertTaskInput, actorId: string) {
  await ensureChartered(projectId);
  await assertBaselineUnlocked(projectId);
  await assertPicResource(input.picResourceId);
  const { leadId, ownerIds } = resolveOwners(input);
  // On create, default the owner set to the lead when no explicit set was sent.
  const createOwnerIds = ownerIds ?? (leadId ? [leadId] : []);
  await assertOwnerResources(createOwnerIds);
  // In a guest's personal tenant a task never links a corporate login account (would leak a corporate
  // identity into the sandbox).
  const picUserId = activeTenantIsPersonal() ? null : (input.picUserId ?? null);

  if (input.parentTaskId) {
    const parent = await prisma.task.findFirst({
      where: { id: input.parentTaskId, projectId },
      select: { id: true },
    });
    if (!parent) throw BadRequest('parentTaskId does not belong to this project');
  }

  const task = await prisma.$transaction(async (tx) => {
    const count = await tx.task.count({ where: { projectId } });
    const wbsCode = input.wbsCode ?? generateTaskCode(count + 1);
    return tx.task.create({
      data: {
        projectId,
        parentTaskId: input.parentTaskId ?? null,
        wbsCode,
        name: input.name,
        description: input.description ?? null,
        deliverable: input.deliverable ?? null,
        acceptanceCriteria: input.acceptanceCriteria ?? null,
        planStart: input.planStart,
        planEnd: input.planEnd,
        actualStart: input.actualStart ?? null,
        actualFinish: input.actualFinish ?? null,
        picUserId,
        picResourceId: leadId,
        owners: { create: createOwnerIds.map((resourceId) => ({ resourceId })) },
        progressPct: input.progressPct,
        weight: input.weight ?? null,
        isMilestone: input.isMilestone,
        sortOrder: input.sortOrder,
      },
    });
  });

  await writeAudit({ projectId, userId: actorId, entity: 'Task', entityId: task.id, action: 'CREATE', after: task });
  return task;
}

export async function updateTask(
  projectId: string,
  taskId: string,
  input: UpsertTaskInput,
  actorId: string,
) {
  const existing = await prisma.task.findFirst({ where: { id: taskId, projectId } });
  if (!existing) throw NotFound('Task not found');
  await assertBaselineUnlocked(projectId);
  await assertPicResource(input.picResourceId);
  const { leadId, ownerIds } = resolveOwners(input);
  if (ownerIds) await assertOwnerResources(ownerIds);
  const picUserId = activeTenantIsPersonal() ? null : (input.picUserId ?? null); // guest tenant never links a login account

  if (input.parentTaskId) {
    if (input.parentTaskId === taskId) throw BadRequest('A task cannot be its own parent');
    const parent = await prisma.task.findFirst({
      where: { id: input.parentTaskId, projectId },
      select: { id: true },
    });
    if (!parent) throw BadRequest('parentTaskId does not belong to this project');

    // Reject reparenting a task under one of its own descendants — that would
    // create a hierarchy cycle, after which buildGanttTree drops the whole cycle
    // (no node is a root) so the subtree vanishes from the Gantt and roll-ups.
    const all = await prisma.task.findMany({ where: { projectId }, select: { id: true, parentTaskId: true } });
    const parentOf = new Map(all.map((t) => [t.id, t.parentTaskId]));
    for (let cursor: string | null = input.parentTaskId, hops = 0; cursor && hops <= all.length; hops++) {
      if (cursor === taskId) throw BadRequest('Cannot move a task under one of its own subtasks');
      cursor = parentOf.get(cursor) ?? null;
    }
  }

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      parentTaskId: input.parentTaskId ?? null,
      wbsCode: input.wbsCode ?? existing.wbsCode,
      name: input.name,
      description: input.description ?? null,
      deliverable: input.deliverable ?? null,
      acceptanceCriteria: input.acceptanceCriteria ?? null,
      planStart: input.planStart,
      planEnd: input.planEnd,
      actualStart: input.actualStart ?? null,
      actualFinish: input.actualFinish ?? null,
      picUserId,
      picResourceId: leadId,
      // Owner links: replace the whole set when the caller sent one. Otherwise leave co-owners
      // untouched, but still fold the (possibly newly-set) lead into the set so an inline lead
      // change can never leave the lead outside `owners` — the invariant the report/export labels
      // rely on. A no-op connectOrCreate when the lead is already an owner.
      ...(ownerIds
        ? { owners: { deleteMany: {}, create: ownerIds.map((resourceId) => ({ resourceId })) } }
        : leadId
          ? { owners: { connectOrCreate: { where: { taskId_resourceId: { taskId, resourceId: leadId } }, create: { resourceId: leadId } } } }
          : {}),
      progressPct: input.progressPct,
      weight: input.weight ?? null,
      isMilestone: input.isMilestone,
      sortOrder: input.sortOrder,
    },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'Task', entityId: taskId, action: 'UPDATE', before: existing, after: task });
  return task;
}

// Update only a task's progress (% complete). Actual dates track progress the way MS Project
// does, so an accidental check is fully reversible by un-checking:
//   • progress > 0  → stamp actualStart (only if not already set — a manual start is kept)
//   • progress = 100 → stamp actualFinish (only if not already set)
//   • progress < 100 → clear actualFinish (the task is no longer finished)
//   • progress ≤ 0  → clear BOTH actuals (the task hasn't started; reverts a mis-click to "—")
// Progress/actuals aren't gated by the baseline lock (they legitimately evolve in execution), so
// this recovery works even after the baseline is locked. To set an actual date to a *specific*
// day, use the inline date field / task editor (setTaskActuals).
export async function setTaskProgress(projectId: string, taskId: string, progressPct: number, actorId: string) {
  const existing = await prisma.task.findFirst({ where: { id: taskId, projectId } });
  if (!existing) throw NotFound('Task not found');

  const now = new Date();
  const data: { progressPct: number; actualStart?: Date | null; actualFinish?: Date | null } = { progressPct };
  if (progressPct <= 0) {
    if (existing.actualStart) data.actualStart = null;
    if (existing.actualFinish) data.actualFinish = null;
  } else {
    if (!existing.actualStart) data.actualStart = now;
    if (progressPct >= 100) {
      if (!existing.actualFinish) data.actualFinish = now;
    } else if (existing.actualFinish) {
      data.actualFinish = null;
    }
  }

  const task = await prisma.task.update({ where: { id: taskId }, data });
  await writeAudit({ projectId, userId: actorId, entity: 'Task', entityId: taskId, action: 'UPDATE', before: { progressPct: existing.progressPct }, after: { progressPct } });
  return task;
}

// List a task's weighted progress steps (ordered).
export async function getTaskSteps(projectId: string, taskId: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, projectId }, select: { id: true } });
  if (!task) throw NotFound('Task not found');
  return prisma.taskStep.findMany({
    where: { taskId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, weight: true, done: true, sortOrder: true },
  });
}

// Replace a task's weighted progress steps, then DERIVE the task's % from the done steps' weights
// and apply it via setTaskProgress (so actual-date stamping + the whole EV/roll-up follow). Steps
// are a progress-measurement tool, so — like progressPct — this is NOT gated by the baseline lock.
// When the steps become empty (cleared), progressPct is left as-is (reverts to manual entry).
export async function setTaskSteps(projectId: string, taskId: string, input: TaskStepsInput, actorId: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, projectId }, select: { id: true } });
  if (!task) throw NotFound('Task not found');

  const steps = input.steps.map((s, i) => ({ ...s, sortOrder: i }));
  await prisma.$transaction([
    prisma.taskStep.deleteMany({ where: { taskId } }),
    ...(steps.length ? [prisma.taskStep.createMany({ data: steps.map((s) => ({ taskId, name: s.name, weight: s.weight, done: s.done, sortOrder: s.sortOrder })) })] : []),
  ]);
  await writeAudit({ projectId, userId: actorId, entity: 'Task', entityId: taskId, action: 'UPDATE', after: { steps: steps.length, stepsDone: steps.filter((s) => s.done).length } });

  // Derive & apply progress only while steps exist; clearing all steps keeps the last value.
  if (steps.length) {
    await setTaskProgress(projectId, taskId, deriveStepProgress(steps), actorId);
  }
  return getTaskSteps(projectId, taskId);
}

// Edit a task's ACTUAL start/finish to a specific date (or clear it with null). This is execution
// tracking, not a baseline change, so — unlike updateTask — it is NOT gated by the baseline lock:
// a PM must be able to correct real dates while the plan stays frozen. Only the fields provided are
// touched; the other is left as-is.
export async function setTaskActuals(projectId: string, taskId: string, input: TaskActualsInput, actorId: string) {
  const existing = await prisma.task.findFirst({ where: { id: taskId, projectId } });
  if (!existing) throw NotFound('Task not found');

  const nextStart = input.actualStart !== undefined ? input.actualStart : existing.actualStart;
  const nextFinish = input.actualFinish !== undefined ? input.actualFinish : existing.actualFinish;
  if (nextStart && nextFinish && nextFinish.getTime() < nextStart.getTime()) {
    throw BadRequest('Actual finish cannot be before actual start');
  }

  const data: { actualStart?: Date | null; actualFinish?: Date | null } = {};
  if (input.actualStart !== undefined) data.actualStart = input.actualStart;
  if (input.actualFinish !== undefined) data.actualFinish = input.actualFinish;

  const task = await prisma.task.update({ where: { id: taskId }, data });
  await writeAudit({
    projectId, userId: actorId, entity: 'Task', entityId: taskId, action: 'UPDATE',
    before: { actualStart: existing.actualStart, actualFinish: existing.actualFinish },
    after: { actualStart: task.actualStart, actualFinish: task.actualFinish },
  });
  return task;
}

// Capture (or re-capture) the schedule baseline: snapshot every task's planned
// dates into baselineStart/baselineFinish AND its work-package weight into baselineWeight,
// then stamp the project. Variance is then current planEnd − baselineFinish; EVM weights against
// the frozen baselineWeight so re-planning weights can't silently re-base EV/% complete.
export async function setScheduleBaseline(projectId: string, actorId: string) {
  await ensureChartered(projectId);
  await assertBaselineUnlocked(projectId);
  const now = new Date();
  // Defense-in-depth: this raw UPDATE bypasses the Prisma tenant-extension, so scope it by hand to
  // the active tenant too — ensureChartered already rejects a cross-tenant projectId, but self-scoping
  // means the write is safe even if a caller ever reaches here without that guard. No-op when
  // enforcement is off (single-tenant): there is no ambient tenantId, so the filter is empty.
  const tenantId = getTenantStore()?.tenantId;
  const tenantFilter = tenantId ? Prisma.sql` AND "tenantId" = ${tenantId}` : Prisma.empty;
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE "Task" SET "baselineStart" = "planStart", "baselineFinish" = "planEnd", "baselineWeight" = "weight" WHERE "projectId" = ${projectId}${tenantFilter}`,
    prisma.project.update({ where: { id: projectId }, data: { scheduleBaselinedAt: now } }),
  ]);
  await writeAudit({ projectId, userId: actorId, entity: 'Project', entityId: projectId, action: 'UPDATE', after: { scheduleBaselinedAt: now } });
  return { baselinedAt: now };
}

// Delete a task and its whole subtree; unlink manpower and drop dependencies.
// Expand a set of root task ids to the full set of ids to remove (each root + all its descendants).
// PURE given the (id, parentTaskId) list. Dedupes, so overlapping roots (a phase + one of its tasks)
// are handled once.
function collectSubtrees(all: { id: string; parentTaskId: string | null }[], roots: string[]): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const t of all) {
    if (t.parentTaskId) {
      if (!childrenOf.has(t.parentTaskId)) childrenOf.set(t.parentTaskId, []);
      childrenOf.get(t.parentTaskId)!.push(t.id);
    }
  }
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return [...seen];
}

// Delete a set of tasks (each expanded to its subtree) in one transaction: unlink cost lines, drop
// dependencies touching them, then remove the tasks. assertBaselineUnlocked already checked by callers
// that gate on it; the standalone routes assert it here.
async function removeTasks(projectId: string, ids: string[], actorId: string, entityId: string) {
  if (ids.length === 0) return { deleted: 0 };
  await prisma.$transaction([
    prisma.costItemDirect.updateMany({ where: { taskId: { in: ids } }, data: { taskId: null } }),
    prisma.taskDependency.deleteMany({
      where: { OR: [{ predecessorId: { in: ids } }, { successorId: { in: ids } }] },
    }),
    prisma.task.deleteMany({ where: { id: { in: ids } } }),
  ]);
  await writeAudit({ projectId, userId: actorId, entity: 'Task', entityId, action: 'DELETE', before: { deletedIds: ids } });
  return { deleted: ids.length };
}

export async function deleteTask(projectId: string, taskId: string, actorId: string) {
  const all = await prisma.task.findMany({ where: { projectId }, select: { id: true, parentTaskId: true } });
  if (!all.some((t) => t.id === taskId)) throw NotFound('Task not found');
  await assertBaselineUnlocked(projectId);
  return removeTasks(projectId, collectSubtrees(all, [taskId]), actorId, taskId);
}

// Bulk delete: every selected task plus its descendants, in one transaction. Ids not in the project
// are ignored (idempotent). Captures an undo entry. Used by "delete selected" in the WBS multi-select.
export async function bulkDeleteTasks(projectId: string, ids: string[], actorId: string) {
  const all = await prisma.task.findMany({ where: { projectId }, select: { id: true, parentTaskId: true } });
  const present = new Set(all.map((t) => t.id));
  const roots = ids.filter((id) => present.has(id));
  if (roots.length === 0) return { deleted: 0, undo: await getUndoState(projectId) };
  await assertBaselineUnlocked(projectId);
  const expanded = collectSubtrees(all, roots);
  return deleteWithUndo(projectId, expanded, 'BULK_DELETE', actorId);
}

// Clear the whole schedule (delete every task in the project). Strong-confirmed on the client.
export async function clearSchedule(projectId: string, actorId: string) {
  const all = await prisma.task.findMany({ where: { projectId }, select: { id: true } });
  if (all.length === 0) return { deleted: 0, undo: await getUndoState(projectId) };
  await assertBaselineUnlocked(projectId);
  return deleteWithUndo(projectId, all.map((t) => t.id), 'CLEAR', actorId);
}

// =====================================================================
// Undo / Redo for the bulk-cleanup ops. A bounded, per-project stack: each entry snapshots exactly
// what the op removed (so Undo can recreate it) + the expanded id set (so Redo can re-delete it),
// bracketed by schedule fingerprints so the stack self-invalidates when anything else edits the
// schedule. See the ScheduleUndo model.
// =====================================================================

const UNDO_STACK_CAP = 10;

// Recreatable task fields (no tenantId / createdAt / updatedAt — those are re-derived on create).
const TASK_SNAPSHOT_SELECT = {
  id: true, parentTaskId: true, wbsCode: true, name: true, description: true, deliverable: true,
  acceptanceCriteria: true, planStart: true, planEnd: true, baselineStart: true, baselineFinish: true,
  actualStart: true, actualFinish: true, picUserId: true, picResourceId: true, progressPct: true,
  weight: true, baselineWeight: true, isMilestone: true, sortOrder: true,
} as const;

interface RemovedSnapshot {
  tasks: Array<Record<string, unknown>>;
  deps: Array<{ predecessorId: string; successorId: string; type: string; lagDays: number }>;
  owners: Array<{ taskId: string; resourceId: string }>;
  steps: Array<{ id: string; taskId: string; name: string; weight: number; done: boolean; sortOrder: number }>;
  reqLinks: Array<{ id: string; requirementId: string; taskId: string }>;
  costLinks: Array<{ id: string; taskId: string }>;
}

// Fingerprint the schedule (tasks + dependencies) so the undo stack self-invalidates on any change.
async function scheduleSignature(projectId: string): Promise<string> {
  const [tasks, deps] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, select: { id: true, parentTaskId: true, wbsCode: true, name: true, planStart: true, planEnd: true, progressPct: true, weight: true, isMilestone: true, sortOrder: true }, orderBy: { id: 'asc' } }),
    prisma.taskDependency.findMany({ where: { predecessor: { projectId } }, select: { predecessorId: true, successorId: true, type: true, lagDays: true }, orderBy: [{ predecessorId: 'asc' }, { successorId: 'asc' }] }),
  ]);
  return createHash('sha1').update(JSON.stringify({ tasks, deps })).digest('hex');
}

// Snapshot everything that removing `ids` (already the expanded subtree set) destroys.
async function captureRemoved(projectId: string, ids: string[]): Promise<RemovedSnapshot> {
  const [tasks, deps, owners, steps, reqLinks, costLinks] = await Promise.all([
    prisma.task.findMany({ where: { id: { in: ids } }, select: TASK_SNAPSHOT_SELECT }),
    prisma.taskDependency.findMany({ where: { OR: [{ predecessorId: { in: ids } }, { successorId: { in: ids } }] }, select: { predecessorId: true, successorId: true, type: true, lagDays: true } }),
    prisma.taskOwner.findMany({ where: { taskId: { in: ids } }, select: { taskId: true, resourceId: true } }),
    prisma.taskStep.findMany({ where: { taskId: { in: ids } }, select: { id: true, taskId: true, name: true, weight: true, done: true, sortOrder: true } }),
    prisma.requirementTaskLink.findMany({ where: { taskId: { in: ids } }, select: { id: true, requirementId: true, taskId: true } }),
    prisma.costItemDirect.findMany({ where: { taskId: { in: ids } }, select: { id: true, taskId: true } }),
  ]);
  return {
    tasks: tasks as Array<Record<string, unknown>>,
    deps: deps.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId, type: d.type as string, lagDays: d.lagDays })),
    owners, steps,
    reqLinks,
    costLinks: costLinks.map((c) => ({ id: c.id, taskId: c.taskId! })),
  };
}

const UNDO_DATE_FIELDS = ['planStart', 'planEnd', 'baselineStart', 'baselineFinish', 'actualStart', 'actualFinish'];

// Recreate a captured snapshot (Undo). Tasks are inserted parents-first for the self-referencing FK;
// dependencies / owners / steps / requirement links are re-created and cost lines re-linked.
async function restoreRemoved(projectId: string, removed: RemovedSnapshot): Promise<void> {
  const byId = new Map(removed.tasks.map((t) => [t.id as string, t]));
  const depthOf = (t: Record<string, unknown>): number => {
    let d = 0; let p = t.parentTaskId as string | null; const seen = new Set<string>();
    while (p && byId.has(p) && !seen.has(p)) { seen.add(p); d++; p = byId.get(p)!.parentTaskId as string | null; }
    return d;
  };
  const taskData = [...removed.tasks]
    .sort((a, b) => depthOf(a) - depthOf(b))
    .map((t) => { const o: Record<string, unknown> = { ...t, projectId }; for (const f of UNDO_DATE_FIELDS) if (o[f] != null) o[f] = new Date(o[f] as string); return o; });

  await prisma.$transaction([
    prisma.task.createMany({ data: taskData as never }),
    ...(removed.deps.length ? [prisma.taskDependency.createMany({ data: removed.deps as never })] : []),
    ...(removed.owners.length ? [prisma.taskOwner.createMany({ data: removed.owners })] : []),
    ...(removed.steps.length ? [prisma.taskStep.createMany({ data: removed.steps })] : []),
    ...(removed.reqLinks.length ? [prisma.requirementTaskLink.createMany({ data: removed.reqLinks })] : []),
    ...removed.costLinks.map((cl) => prisma.costItemDirect.update({ where: { id: cl.id }, data: { taskId: cl.taskId } })),
  ]);
}

// Delete `ids` and record an undo entry (snapshot before + fingerprints + expanded ids for redo).
async function deleteWithUndo(projectId: string, ids: string[], kind: 'BULK_DELETE' | 'CLEAR', actorId: string) {
  const sigBefore = await scheduleSignature(projectId);
  const removed = await captureRemoved(projectId, ids);
  const res = await removeTasks(projectId, ids, actorId, projectId);
  const sigAfter = await scheduleSignature(projectId);
  const label = kind === 'CLEAR' ? 'Clear timeline' : `Delete ${res.deleted} task${res.deleted === 1 ? '' : 's'}`;

  const rows = await prisma.scheduleUndo.findMany({ where: { projectId }, select: { id: true, seq: true, undone: true } });
  const redoTail = rows.filter((r) => r.undone).map((r) => r.id); // a new op discards the redo tail
  const maxSeq = rows.reduce((m, r) => Math.max(m, r.seq), 0);
  await prisma.$transaction([
    ...(redoTail.length ? [prisma.scheduleUndo.deleteMany({ where: { id: { in: redoTail } } })] : []),
    prisma.scheduleUndo.create({ data: { projectId, seq: maxSeq + 1, kind, label, ids, removedJson: removed as never, sigBefore, sigAfter, createdBy: actorId } }),
  ]);
  const overflow = await prisma.scheduleUndo.findMany({ where: { projectId }, orderBy: { seq: 'desc' }, skip: UNDO_STACK_CAP, select: { id: true } });
  if (overflow.length) await prisma.scheduleUndo.deleteMany({ where: { id: { in: overflow.map((o) => o.id) } } });

  return { ...res, undo: await getUndoState(projectId) };
}

// Button state for the client: is there a live (non-stale) undo / redo, and its label.
export async function getUndoState(projectId: string) {
  const [undoRow, redoRow, sig] = await Promise.all([
    prisma.scheduleUndo.findFirst({ where: { projectId, undone: false }, orderBy: { seq: 'desc' }, select: { label: true, sigAfter: true } }),
    prisma.scheduleUndo.findFirst({ where: { projectId, undone: true }, orderBy: { seq: 'asc' }, select: { label: true, sigBefore: true } }),
    scheduleSignature(projectId),
  ]);
  const canUndo = !!undoRow && undoRow.sigAfter === sig;
  const canRedo = !!redoRow && redoRow.sigBefore === sig;
  return { canUndo, canRedo, undoLabel: canUndo ? undoRow!.label : null, redoLabel: canRedo ? redoRow!.label : null };
}

export async function undoSchedule(projectId: string, actorId: string) {
  await assertBaselineUnlocked(projectId);
  const row = await prisma.scheduleUndo.findFirst({ where: { projectId, undone: false }, orderBy: { seq: 'desc' } });
  if (!row) throw BadRequest('Nothing to undo');
  if ((await scheduleSignature(projectId)) !== row.sigAfter) {
    await prisma.scheduleUndo.deleteMany({ where: { projectId } });
    throw Conflict('The schedule changed since — undo history was cleared');
  }
  await restoreRemoved(projectId, row.removedJson as unknown as RemovedSnapshot);
  await prisma.scheduleUndo.update({ where: { id: row.id }, data: { undone: true } });
  await writeAudit({ projectId, userId: actorId, entity: 'Task', entityId: projectId, action: 'UPDATE', after: { undo: row.label } });
  return { restored: (row.removedJson as unknown as RemovedSnapshot).tasks.length, undo: await getUndoState(projectId) };
}

export async function redoSchedule(projectId: string, actorId: string) {
  await assertBaselineUnlocked(projectId);
  const row = await prisma.scheduleUndo.findFirst({ where: { projectId, undone: true }, orderBy: { seq: 'asc' } });
  if (!row) throw BadRequest('Nothing to redo');
  if ((await scheduleSignature(projectId)) !== row.sigBefore) {
    await prisma.scheduleUndo.deleteMany({ where: { projectId } });
    throw Conflict('The schedule changed since — undo history was cleared');
  }
  const res = await removeTasks(projectId, row.ids, actorId, projectId);
  await prisma.scheduleUndo.update({ where: { id: row.id }, data: { undone: false } });
  return { ...res, undo: await getUndoState(projectId) };
}

// --- Dependencies ---

export async function addDependency(
  projectId: string,
  successorId: string,
  input: DependencyInput,
  actorId: string,
) {
  if (successorId === input.predecessorId) throw BadRequest('A task cannot depend on itself');
  await assertBaselineUnlocked(projectId);

  const tasks = await prisma.task.findMany({ where: { projectId }, select: { id: true } });
  const ids = new Set(tasks.map((t) => t.id));
  if (!ids.has(successorId) || !ids.has(input.predecessorId)) {
    throw BadRequest('Both tasks must belong to this project');
  }

  const existing = await prisma.taskDependency.findMany({
    where: { predecessor: { projectId } },
    select: { predecessorId: true, successorId: true },
  });

  const edges: DependencyEdge[] = existing.map((e) => ({ from: e.predecessorId, to: e.successorId }));
  edges.push({ from: input.predecessorId, to: successorId });
  if (hasDependencyCycle(edges)) {
    throw Conflict('This dependency would create a cycle');
  }

  const dep = await prisma.taskDependency.create({
    data: {
      predecessorId: input.predecessorId,
      successorId,
      type: input.type,
      lagDays: input.lagDays,
    },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'TaskDependency', entityId: dep.id, action: 'CREATE', after: dep });
  return dep;
}

// --- Auto-scheduling (weekend-aware dependency propagation) ---

export interface AutoMoveRow {
  id: string;
  wbsCode: string;
  name: string;
  fromStart: Date;
  fromEnd: Date;
  toStart: Date;
  toEnd: Date;
}
export interface AutoScheduleOutcome {
  cyclic: boolean;
  moved: AutoMoveRow[];
}

/**
 * Recompute leaf task dates so every FS/SS/FF/SF dependency is honoured, pushing
 * only successors that currently violate a constraint (see autoSchedule). Persists
 * the moved rows (unless `dryRun`) and returns them for the UI. Callers that gate on
 * the baseline lock (updateTask/addDependency) have already asserted it; the
 * standalone /reschedule apply path asserts it here.
 */
export async function applyAutoSchedule(
  projectId: string,
  opts: { dryRun?: boolean; actorId?: string; mode?: AutoScheduleMode } = {},
): Promise<AutoScheduleOutcome> {
  const [tasks, deps] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, select: { id: true, parentTaskId: true, wbsCode: true, name: true, planStart: true, planEnd: true } }),
    prisma.taskDependency.findMany({ where: { predecessor: { projectId } }, select: { predecessorId: true, successorId: true, type: true, lagDays: true } }),
  ]);
  // Only leaf tasks carry real dates; parents roll up (mirror getCpm).
  const parentIds = new Set(tasks.map((t) => t.parentTaskId).filter(Boolean) as string[]);
  const leaves = tasks.filter((t) => !parentIds.has(t.id));
  const byId = new Map(leaves.map((t) => [t.id, t]));

  const result = autoSchedule(
    leaves.map<AutoTaskInput>((t) => ({ id: t.id, planStart: t.planStart, planEnd: t.planEnd })),
    deps.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId, type: d.type as CpmDepType, lagDays: d.lagDays })),
    opts.mode ?? 'push',
  );

  const moved: AutoMoveRow[] = result.moved.map((id) => {
    const t = byId.get(id)!;
    const r = result.tasks[id];
    return { id, wbsCode: t.wbsCode, name: t.name, fromStart: t.planStart, fromEnd: t.planEnd, toStart: new Date(r.start), toEnd: new Date(r.end) };
  });

  if (opts.dryRun || moved.length === 0) return { cyclic: result.cyclic, moved };

  await assertBaselineUnlocked(projectId);
  await prisma.$transaction(
    moved.map((m) => prisma.task.update({ where: { id: m.id }, data: { planStart: m.toStart, planEnd: m.toEnd } })),
  );
  if (opts.actorId) {
    await writeAudit({
      projectId, userId: opts.actorId, entity: 'Task', entityId: projectId, action: 'UPDATE',
      after: { autoReschedule: moved.map((m) => ({ id: m.id, wbsCode: m.wbsCode, toStart: m.toStart, toEnd: m.toEnd })) },
    });
  }
  return { cyclic: result.cyclic, moved };
}

export async function updateDependency(
  projectId: string,
  depId: string,
  input: DependencyEditInput,
  actorId: string,
) {
  const dep = await prisma.taskDependency.findFirst({
    where: { id: depId, predecessor: { projectId } },
  });
  if (!dep) throw NotFound('Dependency not found');
  await assertBaselineUnlocked(projectId);
  const updated = await prisma.taskDependency.update({
    where: { id: depId },
    data: { type: input.type, lagDays: input.lagDays },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'TaskDependency', entityId: depId, action: 'UPDATE', before: dep, after: updated });
  return updated;
}

export async function deleteDependency(projectId: string, depId: string, actorId: string) {
  const dep = await prisma.taskDependency.findFirst({
    where: { id: depId, predecessor: { projectId } },
  });
  if (!dep) throw NotFound('Dependency not found');
  await assertBaselineUnlocked(projectId);
  await prisma.taskDependency.delete({ where: { id: depId } });
  await writeAudit({ projectId, userId: actorId, entity: 'TaskDependency', entityId: depId, action: 'DELETE', before: dep });
}

// --- Manpower sync & EVM ---

export async function getManpowerSync(projectId: string) {
  const [tasks, mp] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, select: { id: true, name: true, planStart: true, planEnd: true } }),
    manpowerByTask(projectId),
  ]);
  return reconcileManpower(
    tasks.map((t) => ({
      taskId: t.id,
      taskName: t.name,
      planStart: t.planStart,
      planEnd: t.planEnd,
      linkedPlanMandays: mp.mandays.get(t.id) ?? 0,
    })),
  );
}

// Raw task columns needed for predictive EVM. Kept minimal so the batched portfolio
// path (evm.batch.ts) can select exactly these across many projects in one query.
export interface EvmTaskRow {
  id: string;
  parentTaskId: string | null;
  planStart: Date;
  planEnd: Date;
  progressPct: number;
  /** Manual relative weight (Model B) — overrides the cost/duration proxy when set. */
  weight: number | null;
  /** PMB snapshot of `weight` at baseline capture — EVM weights against this once baselined. */
  baselineWeight: number | null;
  baselineStart: Date | null;
  baselineFinish: Date | null;
  /** Actual schedule window — used by the timeline-based progress series (ignored by evmFromRows). */
  actualStart?: Date | null;
  actualFinish?: Date | null;
}

export interface EvmRows {
  tasks: EvmTaskRow[];
  costByTask: Map<string, number>;
  actualCost: number;
  scheduleBaselinedAt: Date | null;
  costBaselineBAC: number;
  statusDate: Date;
}

/**
 * PURE predictive EVM from already-loaded rows: leaf tasks only (avoid double-counting
 * parents), budget per leaf = Σ linked direct cost (cost-weighted) or duration (fallback).
 * The single-project loader (getEvm) and the batched portfolio path (computeEvmForProjects)
 * both funnel through this ONE function, so their EVM numbers are identical by construction.
 */
export function evmFromRows(r: EvmRows) {
  const { tasks, costByTask, actualCost, scheduleBaselinedAt, costBaselineBAC, statusDate } = r;

  const parentIds = new Set(tasks.filter((t) => t.parentTaskId).map((t) => t.parentTaskId!));
  const leaves = tasks.filter((t) => !parentIds.has(t.id));

  // Schedule finish variance vs baseline: latest current finish − latest baseline finish.
  const DAY = 86_400_000;
  const curFinish = leaves.length ? Math.max(...leaves.map((t) => +t.planEnd)) : null;
  const baseFins = leaves.map((t) => (t.baselineFinish ? +t.baselineFinish : null)).filter((x): x is number => x != null);
  const baseFinish = baseFins.length ? Math.max(...baseFins) : null;
  const finishVarianceDays = curFinish != null && baseFinish != null ? Math.round((curFinish - baseFinish) / DAY) : null;

  // Work-package weights for EVM & progress roll-up: use linked direct cost (classic
  // cost-weighted EVM — the full BAC is distributed pro-rata across these leaves) ONLY when
  // the WBS is FULLY cost-loaded; otherwise fall back to task DURATION. A partially costed
  // WBS must not switch to cost weighting, or its uncosted leaves collapse to weight 0 and
  // disappear from EV/%complete (overstating progress — see isCostLoaded).
  const leafDur = new Map(leaves.map((t) => [t.id, durationDays(t.planStart, t.planEnd)]));
  const costLoaded = isCostLoaded(leaves.map((t) => ({ cost: costByTask.get(t.id) ?? 0, durationDays: leafDur.get(t.id)! })));
  // Fallback proxy per leaf: linked cost when fully cost-loaded, else duration. All-milestone
  // (every proxy 0) → equal weight so no leaf collapses to 0 and vanishes from EV/%complete.
  const leafProxy = new Map(leaves.map((t) => [t.id, costLoaded ? (costByTask.get(t.id) ?? 0) : leafDur.get(t.id)!]));
  if ([...leafProxy.values()].every((v) => v === 0)) for (const k of leafProxy.keys()) leafProxy.set(k, 1);

  // Effective leaf weights honour manual `weight` overrides (Model B): a Main Task's weight is
  // distributed across its leaves pro-rata by proxy. A weight-free WBS reproduces `leafProxy`
  // EXACTLY, so EV/PV/CPI/SPI are unchanged for every project that doesn't opt in.
  // Once a schedule baseline exists, weight against the FROZEN `baselineWeight` (the PMB
  // snapshot) — same principle as measuring PV against baseline dates: re-planning weights must
  // not silently re-base EV/% complete. Re-capturing the baseline refreshes baselineWeight.
  const baselined = !!scheduleBaselinedAt;
  const leafWeight = computeLeafWeights(
    tasks.map((t) => ({ id: t.id, parentTaskId: t.parentTaskId, weight: baselined ? t.baselineWeight : t.weight, proxy: leafProxy.get(t.id) ?? 0 })),
  );
  const evmTasks: EvmTask[] = leaves.map((t) => ({
    budgetCost: leafWeight.get(t.id) ?? 0,
    progressPct: t.progressPct,
    planStart: t.planStart,
    planEnd: t.planEnd,
    // PV is measured against the baseline window when one exists (see plannedProgress).
    baselineStart: t.baselineStart,
    baselineEnd: t.baselineFinish,
  }));
  const totalWeight = evmTasks.reduce((s, t) => s + t.budgetCost, 0);

  // Authoritative BAC = the Performance Measurement Baseline (PMB): direct +
  // indirect + contingency reserve. Management reserve is NOT part of the PMB, so
  // it is excluded from BAC (PMI). When absent, computeEvm derives BAC from Σ
  // weights so EV/PV still scale sensibly.
  const evm = computeEvm({
    tasks: evmTasks,
    bac: costBaselineBAC > 0 ? costBaselineBAC : undefined,
    actualCost,
    statusDate,
  });

  // Physical % complete (0..1) — weight-weighted progress, valid even with no cost.
  // Aligned with the WBS: duration-weighted when uncosted, budget-weighted when costed.
  const scheduleProgress = evm.weightedProgress;

  return {
    ...evm,
    scheduleProgress,
    scheduleWeight: totalWeight,
    costBaselineBAC,
    leafTaskCount: leaves.length,
    scheduleBaselinedAt,
    baselineFinish: baseFinish ? new Date(baseFinish).toISOString() : null,
    currentFinish: curFinish ? new Date(curFinish).toISOString() : null,
    finishVarianceDays,
  };
}

export type PredictiveEvm = ReturnType<typeof evmFromRows>;

/**
 * EVM from the schedule: leaf tasks only (avoid double-counting parents),
 * budget per task = Σ linked manpower cost, AC supplied (manual, MVP).
 */
export async function getEvm(projectId: string, actualCost: number | undefined, statusDate: Date) {
  const [tasks, costByTask, resolvedAc, project, baseline] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, select: { id: true, parentTaskId: true, planStart: true, planEnd: true, progressPct: true, weight: true, baselineWeight: true, baselineStart: true, baselineFinish: true } }),
    directCostByTask(projectId),
    // Use the explicit override if provided, else the stored time-phased AC.
    actualCost !== undefined ? Promise.resolve(actualCost) : actualCostAsOf(projectId, statusDate),
    prisma.project.findUnique({ where: { id: projectId }, select: { scheduleBaselinedAt: true } }),
    prisma.costBaseline.findUnique({ where: { projectId }, select: { costBaseline: true } }),
  ]);

  return evmFromRows({
    tasks,
    costByTask,
    actualCost: resolvedAc,
    scheduleBaselinedAt: project?.scheduleBaselinedAt ?? null,
    costBaselineBAC: dec(baseline?.costBaseline),
    statusDate,
  });
}
