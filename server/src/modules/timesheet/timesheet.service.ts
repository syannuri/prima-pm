import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
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
