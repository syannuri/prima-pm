import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
// Methodology dispatcher (AGILE → points, HYBRID → blend, else → WBS) so the report's EVM
// matches the Dashboard/Forecast exactly.
import { getProjectEvm } from '../agile/agile.service.js';
import { evmPvSeries } from '../schedule/evm.batch.js';
import { getProjectForecast } from '../forecast/forecast.service.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type ProjectReport = Awaited<ReturnType<typeof getProjectReport>>;

// Cap on S-curve sample points: each sampled date is one getProjectEvm() call (a DB round-trip),
// so daily/weekly cadence over a long window would otherwise fan out into hundreds of queries.
// We keep the mandatory marks (start, end, today, finishes) and evenly thin the stepped points.
const MAX_SAMPLE_POINTS = 53;

// Sample dates at daily / weekly (Monday) / monthly (1st) / yearly (Jan 1) steps across
// [start, end], always including the key marks (today, planned finish, forecast finish) so the
// S-curve has points exactly where the plan/forecast bends.
function sampleDates(start: number, end: number, period: ReportPeriod, extra: number[]): number[] {
  const stepped: number[] = [];
  const d = new Date(start);
  d.setUTCHours(0, 0, 0, 0);
  if (period === 'weekly') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  else if (period === 'monthly') d.setUTCDate(1);
  else if (period === 'yearly') d.setUTCMonth(0, 1); // back to 1 Jan
  // daily: no snapping — step from the plan start itself.
  while (+d <= end) {
    stepped.push(+d);
    if (period === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
    else if (period === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
    else d.setUTCDate(d.getUTCDate() + (period === 'weekly' ? 7 : 1));
  }
  // Thin evenly if the cadence produced more points than the cap (bounds the EVM DB calls).
  const sampled = stepped.length > MAX_SAMPLE_POINTS
    ? stepped.filter((_, i) => i % Math.ceil(stepped.length / MAX_SAMPLE_POINTS) === 0)
    : stepped;
  const marks = new Set<number>([...sampled, ...extra, start, end]);
  return [...marks].filter((x) => x >= start && x <= end).sort((a, b) => a - b);
}

// Human label for the reporting period, e.g. "9 Jul 2026" (daily), "Week ending 12 Jul 2026",
// "July 2026" (monthly) or "Year 2026".
export function periodLabel(asOf: Date, period: ReportPeriod): string {
  if (period === 'yearly') return `Year ${asOf.toLocaleString('en', { year: 'numeric', timeZone: 'UTC' })}`;
  if (period === 'monthly') return asOf.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (period === 'daily') return asOf.toLocaleString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const end = new Date(asOf);
  end.setUTCDate(end.getUTCDate() + (6 - ((end.getUTCDay() + 6) % 7))); // that week's Sunday
  return `Week ending ${end.toLocaleString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
}

/**
 * Curated single-project status report (PM + ADMIN/PMO): lifecycle + RAG health, EVM KPIs,
 * task completion (by count AND by weighted value — they differ), an EVM S-curve resampled at
 * the chosen weekly/monthly granularity, and the EAC/schedule/margin forecast. Everything
 * reuses the methodology-aware EVM + forecast engines so the figures match every other surface.
 */
export async function getProjectReport(projectId: string, period: ReportPeriod, asOf: Date) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { code: true, name: true, status: true, deliveryApproach: true, pm: { select: { name: true } } },
  });
  if (!project) throw NotFound('Project not found');

  const [evm, forecast, tasks, actuals] = await Promise.all([
    getProjectEvm(projectId, undefined, asOf),
    getProjectForecast(projectId, asOf),
    prisma.task.findMany({
      where: { projectId },
      select: { id: true, name: true, wbsCode: true, parentTaskId: true, planStart: true, planEnd: true, actualStart: true, actualFinish: true, progressPct: true, isMilestone: true, picResource: { select: { name: true } } },
    }),
    prisma.actualCostEntry.findMany({ where: { projectId }, orderBy: { date: 'asc' }, select: { date: true, amount: true } }),
  ]);

  // Task completion from LEAF tasks (the schedule work packages).
  const parentIds = new Set(tasks.filter((t) => t.parentTaskId).map((t) => t.parentTaskId));
  const leaves = tasks.filter((t) => !parentIds.has(t.id));
  const completed = leaves.filter((t) => t.progressPct >= 100).length;
  const inProgress = leaves.filter((t) => t.progressPct > 0 && t.progressPct < 100).length;
  const notStarted = leaves.filter((t) => t.progressPct <= 0).length;
  const now = +asOf;
  const remaining = leaves
    .filter((t) => t.progressPct < 100)
    .sort((a, b) => +a.planEnd - +b.planEnd)
    .map((t) => ({
      name: t.name,
      pct: t.progressPct,
      planEnd: new Date(t.planEnd).toISOString(),
      overdue: +t.planEnd < now,
      isMilestone: t.isMilestone,
      owner: t.picResource?.name ?? null,
    }));

  // Full schedule detail (all leaf work packages, chronological) with plan vs actual dates —
  // actualStart is stamped on first progress, actualFinish when a task reaches 100%.
  const schedule = leaves
    .slice()
    .sort((a, b) => +a.planStart - +b.planStart || +a.planEnd - +b.planEnd)
    .map((t) => ({
      wbs: t.wbsCode,
      name: t.name,
      isMilestone: t.isMilestone,
      pct: t.progressPct,
      owner: t.picResource?.name ?? null,
      planStart: new Date(t.planStart).toISOString(),
      planEnd: new Date(t.planEnd).toISOString(),
      actualStart: t.actualStart ? new Date(t.actualStart).toISOString() : null,
      actualFinish: t.actualFinish ? new Date(t.actualFinish).toISOString() : null,
    }));

  // EVM S-curve resampled at weekly/monthly points: planned PV across the whole window,
  // actual AC to date, and a forecast line to the likely EAC. (EV is a "now" value that
  // can't be reconstructed historically, so — like the forecast engine — the curve tracks
  // PV/AC/forecast, while physical %complete is shown via the task donut + weighted figure.)
  const ps = forecast.schedule.plannedStart ? +new Date(forecast.schedule.plannedStart) : null;
  const pf = forecast.schedule.plannedFinish ? +new Date(forecast.schedule.plannedFinish) : null;
  const ff = forecast.schedule.forecastFinish ? +new Date(forecast.schedule.forecastFinish) : null;
  let sCurve = forecast.sCurve;
  if (ps != null && pf != null) {
    const end = Math.max(pf, ff ?? pf);
    const dates = sampleDates(ps, end, period, [now, pf, ...(ff ? [ff] : [])]);
    const acAsOf = (d: number) => actuals.reduce((s, e) => s + (+e.date <= d ? Number(e.amount) : 0), 0);
    // PV per date via the batched series (predictive: one row-load reused across all dates;
    // agile/hybrid: per-date dispatch). Same numbers as getProjectEvm(projectId, 0, d).pv.
    const pvs = await evmPvSeries(projectId, dates);
    sCurve = dates.map((d, i) => ({
      t: new Date(d).toISOString(),
      pv: r2(pvs[i]),
      ac: d <= now ? r2(acAsOf(d)) : null,
      forecast: ff && ff > now && d >= now ? r2(evm.ac + (forecast.eac.likely - evm.ac) * ((d - now) / (ff - now))) : null,
    }));
  }

  return {
    project: {
      code: project.code,
      name: project.name,
      pmName: project.pm?.name ?? '—',
      status: project.status,
      deliveryApproach: project.deliveryApproach,
    },
    period,
    asOf: asOf.toISOString(),
    periodLabel: periodLabel(asOf, period),
    health: evm.health,
    evm: {
      bac: evm.bac,
      pv: evm.pv,
      ev: evm.ev,
      ac: evm.ac,
      cpi: evm.cpi,
      spi: evm.spi,
      percentComplete: evm.percentComplete,
      weightedProgress: evm.weightedProgress,
      scheduleProgress: evm.scheduleProgress,
      leafTaskCount: evm.leafTaskCount,
    },
    tasks: {
      total: leaves.length,
      completed,
      inProgress,
      notStarted,
      weightedPct: r2(evm.scheduleProgress * 100),
      remaining,
      schedule,
    },
    // Full forecast payload, but with the S-curve resampled to the report's granularity so
    // ForecastChart renders weekly/monthly buckets.
    forecast: { ...forecast, sCurve },
  };
}
