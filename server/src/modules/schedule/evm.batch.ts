import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { evmFromRows, type EvmTaskRow, type PredictiveEvm } from './schedule.service.js';
import { getAgileEvm, getHybridEvm } from '../agile/agile.service.js';
import { computeLeafWeights, isCostLoaded, durationDays } from './schedule.helpers.js';
import { plannedProgress } from '../../calc/evm.js';

const dec = (v: Prisma.Decimal | number | null | undefined): number =>
  v == null ? 0 : Number(v);

// Static predictive-EVM inputs for one project, WITHOUT the status-date-dependent parts
// (actualCost / statusDate). Loaded in bulk so the same rows can be reused across many
// projects (portfolio) or many status dates (S-curve) with no re-query.
interface StaticEvmRows {
  tasks: EvmTaskRow[];
  costByTask: Map<string, number>;
  scheduleBaselinedAt: Date | null;
  costBaselineBAC: number;
}

// Batch-load the static predictive EVM inputs for many projects in a FIXED number of
// queries (4 total), instead of ~4 queries PER project as getEvm() does one-at-a-time.
// The per-project grouping mirrors directCostByTask() exactly (value = amount ?? manpowerCost)
// so evmFromRows() produces byte-identical numbers to the single-project getEvm() path.
async function loadStaticRows(ids: string[]): Promise<Map<string, StaticEvmRows>> {
  const out = new Map<string, StaticEvmRows>();
  if (ids.length === 0) return out;

  const [taskRows, costRows, projs, baselines] = await Promise.all([
    prisma.task.findMany({
      where: { projectId: { in: ids } },
      select: { id: true, projectId: true, parentTaskId: true, planStart: true, planEnd: true, progressPct: true, weight: true, baselineWeight: true, baselineStart: true, baselineFinish: true, actualStart: true, actualFinish: true },
    }),
    prisma.costItemDirect.findMany({
      where: { projectId: { in: ids }, taskId: { not: null } },
      select: { projectId: true, taskId: true, amount: true, manpowerCost: true },
    }),
    prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, scheduleBaselinedAt: true } }),
    prisma.costBaseline.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, costBaseline: true } }),
  ]);

  const tasksByProject = new Map<string, EvmTaskRow[]>();
  for (const t of taskRows) {
    let arr = tasksByProject.get(t.projectId);
    if (!arr) tasksByProject.set(t.projectId, (arr = []));
    arr.push({ id: t.id, parentTaskId: t.parentTaskId, planStart: t.planStart, planEnd: t.planEnd, progressPct: t.progressPct, weight: t.weight, baselineWeight: t.baselineWeight, baselineStart: t.baselineStart, baselineFinish: t.baselineFinish, actualStart: t.actualStart, actualFinish: t.actualFinish });
  }

  const costByProject = new Map<string, Map<string, number>>();
  for (const c of costRows) {
    let m = costByProject.get(c.projectId);
    if (!m) costByProject.set(c.projectId, (m = new Map<string, number>()));
    const value = c.amount != null ? dec(c.amount) : dec(c.manpowerCost);
    m.set(c.taskId!, (m.get(c.taskId!) ?? 0) + value);
  }

  const baselinedAt = new Map(projs.map((p) => [p.id, p.scheduleBaselinedAt] as const));
  const bacByProject = new Map(baselines.map((b) => [b.projectId, dec(b.costBaseline)] as const));

  for (const id of ids) {
    out.set(id, {
      tasks: tasksByProject.get(id) ?? [],
      costByTask: costByProject.get(id) ?? new Map<string, number>(),
      scheduleBaselinedAt: baselinedAt.get(id) ?? null,
      costBaselineBAC: bacByProject.get(id) ?? 0,
    });
  }
  return out;
}

// Cumulative Actual Cost (≤ statusDate) for many projects in ONE aggregate query.
// Mirrors actualCostAsOf() summed per project.
async function actualCostAsOfBatch(ids: string[], statusDate: Date): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const agg = await prisma.actualCostEntry.groupBy({
    by: ['projectId'],
    where: { projectId: { in: ids }, date: { lte: statusDate } },
    _sum: { amount: true },
  });
  for (const a of agg) map.set(a.projectId, dec(a._sum.amount));
  return map;
}

type ProjectEvm = PredictiveEvm | Awaited<ReturnType<typeof getAgileEvm>>;

/**
 * EVM for MANY projects at one status date, methodology-aware, returned as a Map keyed by
 * project id. DRAFT projects are omitted (they have no baseline yet — matches the old
 * per-project skip). Predictive projects are loaded in bulk (a handful of queries total)
 * and evaluated in memory via evmFromRows; AGILE/HYBRID delegate to their existing points
 * dispatchers (the minority — kept per-project so their blended math is untouched).
 *
 * Replaces portfolio-summary's O(projects × ~5) query fan-out on the predictive path.
 */
