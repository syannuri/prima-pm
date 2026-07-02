import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
import { actualCostAsOf } from '../cost/cost.service.js';
import { round2 } from '../../calc/money.js';
import { deriveEvm } from '../../calc/evm.js';
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

// Story-point progress fractions for a project: actual (done ÷ total) and planned
// (from the sprint schedule vs the status date). Shared by agile & hybrid EVM.
async function agileFractions(projectId: string, statusDate: Date) {
  const [items, sprints] = await Promise.all([
    prisma.backlogItem.findMany({ where: { projectId }, select: { storyPoints: true, status: true, sprintId: true } }),
    prisma.sprint.findMany({ where: { projectId }, select: { id: true, startDate: true, endDate: true } }),
  ]);
  const totalPts = points(items);
  const donePts = points(items.filter((i) => i.status === 'DONE'));
  const progress = totalPts > 0 ? donePts / totalPts : 0;
  let plannedPts = 0;
  const now = statusDate.getTime();
  for (const sp of sprints) {
    if (!sp.startDate || !sp.endDate) continue;
    const start = sp.startDate.getTime();
    const end = sp.endDate.getTime();
    if (end <= start) continue;
    const sprintPts = points(items.filter((i) => i.sprintId === sp.id));
    if (now >= end) plannedPts += sprintPts;
    else if (now > start) plannedPts += sprintPts * ((now - start) / (end - start));
  }
  const plannedProgress = totalPts > 0 ? plannedPts / totalPts : 0;
  return { progress, plannedProgress, itemCount: items.length, totalPts };
}

async function bacOf(projectId: string): Promise<number> {
  const cb = await prisma.costBaseline.findUnique({ where: { projectId }, select: { costBaseline: true } });
  return cb ? Number(cb.costBaseline) : 0;
}

// Budget of the predictive stream = direct costs linked to WBS tasks. The rest of the
// BAC funds the agile stream (so combining the two never double-counts the BAC).
async function predictiveBudget(projectId: string): Promise<number> {
  const rows = await prisma.costItemDirect.findMany({
    where: { projectId, taskId: { not: null } },
    select: { type: true, amount: true, manpowerCost: true },
  });
  return rows.reduce((s, r) => s + Number(r.type === 'MANPOWER' ? (r.manpowerCost ?? 0) : (r.amount ?? 0)), 0);
}

function evmOut(
  bac: number, ev: number, pv: number, ac: number, progress: number, leafTaskCount: number,
  finishVarianceDays: number | null,
  // scheduleBaselinedAt may be a Date (from getEvm) — JSON serializes it to an ISO string
  // over the wire, matching the schedule endpoint and the frontend Evm type.
  baseline?: { scheduleBaselinedAt: Date | string | null; baselineFinish: string | null; currentFinish: string | null },
) {
  // Reuse the shared EVM engine so agile/hybrid report the SAME fields + RAG health
  // as the WBS (schedule) EVM — cv, sv, cpi, spi, eac, etc, vac, tcpi, health.
  return {
    ...deriveEvm(bac, ev, pv, ac, progress),
    scheduleProgress: progress,
    scheduleWeight: bac > 0 ? bac : 1,
    costBaselineBAC: bac,
    leafTaskCount,
    scheduleBaselinedAt: baseline?.scheduleBaselinedAt ?? null,
    baselineFinish: baseline?.baselineFinish ?? null,
    currentFinish: baseline?.currentFinish ?? null,
    finishVarianceDays,
  };
}

// Agile-EVM: derive an EVM reading from story points so agile projects roll into the
// same Portfolio EVM as predictive ones. Returns the fields the portfolio reads.
export async function getAgileEvm(projectId: string, actualCost: number | undefined, statusDate: Date) {
  const [af, bac, ac] = await Promise.all([
    agileFractions(projectId, statusDate),
    bacOf(projectId),
    actualCost !== undefined ? Promise.resolve(actualCost) : actualCostAsOf(projectId, statusDate),
  ]);
  const out = evmOut(bac, af.progress * bac, af.plannedProgress * bac, ac, af.progress, af.itemCount, null);
  // SPI is points-based (robust even with BAC=0): progress ÷ plannedProgress.
  out.spi = af.plannedProgress > 0 ? round2(af.progress / af.plannedProgress) : 0;
  return out;
}

// Hybrid-EVM: a predictive WBS backbone + an agile execution stream. Split the BAC into
// a predictive share (cost linked to WBS tasks) and an agile share (the remainder), then
// EV = wbsProgress×predictiveBAC + agileProgress×agileBAC (no BAC double-counting).
export async function getHybridEvm(projectId: string, actualCost: number | undefined, statusDate: Date) {
  const { getEvm } = await import('../schedule/schedule.service.js');
  const [wbs, af, linked, ac] = await Promise.all([
    getEvm(projectId, 0, statusDate),
    agileFractions(projectId, statusDate),
    predictiveBudget(projectId),
    actualCost !== undefined ? Promise.resolve(actualCost) : actualCostAsOf(projectId, statusDate),
  ]);
  const bac = wbs.costBaselineBAC || 0;
  const predictiveBAC = bac > 0 ? Math.min(linked, bac) : linked;
  const agileBAC = Math.max(0, bac - predictiveBAC);
  const wProg = wbs.scheduleProgress;
  const wPlanned = bac > 0 ? wbs.pv / bac : 0;
  const ev = wProg * predictiveBAC + af.progress * agileBAC;
  const pv = wPlanned * predictiveBAC + af.plannedProgress * agileBAC;
  const progress = bac > 0 ? ev / bac : (wProg + af.progress) / 2;
  return evmOut(bac, ev, pv, ac, progress, wbs.leafTaskCount + af.itemCount, wbs.finishVarianceDays, {
    scheduleBaselinedAt: wbs.scheduleBaselinedAt,
    baselineFinish: wbs.baselineFinish,
    currentFinish: wbs.currentFinish,
  });
}

// Dispatch EVM by delivery methodology so the Agile tab (and any caller) gets the
// right reading: AGILE → points-EVM, HYBRID → blended WBS+points, else → WBS EVM.
export async function getProjectEvm(projectId: string, actualCost: number | undefined, statusDate: Date) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { deliveryApproach: true } });
  if (project?.deliveryApproach === 'AGILE') return getAgileEvm(projectId, actualCost, statusDate);
  if (project?.deliveryApproach === 'HYBRID') return getHybridEvm(projectId, actualCost, statusDate);
  const { getEvm } = await import('../schedule/schedule.service.js');
  return getEvm(projectId, actualCost, statusDate);
}

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
