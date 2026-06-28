import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, Conflict, NotFound } from '../../lib/errors.js';
import { computeEvm, type EvmTask } from '../../calc/evm.js';
import { actualCostAsOf } from '../cost/cost.service.js';
import {
  durationDays,
  generateTaskCode,
  buildGanttTree,
  hasDependencyCycle,
  reconcileManpower,
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
  const [tasks, deps, mp] = await Promise.all([
    prisma.task.findMany({
      where: { projectId },
      include: { pic: { select: { id: true, name: true } } },
    }),
    prisma.taskDependency.findMany({ where: { predecessor: { projectId } } }),
    manpowerByTask(projectId),
  ]);

  const enriched = tasks.map((t) => ({
    ...t,
    durationDays: durationDays(t.planStart, t.planEnd),
    budgetCost: mp.cost.get(t.id) ?? 0,
    linkedPlanMandays: mp.mandays.get(t.id) ?? 0,
  }));

  return { tree: buildGanttTree(enriched), dependencies: deps };
}

export async function createTask(projectId: string, input: UpsertTaskInput, actorId: string) {
  await ensureChartered(projectId);

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
        planStart: input.planStart,
        planEnd: input.planEnd,
        actualStart: input.actualStart ?? null,
        actualFinish: input.actualFinish ?? null,
        picUserId: input.picUserId ?? null,
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

  if (input.parentTaskId) {
    if (input.parentTaskId === taskId) throw BadRequest('A task cannot be its own parent');
    const parent = await prisma.task.findFirst({
      where: { id: input.parentTaskId, projectId },
      select: { id: true },
    });
    if (!parent) throw BadRequest('parentTaskId does not belong to this project');
  }

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      parentTaskId: input.parentTaskId ?? null,
      wbsCode: input.wbsCode ?? existing.wbsCode,
      name: input.name,
      planStart: input.planStart,
      planEnd: input.planEnd,
      actualStart: input.actualStart ?? null,
      actualFinish: input.actualFinish ?? null,
      picUserId: input.picUserId ?? null,
      progressPct: input.progressPct,
      isMilestone: input.isMilestone,
      sortOrder: input.sortOrder,
    },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'Task', entityId: taskId, action: 'UPDATE', before: existing, after: task });
  return task;
}

// Delete a task and its whole subtree; unlink manpower and drop dependencies.
export async function deleteTask(projectId: string, taskId: string, actorId: string) {
  const all = await prisma.task.findMany({ where: { projectId }, select: { id: true, parentTaskId: true } });
  const existing = all.find((t) => t.id === taskId);
  if (!existing) throw NotFound('Task not found');

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
  const [tasks, mp, resolvedAc] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, select: { id: true, parentTaskId: true, planStart: true, planEnd: true, progressPct: true } }),
    manpowerByTask(projectId),
    // Use the explicit override if provided, else the stored time-phased AC.
    actualCost !== undefined ? Promise.resolve(actualCost) : actualCostAsOf(projectId, statusDate),
  ]);

  const parentIds = new Set(tasks.filter((t) => t.parentTaskId).map((t) => t.parentTaskId!));
  const leaves = tasks.filter((t) => !parentIds.has(t.id));

  const evmTasks: EvmTask[] = leaves.map((t) => ({
    budgetCost: mp.cost.get(t.id) ?? 0,
    progressPct: t.progressPct,
    planStart: t.planStart,
    planEnd: t.planEnd,
  }));

  const evm = computeEvm({ tasks: evmTasks, actualCost: resolvedAc, statusDate });

  // Provide the cost-baseline BAC alongside the schedule-derived BAC for reference.
  const baseline = await prisma.costBaseline.findUnique({
    where: { projectId },
    select: { budgetAtCompletion: true },
  });

  return { ...evm, costBaselineBAC: dec(baseline?.budgetAtCompletion), leafTaskCount: leaves.length };
}
