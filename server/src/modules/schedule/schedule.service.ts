import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, Conflict, NotFound } from '../../lib/errors.js';
import { computeEvm, type EvmTask } from '../../calc/evm.js';
import { actualCostAsOf } from '../cost/cost.service.js';
import { assertBaselineUnlocked } from '../projects/baseline.service.js';
import {
  durationDays,
  generateTaskCode,
  buildGanttTree,
  hasDependencyCycle,
  reconcileManpower,
  isCostLoaded,
  type DependencyEdge,
} from './schedule.helpers.js';
import type { DependencyInput, UpsertTaskInput } from './schedule.schemas.js';

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

// Gantt payload: nested tree enriched with duration & linked manpower cost.
export async function getGantt(projectId: string) {
  const [tasks, deps, mp, project] = await Promise.all([
    prisma.task.findMany({
      where: { projectId },
      include: {
        pic: { select: { id: true, name: true } },
        picResource: { select: { id: true, name: true } },
      },
    }),
    prisma.taskDependency.findMany({ where: { predecessor: { projectId } } }),
    manpowerByTask(projectId),
    prisma.project.findUnique({ where: { id: projectId }, select: { scheduleBaselinedAt: true } }),
  ]);

  const enriched = tasks.map((t) => ({
    ...t,
    durationDays: durationDays(t.planStart, t.planEnd),
    budgetCost: mp.cost.get(t.id) ?? 0,
    linkedPlanMandays: mp.mandays.get(t.id) ?? 0,
  }));

  return { tree: buildGanttTree(enriched), dependencies: deps, baselinedAt: project?.scheduleBaselinedAt ?? null };
}

export async function createTask(projectId: string, input: UpsertTaskInput, actorId: string) {
  await ensureChartered(projectId);
  await assertBaselineUnlocked(projectId);

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
        picUserId: input.picUserId ?? null,
        picResourceId: input.picResourceId ?? null,
        progressPct: input.progressPct,
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
      picUserId: input.picUserId ?? null,
      picResourceId: input.picResourceId ?? null,
      progressPct: input.progressPct,
      isMilestone: input.isMilestone,
      sortOrder: input.sortOrder,
    },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'Task', entityId: taskId, action: 'UPDATE', before: existing, after: task });
  return task;
}

// Update only a task's progress (% complete). Also keeps actual dates sensible:
// first progress stamps actualStart; reaching 100% stamps actualFinish; dropping
// below 100% clears it.
export async function setTaskProgress(projectId: string, taskId: string, progressPct: number, actorId: string) {
  const existing = await prisma.task.findFirst({ where: { id: taskId, projectId } });
  if (!existing) throw NotFound('Task not found');

  const now = new Date();
  const data: { progressPct: number; actualStart?: Date; actualFinish?: Date | null } = { progressPct };
  if (progressPct > 0 && !existing.actualStart) data.actualStart = now;
  if (progressPct >= 100) data.actualFinish = existing.actualFinish ?? now;
  else if (existing.actualFinish) data.actualFinish = null;

  const task = await prisma.task.update({ where: { id: taskId }, data });
  await writeAudit({ projectId, userId: actorId, entity: 'Task', entityId: taskId, action: 'UPDATE', before: { progressPct: existing.progressPct }, after: { progressPct } });
  return task;
}

