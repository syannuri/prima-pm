import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
import type { BacklogItemInput, SprintInput } from './agile.schemas.js';

// Full agile board payload: all sprints + all backlog items (with assignee name).
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
  return { sprints, items };
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
