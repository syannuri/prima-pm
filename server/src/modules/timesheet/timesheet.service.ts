import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import type { MandayEntryInput } from './timesheet.schemas.js';

const dec = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const clampPct = (p: number) => Math.min(100, Math.max(0, p));

// Timesheet view for a project: manpower lines with plan / earned / consumed /
// labour-efficiency, plus the raw entries. Earned = plan × task %progress;
// consumed = Σ logged man-days; efficiency = earned ÷ consumed (a labour CPI).
export async function getTimesheet(projectId: string) {
  const [lines, entries] = await Promise.all([
    prisma.costItemDirect.findMany({
      where: { projectId, type: 'MANPOWER' },
      select: {
        id: true,
        label: true,
        planMandays: true,
        resourceRef: { select: { name: true } },
        resource: { select: { name: true } },
        task: { select: { name: true, progressPct: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.mandayEntry.findMany({ where: { projectId }, orderBy: { date: 'desc' } }),
  ]);

  const consumedByLine = new Map<string, number>();
  for (const e of entries) consumedByLine.set(e.costItemId, (consumedByLine.get(e.costItemId) ?? 0) + dec(e.mandays));

  const lineViews = lines.map((l) => {
    const plan = dec(l.planMandays);
    const progressPct = l.task?.progressPct ?? 0;
    const earned = round2((plan * clampPct(progressPct)) / 100);
    const consumed = round2(consumedByLine.get(l.id) ?? 0);
    return {
      id: l.id,
      label: l.label,
      resourceName: l.resourceRef?.name ?? l.resource?.name ?? l.label,
      taskName: l.task?.name ?? null,
      planMandays: plan,
      progressPct,
      earnedMandays: earned,
      consumedMandays: consumed,
      efficiency: consumed > 0 ? round2(earned / consumed) : null,
    };
  });

  const labelById = new Map(lines.map((l) => [l.id, l.label]));
  const entryViews = entries.map((e) => ({
    id: e.id,
    costItemId: e.costItemId,
    lineLabel: labelById.get(e.costItemId) ?? '—',
    date: e.date,
    mandays: dec(e.mandays),
    note: e.note,
  }));

  const totals = {
    planMandays: round2(lineViews.reduce((s, l) => s + l.planMandays, 0)),
    earnedMandays: round2(lineViews.reduce((s, l) => s + l.earnedMandays, 0)),
    consumedMandays: round2(lineViews.reduce((s, l) => s + l.consumedMandays, 0)),
  };

  return { lines: lineViews, entries: entryViews, totals };
}

export async function addMandayEntry(projectId: string, input: MandayEntryInput, actorId: string) {
  const line = await prisma.costItemDirect.findFirst({
    where: { id: input.costItemId, projectId, type: 'MANPOWER' },
    select: { id: true },
  });
  if (!line) throw BadRequest('Manpower line not found on this project');

  const entry = await prisma.mandayEntry.create({
    data: {
      projectId,
      costItemId: input.costItemId,
      date: input.date,
      mandays: input.mandays,
      note: input.note ?? null,
      recordedBy: actorId,
    },
  });
  await writeAudit({
    projectId,
    userId: actorId,
    entity: 'MandayEntry',
    entityId: entry.id,
    action: 'CREATE',
    after: { costItemId: input.costItemId, mandays: input.mandays },
  });
  return entry;
}

export async function deleteMandayEntry(projectId: string, entryId: string, actorId: string) {
  const entry = await prisma.mandayEntry.findFirst({ where: { id: entryId, projectId }, select: { id: true } });
  if (!entry) throw NotFound('Timesheet entry not found');
  await prisma.mandayEntry.delete({ where: { id: entryId } });
  await writeAudit({ projectId, userId: actorId, entity: 'MandayEntry', entityId: entryId, action: 'DELETE' });
}

// ---------------------------------------------------------------------------
// "My Timesheet" — self-service, scoped to manpower lines assigned to the caller
// (line.resourceUserId == me, or the line's resource-master resolves to me). No
// project access is needed and NO financials are exposed. Members can only delete
// entries they recorded themselves.
// ---------------------------------------------------------------------------

// A manpower line "belongs to" a user when it's directly linked (resourceUserId)
// or via the resource master (resource.userId). Excludes soft-deleted projects.
const mineWhere = (userId: string): Prisma.CostItemDirectWhereInput => ({
  type: 'MANPOWER',
  project: { deletedAt: null },
  OR: [{ resourceUserId: userId }, { resourceRef: { userId } }],
});

export async function getMyTimesheet(userId: string) {
  const lines = await prisma.costItemDirect.findMany({
    where: mineWhere(userId),
    select: {
      id: true,
      label: true,
      planMandays: true,
      project: { select: { code: true, name: true } },
      task: { select: { name: true, progressPct: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const lineIds = lines.map((l) => l.id);

  const consumedGroups = lineIds.length
    ? await prisma.mandayEntry.groupBy({ by: ['costItemId'], where: { costItemId: { in: lineIds } }, _sum: { mandays: true } })
    : [];
  const consumedByLine = new Map(consumedGroups.map((g) => [g.costItemId, dec(g._sum.mandays)]));

  const lineViews = lines.map((l) => {
    const plan = dec(l.planMandays);
    const progressPct = l.task?.progressPct ?? 0;
    return {
      id: l.id,
      projectCode: l.project.code,
      projectName: l.project.name,
      taskName: l.task?.name ?? null,
      planMandays: plan,
      progressPct,
      earnedMandays: round2((plan * clampPct(progressPct)) / 100),
      consumedMandays: round2(consumedByLine.get(l.id) ?? 0),
    };
  });

  // Only the caller's own entries are listed (and thus deletable).
  const myEntries = lineIds.length
    ? await prisma.mandayEntry.findMany({ where: { recordedBy: userId, costItemId: { in: lineIds } }, orderBy: { date: 'desc' }, take: 100 })
    : [];
  const labelById = new Map(lines.map((l) => [l.id, `${l.project.code} · ${l.task?.name ?? l.label}`]));
  const entryViews = myEntries.map((e) => ({
    id: e.id,
    costItemId: e.costItemId,
    lineLabel: labelById.get(e.costItemId) ?? '—',
    date: e.date,
    mandays: dec(e.mandays),
    note: e.note,
  }));

  return { lines: lineViews, entries: entryViews };
}

export async function addMyMandayEntry(userId: string, input: MandayEntryInput) {
  const line = await prisma.costItemDirect.findFirst({ where: { id: input.costItemId, ...mineWhere(userId) }, select: { id: true, projectId: true } });
  if (!line) throw Forbidden('That manpower line is not assigned to you');

  const entry = await prisma.mandayEntry.create({
    data: { projectId: line.projectId, costItemId: line.id, date: input.date, mandays: input.mandays, note: input.note ?? null, recordedBy: userId },
  });
  await writeAudit({ projectId: line.projectId, userId, entity: 'MandayEntry', entityId: entry.id, action: 'CREATE', after: { costItemId: line.id, mandays: input.mandays, self: true } });
  return entry;
}

export async function deleteMyMandayEntry(userId: string, entryId: string) {
  // Members can only delete entries they themselves recorded.
  const entry = await prisma.mandayEntry.findFirst({ where: { id: entryId, recordedBy: userId }, select: { id: true, projectId: true } });
  if (!entry) throw NotFound('Timesheet entry not found');
  await prisma.mandayEntry.delete({ where: { id: entryId } });
  await writeAudit({ projectId: entry.projectId, userId, entity: 'MandayEntry', entityId: entryId, action: 'DELETE' });
}
