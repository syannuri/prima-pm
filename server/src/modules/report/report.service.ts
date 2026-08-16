import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { aiEnabled } from '../../lib/ai.js';
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

// Normalized identifier for the reporting bucket asOf falls in, so PM commentary is stored/looked
// up per period rather than per exact timestamp. daily/weekly → the bucket-start date (weekly snaps
// back to Monday, matching the S-curve sampling); monthly → YYYY-MM; yearly → YYYY.
export function periodKey(asOf: Date, period: ReportPeriod): string {
  const d = new Date(asOf);
  d.setUTCHours(0, 0, 0, 0);
  if (period === 'yearly') return String(d.getUTCFullYear());
  if (period === 'monthly') return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  if (period === 'weekly') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (daily, or weekly's Monday)
}

// Start (UTC midnight) of the reporting bucket asOf falls in — weekly snaps back to Monday, monthly
// to the 1st, yearly to 1 Jan, daily to that day. Used to find the "prior status" for the delta.
export function periodStart(asOf: Date, period: ReportPeriod): Date {
  const d = new Date(asOf);
  d.setUTCHours(0, 0, 0, 0);
  if (period === 'yearly') d.setUTCMonth(0, 1);
  else if (period === 'monthly') d.setUTCDate(1);
  else if (period === 'weekly') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

// Schedule RAG from SPI (matches the portfolio engine): no planned value yet → no data.
function schedHealth(spi: number, pv: number): 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA' {
  if (pv <= 0) return 'NO_DATA';
  if (spi >= 0.95) return 'GREEN';
  if (spi >= 0.85) return 'AMBER';
  return 'RED';
}

// Delta vs the prior captured status (the most recent EvmSnapshot before this reporting bucket).
// Governance is about trend, not a single snapshot — "GREEN→AMBER since 30 Jul" is far more
// actionable than a static RAG. Returns null when there's no earlier snapshot to compare against.
async function getPeriodDelta(
  projectId: string, period: ReportPeriod, asOf: Date,
  now: { spi: number; cpi: number; weightedProgress: number; pv: number; health: string },
) {
  const prior = await prisma.evmSnapshot.findFirst({
    where: { projectId, statusDate: { lt: periodStart(asOf, period) } },
    orderBy: { statusDate: 'desc' },
    select: { statusDate: true, spi: true, cpi: true, weightedProgress: true, pv: true },
  });
  if (!prior) return null;
  const priorHealth = schedHealth(prior.spi, Number(prior.pv));
  return {
    since: prior.statusDate.toISOString(),
    prior: { spi: prior.spi, cpi: prior.cpi, weightedPct: r2(prior.weightedProgress * 100), health: priorHealth },
    spi: r2(now.spi - prior.spi),
    cpi: r2(now.cpi - prior.cpi),
    weightedPct: r2(now.weightedProgress * 100 - prior.weightedProgress * 100),
    healthFrom: priorHealth,
    healthTo: now.health,
    healthChanged: priorHealth !== now.health,
  };
}

const emptyCommentary = { highlights: null, lowlights: null, nextFocus: null, authorName: null, updatedAt: null };

// The PM narrative saved for a project's reporting bucket (null fields when nothing written yet).
export async function getCommentary(projectId: string, period: ReportPeriod, asOf: Date) {
  const row = await prisma.projectCommentary.findUnique({
    where: { projectId_period_periodKey: { projectId, period, periodKey: periodKey(asOf, period) } },
    select: { highlights: true, lowlights: true, nextFocus: true, authorName: true, updatedAt: true },
  });
  if (!row) return { ...emptyCommentary };
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

type CommentaryInput = { highlights?: string | null; lowlights?: string | null; nextFocus?: string | null };

// Upsert the PM narrative for a project's reporting bucket. Blank strings are stored as null so an
// emptied field reads back as "not written". tenantId is stamped by the tenant extension on create.
export async function saveCommentary(
  projectId: string,
  period: ReportPeriod,
  asOf: Date,
  input: CommentaryInput,
  author: { id: string; email: string },
) {
  const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
  if (!project) throw NotFound('Project not found');
  // Resolve a display name for the byline (User is global/unscoped); fall back to the email.
  const u = await prisma.user.findUnique({ where: { id: author.id }, select: { name: true } });
  const authorName = u?.name?.trim() || author.email;
  const norm = (v?: string | null) => {
    const t = (v ?? '').trim();
    return t.length ? t : null;
  };
  const data = { highlights: norm(input.highlights), lowlights: norm(input.lowlights), nextFocus: norm(input.nextFocus) };
  const key = periodKey(asOf, period);
  const row = await prisma.projectCommentary.upsert({
    where: { projectId_period_periodKey: { projectId, period, periodKey: key } },
    create: { projectId, period, periodKey: key, ...data, authorId: author.id, authorName },
    update: { ...data, authorId: author.id, authorName },
    select: { highlights: true, lowlights: true, nextFocus: true, authorName: true, updatedAt: true },
  });
  return { ...row, updatedAt: row.updatedAt.toISOString() };
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
    select: { code: true, name: true, status: true, deliveryApproach: true, pm: { select: { name: true } }, tenantId: true, tenant: { select: { aiNarrativeEnabled: true } } },
  });
  if (!project) throw NotFound('Project not found');

  // Whether the "Draft dengan AI" action is offered in the UI. Both gates the endpoint enforces:
  // the global key (aiEnabled) AND the per-tenant opt-in. With no tenant (single-tenant deploy,
  // enforcement off) the per-tenant gate doesn't apply and the env gate alone governs.
  const hasTenant = Boolean(project.tenantId || getTenantStore()?.tenantId);
  const aiAvailable = aiEnabled() && (hasTenant ? project.tenant?.aiNarrativeEnabled === true : true);

  const [evm, forecast, tasks, actuals, commentary] = await Promise.all([
    getProjectEvm(projectId, undefined, asOf),
    getProjectForecast(projectId, asOf),
    prisma.task.findMany({
      where: { projectId },
      select: { id: true, name: true, wbsCode: true, parentTaskId: true, planStart: true, planEnd: true, actualStart: true, actualFinish: true, progressPct: true, isMilestone: true, picResourceId: true, picResource: { select: { name: true } }, owners: { select: { resource: { select: { id: true, name: true } } } } },
    }),
    prisma.actualCostEntry.findMany({ where: { projectId }, orderBy: { date: 'asc' }, select: { date: true, amount: true } }),
    getCommentary(projectId, period, asOf),
  ]);

  // Owner label: all assigned owners, lead first (deduped by resource id).
  const ownerLabel = (t: { picResourceId: string | null; picResource: { name: string } | null; owners: { resource: { id: string; name: string } }[] }) => {
    const lead = t.picResourceId;
    const ordered = [...t.owners].sort((a, b) => (a.resource.id === lead ? -1 : b.resource.id === lead ? 1 : 0));
    const names = ordered.map((o) => o.resource.name);
    return names.length ? names.join(', ') : (t.picResource?.name ?? null);
  };

  // Task completion from LEAF tasks (the schedule work packages).
  const parentIds = new Set(tasks.filter((t) => t.parentTaskId).map((t) => t.parentTaskId));
  const leaves = tasks.filter((t) => !parentIds.has(t.id));
  const completed = leaves.filter((t) => t.progressPct >= 100).length;
  const inProgress = leaves.filter((t) => t.progressPct > 0 && t.progressPct < 100).length;
  const notStarted = leaves.filter((t) => t.progressPct <= 0).length;
  const now = +asOf;
  const DAY = 86_400_000;
  const dayFloor = (ms: number) => Math.floor(ms / DAY); // compare whole calendar days (asOf carries a time-of-day)
  const remaining = leaves
    .filter((t) => t.progressPct < 100)
    .sort((a, b) => +a.planEnd - +b.planEnd)
    .map((t) => ({
      name: t.name,
      pct: t.progressPct,
      planEnd: new Date(t.planEnd).toISOString(),
      overdue: dayFloor(+t.planEnd) < dayFloor(now), // due today is not overdue until tomorrow (matches the Gantt)
      isMilestone: t.isMilestone,
      owner: ownerLabel(t),
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
      owner: ownerLabel(t),
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

  const delta = await getPeriodDelta(projectId, period, asOf, {
    spi: evm.spi, cpi: evm.cpi, weightedProgress: evm.scheduleProgress, pv: evm.pv, health: evm.health,
  });

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
    // PM narrative for this reporting bucket (the story behind the numbers).
    commentary,
    // Trend vs the prior captured status (null when there's no earlier snapshot).
    delta,
    // UI hint: show the "Draft dengan AI" action only when both AI gates pass.
    aiAvailable,
  };
}
