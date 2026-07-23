import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
// Methodology dispatcher (AGILE → points-EVM, HYBRID → blended, else WBS) so a
// captured snapshot uses the SAME EVM the Dashboard/Forecast report.
import { getProjectEvm } from '../agile/agile.service.js';
import { sampleDates, type TrendPoint } from './evm.helpers.js';
import type { CaptureSnapshotInput } from './evm.schemas.js';

const num = (d: unknown): number => (d == null ? 0 : Number(d));

// Day-normalize to UTC midnight so a status date maps to exactly one snapshot slot
// (the column is @db.Date; the unique key is (projectId, statusDate)).
function dayUTC(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

// Resolve plain user ids to display names in one query (createdById is FK-less).
async function nameMap(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

async function ensureProject(projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
  if (!project) throw NotFound('Project not found');
}

/** Capture (or re-capture) the current EVM as-of a status date. Upserts on (project, date).
 *  actorId may be null for a system-driven capture (the weekly auto-capture scheduler). */
export async function captureSnapshot(projectId: string, input: CaptureSnapshotInput, actorId: string | null) {
  await ensureProject(projectId);
  const statusDate = dayUTC(input.statusDate ?? new Date());
  const evm = await getProjectEvm(projectId, undefined, statusDate);

  const data = {
    bac: evm.bac,
    pv: evm.pv,
    ev: evm.ev,
    ac: evm.ac,
    cpi: evm.cpi,
    spi: evm.spi,
    weightedProgress: evm.weightedProgress,
    note: input.note ?? null,
    createdById: actorId,
  };

  const existing = await prisma.evmSnapshot.findUnique({
    where: { projectId_statusDate: { projectId, statusDate } },
    select: { id: true },
  });
  const snap = await prisma.evmSnapshot.upsert({
    where: { projectId_statusDate: { projectId, statusDate } },
    create: { projectId, statusDate, ...data },
    update: data,
  });
  await writeAudit({
    projectId,
    userId: actorId,
    entity: 'EvmSnapshot',
    entityId: snap.id,
    action: existing ? 'UPDATE' : 'CREATE',
    after: snap,
  });
  return snap;
}

function toPoint(s: {
  statusDate: Date;
  bac: unknown;
  pv: unknown;
  ev: unknown;
  ac: unknown;
  cpi: number;
  spi: number;
  weightedProgress: number;
}): TrendPoint {
  return {
    statusDate: s.statusDate.toISOString(),
    bac: num(s.bac),
    pv: num(s.pv),
    ev: num(s.ev),
    ac: num(s.ac),
    cpi: s.cpi,
    spi: s.spi,
    weightedProgress: s.weightedProgress,
  };
}

/** All captured snapshots, oldest → newest, with the capturer's display name. */
export async function listSnapshots(projectId: string) {
  await ensureProject(projectId);
  const rows = await prisma.evmSnapshot.findMany({
    where: { projectId },
    orderBy: { statusDate: 'asc' },
  });
  const names = await nameMap(rows.map((r) => r.createdById));
  return rows.map((r) => ({
    id: r.id,
    ...toPoint(r),
    note: r.note,
    createdByName: r.createdById ? names.get(r.createdById) ?? null : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function deleteSnapshot(projectId: string, snapshotId: string, actorId: string) {
  const existing = await prisma.evmSnapshot.findFirst({ where: { id: snapshotId, projectId } });
  if (!existing) throw NotFound('Snapshot not found');
  await prisma.evmSnapshot.delete({ where: { id: snapshotId } });
  await writeAudit({ projectId, userId: actorId, entity: 'EvmSnapshot', entityId: snapshotId, action: 'DELETE', before: existing });
}

/**
 * Trend payload for the chart: the captured EV/AC/CPI/SPI series PLUS a smooth
 * planned-value backdrop (PV evaluated at sample dates across the baseline window,
 * per methodology) and the current BAC reference line.
 */
export async function getTrend(projectId: string, statusDate: Date) {
  await ensureProject(projectId);
  const [snapshots, evmNow, tasks, charter] = await Promise.all([
    listSnapshots(projectId),
    getProjectEvm(projectId, undefined, statusDate),
    prisma.task.findMany({ where: { projectId }, select: { planStart: true, planEnd: true } }),
    prisma.projectCharter.findUnique({ where: { projectId }, select: { hiScheduleStart: true, hiScheduleEnd: true } }),
  ]);

  const start = tasks.length ? Math.min(...tasks.map((t) => +t.planStart)) : charter ? +charter.hiScheduleStart : null;
  const end = tasks.length ? Math.max(...tasks.map((t) => +t.planEnd)) : charter ? +charter.hiScheduleEnd : null;

  let plannedCurve: { t: string; pv: number }[] = [];
  if (start != null && end != null && end > start) {
    // Include every snapshot date as a mark so the backdrop lines up with the actuals.
    const marks = snapshots.map((s) => +new Date(s.statusDate));
    const dates = sampleDates(start, end, 12, marks);
    const pvs = await Promise.all(dates.map((d) => getProjectEvm(projectId, 0, new Date(d)).then((e) => e.pv)));
    plannedCurve = dates.map((d, i) => ({ t: new Date(d).toISOString(), pv: pvs[i] }));
  }

  return {
    projectId,
    statusDate: statusDate.toISOString(),
    bac: evmNow.bac,
    plannedStart: start != null ? new Date(start).toISOString() : null,
    plannedFinish: end != null ? new Date(end).toISOString() : null,
    snapshots,
    plannedCurve,
  };
}