export async function computeEvmForProjects(
  projects: { id: string; status: string; deliveryApproach: string }[],
  statusDate: Date,
): Promise<Map<string, ProjectEvm>> {
  const result = new Map<string, ProjectEvm>();

  const active = projects.filter((p) => p.status !== 'DRAFT');
  const predictiveIds = active.filter((p) => p.deliveryApproach !== 'AGILE' && p.deliveryApproach !== 'HYBRID').map((p) => p.id);
  const otherProjects = active.filter((p) => p.deliveryApproach === 'AGILE' || p.deliveryApproach === 'HYBRID');

  const [rowsById, acById, others] = await Promise.all([
    loadStaticRows(predictiveIds),
    actualCostAsOfBatch(predictiveIds, statusDate),
    Promise.all(
      otherProjects.map((p) =>
        (p.deliveryApproach === 'AGILE'
          ? getAgileEvm(p.id, undefined, statusDate)
          : getHybridEvm(p.id, undefined, statusDate)
        ).then((evm) => [p.id, evm] as const),
      ),
    ),
  ]);

  for (const id of predictiveIds) {
    const rows = rowsById.get(id)!;
    result.set(id, evmFromRows({ ...rows, actualCost: acById.get(id) ?? 0, statusDate }));
  }
  for (const [id, evm] of others) result.set(id, evm);

  return result;
}

/**
 * Planned-Value (PV) series for ONE project resampled at many status dates — the EVM S-curve.
 * For a PREDICTIVE project the static WBS/cost rows are loaded ONCE and PV is evaluated in
 * memory per date (AC is irrelevant to PV, so no per-date AC lookup), collapsing up to ~53 DB
 * round-trips into a single load. AGILE/HYBRID fall back to the per-date methodology dispatcher
 * (points/blended PV isn't a pure function of already-loaded WBS rows).
 *
 * `dates` are epoch-ms marks; the returned array is PV aligned to `dates` by index.
 */
export async function evmPvSeries(projectId: string, dates: number[]): Promise<number[]> {
  if (dates.length === 0) return [];
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { deliveryApproach: true } });
  const approach = project?.deliveryApproach;

  if (approach === 'AGILE' || approach === 'HYBRID') {
    const { getProjectEvm } = await import('../agile/agile.service.js');
    return Promise.all(dates.map((d) => getProjectEvm(projectId, 0, new Date(d)).then((e) => e.pv)));
  }

  const rows = (await loadStaticRows([projectId])).get(projectId);
  if (!rows) return dates.map(() => 0);
  return dates.map((d) => evmFromRows({ ...rows, actualCost: 0, statusDate: new Date(d) }).pv);
}

export interface ProgressPoint {
  t: string;
  /** Planned physical progress at the date, 0..1 of scope. */
  plannedPct: number;
  /** Actual physical progress at the date, 0..1 — null for future dates (> status date). */
  actualPct: number | null;
}