// Capture (or re-capture) the schedule baseline: snapshot every task's planned
// dates into baselineStart/baselineFinish and stamp the project. Variance is then
// current planEnd − baselineFinish.
export async function setScheduleBaseline(projectId: string, actorId: string) {
  await ensureChartered(projectId);
  await assertBaselineUnlocked(projectId);
  const now = new Date();
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE "Task" SET "baselineStart" = "planStart", "baselineFinish" = "planEnd" WHERE "projectId" = ${projectId}`,
    prisma.project.update({ where: { id: projectId }, data: { scheduleBaselinedAt: now } }),
  ]);
  await writeAudit({ projectId, userId: actorId, entity: 'Project', entityId: projectId, action: 'UPDATE', after: { scheduleBaselinedAt: now } });
  return { baselinedAt: now };
}

// Delete a task and its whole subtree; unlink manpower and drop dependencies.
export async function deleteTask(projectId: string, taskId: string, actorId: string) {
  const all = await prisma.task.findMany({ where: { projectId }, select: { id: true, parentTaskId: true } });
  const existing = all.find((t) => t.id === taskId);
  if (!existing) throw NotFound('Task not found');
  await assertBaselineUnlocked(projectId);

  // Collect the subtree (the task + all descendants).
  const childrenOf = new Map<string, string[]>();
  for (const t of all) {
    if (t.parentTaskId) {
      if (!childrenOf.has(t.parentTaskId)) childrenOf.set(t.parentTaskId, []);
      childrenOf.get(t.parentTaskId)!.push(t.id);
    }
  }
  const toDelete: string[] = [];
  const stack = [taskId];
  while (stack.length) {
    const id = stack.pop()!;
    toDelete.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }

  await prisma.$transaction([
    prisma.costItemDirect.updateMany({ where: { taskId: { in: toDelete } }, data: { taskId: null } }),
    prisma.taskDependency.deleteMany({
      where: { OR: [{ predecessorId: { in: toDelete } }, { successorId: { in: toDelete } }] },
    }),
    prisma.task.deleteMany({ where: { id: { in: toDelete } } }),
  ]);

  await writeAudit({ projectId, userId: actorId, entity: 'Task', entityId: taskId, action: 'DELETE', before: { deletedIds: toDelete } });
  return { deleted: toDelete.length };
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

/**
 * EVM from the schedule: leaf tasks only (avoid double-counting parents),
 * budget per task = Σ linked manpower cost, AC supplied (manual, MVP).
 */
export async function getEvm(projectId: string, actualCost: number | undefined, statusDate: Date) {
  const [tasks, costByTask, resolvedAc, project] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, select: { id: true, parentTaskId: true, planStart: true, planEnd: true, progressPct: true, baselineStart: true, baselineFinish: true } }),
    directCostByTask(projectId),
    // Use the explicit override if provided, else the stored time-phased AC.
    actualCost !== undefined ? Promise.resolve(actualCost) : actualCostAsOf(projectId, statusDate),
    prisma.project.findUnique({ where: { id: projectId }, select: { scheduleBaselinedAt: true } }),
  ]);

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
  const evmTasks: EvmTask[] = leaves.map((t) => ({
    budgetCost: costLoaded ? (costByTask.get(t.id) ?? 0) : leafDur.get(t.id)!,
    progressPct: t.progressPct,
    planStart: t.planStart,
    planEnd: t.planEnd,
    // PV is measured against the baseline window when one exists (see plannedProgress).
    baselineStart: t.baselineStart,
    baselineEnd: t.baselineFinish,
  }));
  // All-milestone projects have zero duration everywhere → weight each leaf equally.
  if (!costLoaded && evmTasks.every((t) => t.budgetCost === 0)) {
    for (const t of evmTasks) t.budgetCost = 1;
  }
  const totalWeight = evmTasks.reduce((s, t) => s + t.budgetCost, 0);

  // Authoritative BAC = the Performance Measurement Baseline (PMB): direct +
  // indirect + contingency reserve. Management reserve is NOT part of the PMB, so
  // it is excluded from BAC (PMI). When absent, computeEvm derives BAC from Σ
  // weights so EV/PV still scale sensibly.
  const baseline = await prisma.costBaseline.findUnique({
    where: { projectId },
    select: { costBaseline: true },
  });
  const costBaselineBAC = dec(baseline?.costBaseline);

  const evm = computeEvm({
    tasks: evmTasks,
    bac: costBaselineBAC > 0 ? costBaselineBAC : undefined,
    actualCost: resolvedAc,
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
    scheduleBaselinedAt: project?.scheduleBaselinedAt ?? null,
    baselineFinish: baseFinish ? new Date(baseFinish).toISOString() : null,
    currentFinish: curFinish ? new Date(curFinish).toISOString() : null,
    finishVarianceDays,
  };
}
