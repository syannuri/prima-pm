import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
import type { BacklogItemInput, SprintInput } from './agile.schemas.js';

// Full agile board payload: sprints + backlog items (with assignee) + burndown snapshots.
export async function getAgile(projectId: string) {
  const [sprints, items] = await Promise.all([
    prisma.sprint.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.backlogItem.findMany({
      where: { projectId },
      orderBy: [{ priority: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { assignee: { select: { id: true, name: true } } },
    }),
  ]);
  // Passively record today's burndown snapshot for ACTIVE sprints (deduped per day).
  await recordSnapshots(sprints, items).catch((e) => console.error('[agile] snapshot failed', e));
  const snapshots = await prisma.sprintSnapshot.findMany({
    where: { sprint: { projectId } },
    orderBy: { date: 'asc' },
  });
  return { sprints, items, snapshots };
}

const points = (arr: { storyPoints: number | null }[]) => arr.reduce((s, i) => s + (i.storyPoints ?? 0), 0);

async function recordSnapshots(
  sprints: { id: string; status: string }[],
  items: { sprintId: string | null; status: string; storyPoints: number | null }[],
) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const sp of sprints.filter((s) => s.status === 'ACTIVE')) {
    const inSprint = items.filter((i) => i.sprintId === sp.id);
    const committed = points(inSprint);
    const remaining = points(inSprint.filter((i) => i.status !== 'DONE'));
    await prisma.sprintSnapshot.upsert({
      where: { sprintId_date: { sprintId: sp.id, date: today } },
      create: { sprintId: sp.id, date: today, committedPoints: committed, remainingPoints: remaining },
      update: { committedPoints: committed, remainingPoints: remaining },
    });
  }
}

// ---- Sprints ----
export async function createSprint(projectId: string, input: SprintInput, userId: string) {
  const count = await prisma.sprint.count({ where: { projectId } });
  const sprint = await prisma.sprint.create({
    data: {
      projectId,
      name: input.name,
      goal: input.goal ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      status: input.status ?? 'PLANNED',
      sortOrder: count,
    },
  });
  await writeAudit({ userId, projectId, entity: 'Sprint', entityId: sprint.id, action: 'CREATE', after: sprint });
  return sprint;
}

export async function updateSprint(projectId: string, sprintId: string, input: Partial<SprintInput>, userId: string) {
  const existing = await prisma.sprint.findFirst({ where: { id: sprintId, projectId } });
  if (!existing) throw NotFound('Sprint not found');
  const sprint = await prisma.sprint.update({
    where: { id: sprintId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
  await writeAudit({ userId, projectId, entity: 'Sprint', entityId: sprintId, action: 'UPDATE', before: existing, after: sprint });
  return sprint;
}

export async function deleteSprint(projectId: string, sprintId: string, userId: string) {
  const existing = await prisma.sprint.findFirst({ where: { id: sprintId, projectId } });
  if (!existing) throw NotFound('Sprint not found');
  // Move its items back to the product backlog rather than deleting them.
  await prisma.$transaction([
    prisma.backlogItem.updateMany({ where: { sprintId }, data: { sprintId: null } }),
    prisma.sprint.delete({ where: { id: sprintId } }),
  ]);
  await writeAudit({ userId, projectId, entity: 'Sprint', entityId: sprintId, action: 'DELETE', before: existing });
}

// ---- Backlog items ----
export async function createItem(projectId: string, input: BacklogItemInput, userId: string) {
  if (input.sprintId) {
    const sprint = await prisma.sprint.findFirst({ where: { id: input.sprintId, projectId } });
    if (!sprint) throw NotFound('Sprint not found');
  }
  const count = await prisma.backlogItem.count({ where: { projectId } });
  const item = await prisma.backlogItem.create({
    data: {
      projectId,
      type: input.type ?? 'STORY',
      title: input.title,
      description: input.description ?? null,
      acceptanceCriteria: input.acceptanceCriteria ?? null,
      storyPoints: input.storyPoints ?? null,
      priority: input.priority ?? count,
      status: input.status ?? 'TODO',
      assigneeUserId: input.assigneeUserId ?? null,
      sprintId: input.sprintId ?? null,
      sortOrder: count,
    },
    include: { assignee: { select: { id: true, name: true } } },
  });
  await writeAudit({ userId, projectId, entity: 'BacklogItem', entityId: item.id, action: 'CREATE', after: item });
  return item;
}

export async function updateItem(projectId: string, itemId: string, input: Partial<BacklogItemInput>, userId: string) {
  const existing = await prisma.backlogItem.findFirst({ where: { id: itemId, projectId } });
  if (!existing) throw NotFound('Backlog item not found');
  if (input.sprintId) {
    const sprint = await prisma.sprint.findFirst({ where: { id: input.sprintId, projectId } });
    if (!sprint) throw NotFound('Sprint not found');
  }
  const item = await prisma.backlogItem.update({
    where: { id: itemId },
    data: {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.acceptanceCriteria !== undefined ? { acceptanceCriteria: input.acceptanceCriteria } : {}),
      ...(input.storyPoints !== undefined ? { storyPoints: input.storyPoints } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.assigneeUserId !== undefined ? { assigneeUserId: input.assigneeUserId } : {}),
      ...(input.sprintId !== undefined ? { sprintId: input.sprintId } : {}),
    },
    include: { assignee: { select: { id: true, name: true } } },
  });
  await writeAudit({ userId, projectId, entity: 'BacklogItem', entityId: itemId, action: 'UPDATE', before: existing, after: item });
  return item;
}

export async function deleteItem(projectId: string, itemId: string, userId: string) {
  const existing = await prisma.backlogItem.findFirst({ where: { id: itemId, projectId } });
  if (!existing) throw NotFound('Backlog item not found');
  await prisma.backlogItem.delete({ where: { id: itemId } });
  await writeAudit({ userId, projectId, entity: 'BacklogItem', entityId: itemId, action: 'DELETE', before: existing });
}