/** A weighted leaf task with its planned & actual schedule windows — the pure input to the series. */
export interface ProgressLeaf {
  weight: number;
  progressPct: number;
  planStart: Date;
  planEnd: Date;
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const DAY_MS = 86_400_000;

/**
 * PURE plan-vs-actual progress at each date (0..1 of scope) from weighted leaves. PLANNED reuses
 * plannedProgress (EVM's baseline/plan-window rule); ACTUAL is read from each leaf's own actual
 * dates — completed leaves earn from actualFinish, in-progress leaves ramp actualStart→statusDate
 * to their current progress. Actual is null for dates after the status date. Extracted so the math
 * is unit-tested without a database. At the status date the actual point equals weightedProgress.
 */
export function progressSeriesFromLeaves(leaves: ProgressLeaf[], statusDate: Date, dates: number[]): ProgressPoint[] {
  const totalW = leaves.reduce((s, t) => s + Math.max(0, t.weight), 0);
  if (totalW <= 0) return [];
  const now = +statusDate;
  return dates.map((d) => {
    let planned = 0;
    let actual = 0;
    const future = d > now;
    for (const t of leaves) {
      const w = Math.max(0, t.weight);
      if (w <= 0) continue;
      planned += w * plannedProgress({ budgetCost: w, progressPct: 0, planStart: t.planStart, planEnd: t.planEnd, baselineStart: t.baselineStart, baselineEnd: t.baselineFinish }, new Date(d));
      if (future) continue;
      const done = clamp01((t.progressPct ?? 0) / 100);
      if (done <= 0) continue;
      const aFin = t.actualFinish ? +t.actualFinish : null;
      const aStart = t.actualStart ? +t.actualStart : null;
      // The date at which the current `done` fraction is reached: actualFinish for a completed
      // leaf, otherwise the status date (an in-progress leaf ramps up to today).
      const reached = aFin != null ? aFin : now;
      let frac: number;
      if (aFin != null && d >= aFin) frac = done;
      else if (aStart != null && d >= aStart) frac = done * clamp01((d - aStart) / Math.max(DAY_MS, reached - aStart));
      else if (aStart == null) frac = d >= now ? done : 0; // progress recorded without a stamped start (rare)
      else frac = 0;
      actual += w * frac;
    }
    return { t: new Date(d).toISOString(), plannedPct: round4(planned / totalW), actualPct: future ? null : round4(actual / totalW) };
  });
}

/**
 * Timeline-based PLAN-vs-ACTUAL progress S-curve (0..1 of scope), resampled at a fixed cadence
 * (default weekly). Unlike the money PV/AC S-curve, both lines are read straight from the WBS
 * timeline — the schedule IS the plan and the actual progress record:
 *   • PLANNED — each leaf's planned/baseline window (identical to EVM PV's plannedProgress), so the
 *     planned line matches the EVM Planned Value exactly.
 *   • ACTUAL — from the timeline's OWN actual dates: a completed leaf contributes its full weight
 *     from its actualFinish; an in-progress leaf ramps linearly from actualStart up to its current
 *     progress at the status date. This yields a DENSE actual curve every week, independent of the
 *     (sparse, manually captured) EVM snapshots. At the status date the actual point equals the
 *     authoritative weightedProgress by construction.
 *
 * Predictive only — AGILE/HYBRID have no per-task actual dates (story-point burn-up); returns null
 * so the caller falls back to snapshot-based EV.
 */
export async function scheduleProgressSeries(projectId: string, statusDate: Date, stepDays = 7): Promise<ProgressPoint[] | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { deliveryApproach: true } });
  if (project?.deliveryApproach === 'AGILE' || project?.deliveryApproach === 'HYBRID') return null;

  const rows = (await loadStaticRows([projectId])).get(projectId);
  if (!rows || rows.tasks.length === 0) return null;

  // Leaf set + weights — mirror evmFromRows so the last actual point == weightedProgress.
  const parentIds = new Set(rows.tasks.filter((t) => t.parentTaskId).map((t) => t.parentTaskId!));
  const leaves = rows.tasks.filter((t) => !parentIds.has(t.id));
  if (!leaves.length) return null;
  const leafDur = new Map(leaves.map((t) => [t.id, durationDays(t.planStart, t.planEnd)]));
  const costLoaded = isCostLoaded(leaves.map((t) => ({ cost: rows.costByTask.get(t.id) ?? 0, durationDays: leafDur.get(t.id)! })));
  const leafProxy = new Map(leaves.map((t) => [t.id, costLoaded ? (rows.costByTask.get(t.id) ?? 0) : leafDur.get(t.id)!]));
  if ([...leafProxy.values()].every((v) => v === 0)) for (const k of leafProxy.keys()) leafProxy.set(k, 1);
  const baselined = !!rows.scheduleBaselinedAt;
  const leafWeight = computeLeafWeights(
    rows.tasks.map((t) => ({ id: t.id, parentTaskId: t.parentTaskId, weight: baselined ? t.baselineWeight : t.weight, proxy: leafProxy.get(t.id) ?? 0 })),
  );
  const totalW = leaves.reduce((s, t) => s + (leafWeight.get(t.id) ?? 0), 0);
  if (totalW <= 0) return null;

  // Sampling window: planned/baseline span, extended to the status date.
  const startOf = (t: EvmTaskRow): number => +(t.baselineStart ?? t.planStart);
  const endOf = (t: EvmTaskRow): number => +(t.baselineFinish ?? t.planEnd);
  const now = +statusDate;
  const winStart = Math.min(...leaves.map(startOf));
  const winEnd = Math.max(...leaves.map(endOf), now);
  if (!Number.isFinite(winStart) || !Number.isFinite(winEnd) || winEnd <= winStart) return null;

  const MAX_POINTS = 160;
  let step = stepDays * DAY_MS;
  if ((winEnd - winStart) / step > MAX_POINTS) step = (winEnd - winStart) / MAX_POINTS;

  const marks: number[] = [];
  for (let d = winStart; d < winEnd; d += step) marks.push(Math.round(d));
  marks.push(winEnd);
  if (now >= winStart && now <= winEnd) marks.push(now); // a point exactly at the status date
  const dates = [...new Set(marks)].sort((a, b) => a - b);

  const progressLeaves: ProgressLeaf[] = leaves.map((t) => ({
    weight: leafWeight.get(t.id) ?? 0,
    progressPct: t.progressPct,
    planStart: t.planStart,
    planEnd: t.planEnd,
    baselineStart: t.baselineStart,
    baselineFinish: t.baselineFinish,
    actualStart: t.actualStart ?? null,
    actualFinish: t.actualFinish ?? null,
  }));
  return progressSeriesFromLeaves(progressLeaves, statusDate, dates);
}
