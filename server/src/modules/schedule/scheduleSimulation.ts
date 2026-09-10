// =====================================================================
// SCHEDULE-RISK Monte-Carlo — samples each activity's duration from a
// 3-point (PERT/triangular) distribution and propagates it through the
// dependency network (CPM) each iteration, producing a DISTRIBUTION of the
// project finish → P50/P80/P90 completion + a per-activity criticality index
// (how often each task lands on the critical path). The schedule analog of
// the cost/contingency MC (see calc/riskSimulation.ts).
//
// Uncertainty source: GLOBAL bands (no per-task data / no migration) — an
// activity's optimistic = m·(1−optPct), pessimistic = m·(1+pessPct), around
// its planned most-likely duration m. Distribution defaults to modified-PERT
// (beta, mode-weighted 4×); triangular is available too.
//
// Seeded PRNG → reproducible per project + inputs (stable UI, deterministic
// tests). When the project has no dependency network, falls back to a
// date-anchored independent-activity model (finish = max(startOffset+dur));
// the criticality index is only meaningful with a network.
// =====================================================================
import { computeCpm, type CpmEdgeInput } from './schedule.helpers.js';
import { seedFromString } from '../../calc/riskSimulation.js';

export { seedFromString };

export interface SimActivity {
  id: string;
  /** Planned (most-likely) duration in days. */
  duration: number;
  /** Days from the project's earliest start (used only for the no-network fallback). */
  startOffset: number;
}

export type SchedDistribution = 'pert' | 'triangular';

export interface SchedSimOptions {
  /** Trials. Default 5 000; clamped [1 000, 20 000] (a CPM pass per trial is heavier than the cost MC). */
  iterations?: number;
  /** Finish percentile (0..1). Default 0.8; clamped [0.5, 0.99]. */
  confidence?: number;
  /** Optimistic band fraction: optimistic = m·(1−optimisticPct). Default 0.15; clamped [0, 0.9]. */
  optimisticPct?: number;
  /** Pessimistic band fraction: pessimistic = m·(1+pessimisticPct). Default 0.40; clamped [0, 5]. */
  pessimisticPct?: number;
  distribution?: SchedDistribution;
  seed?: number;
  bins?: number;
}

export interface SchedPercentiles { p10: number; p50: number; p80: number; p90: number; p95: number }
export interface SchedBin { from: number; to: number; count: number }

export interface SchedSimResult {
  iterations: number;
  confidence: number;
  distribution: SchedDistribution;
  optimisticPct: number;
  pessimisticPct: number;
  hasNetwork: boolean;
  cyclic: boolean;
  activityCount: number;
  /** Project finish (duration in days) at the planned durations — the deterministic baseline. */
  deterministicDays: number;
  mean: number;
  min: number;
  max: number;
  percentiles: SchedPercentiles;
  /** Finish (days) at the chosen confidence — the recommended schedule. */
  recommendedDays: number;
  /** Fraction of trials finishing on or before the deterministic plan. */
  probabilityOnOrBeforePlan: number;
  histogram: SchedBin[];
  /** Per-activity fraction of trials in which it was critical (network only), sorted desc. */
  criticality: { id: string; index: number }[];
}

// mulberry32 — small, fast, seeded PRNG (deterministic).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal via Box-Muller (guards log(0)).
function normal(rng: () => number): number {
  const u1 = rng() || 1e-12;
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Gamma(shape k, scale 1) via Marsaglia–Tsang.
function gamma(rng: () => number, k: number): number {
  if (k < 1) return gamma(rng, k + 1) * Math.pow(rng() || 1e-12, 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Bounded iterations as a safety net (rejection converges fast; avoids any pathological loop).
  for (let i = 0; i < 1000; i++) {
    let x = 0;
    let v = 0;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u || 1e-12) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return d; // fallback ≈ mean
}

function beta(rng: () => number, a: number, b: number): number {
  const x = gamma(rng, a);
  const y = gamma(rng, b);
  const s = x + y;
  return s > 0 ? x / s : 0.5;
}

// One duration sample around most-likely m within [o, p].
function sampleDuration(rng: () => number, m: number, o: number, p: number, dist: SchedDistribution): number {
  if (!(p > o)) return Math.max(0, m);
  if (dist === 'triangular') {
    const u = rng();
    const c = (m - o) / (p - o);
    const x = u < c ? o + Math.sqrt(u * (p - o) * (m - o)) : p - Math.sqrt((1 - u) * (p - o) * (p - m));
    return Math.max(0, x);
  }
  // Modified-PERT (beta), mode weighted 4×.
  const lambda = 4;
  const a = 1 + (lambda * (m - o)) / (p - o);
  const b = 1 + (lambda * (p - m)) / (p - o);
  return Math.max(0, o + beta(rng, a, b) * (p - o));
}

function clampInt(n: number, lo: number, hi: number, dflt: number): number {
  const v = Math.round(Number.isFinite(n) ? n : dflt);
  return v < lo ? lo : v > hi ? hi : v;
}
function clampNum(n: number, lo: number, hi: number, dflt: number): number {
  const v = Number.isFinite(n) ? n : dflt;
  return v < lo ? lo : v > hi ? hi : v;
}
function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(q * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}
const r2 = (n: number) => Math.round(n * 100) / 100;

// Longest path (project finish, days) for a set of already-sampled durations.
function finishDays(
  durations: Map<string, number>,
  activities: SimActivity[],
  edges: CpmEdgeInput[],
  hasNetwork: boolean,
): { days: number; critical: string[] } {
  if (hasNetwork) {
    const cpm = computeCpm(
      activities.map((a) => ({ id: a.id, duration: durations.get(a.id) ?? 0 })),
      edges,
    );
    return { days: cpm.projectDuration, critical: cpm.criticalTaskIds };
  }
  // No dependency network: finish = the latest (start-offset + sampled duration).
  let days = 0;
  for (const a of activities) {
    const f = a.startOffset + (durations.get(a.id) ?? 0);
    if (f > days) days = f;
  }
  return { days, critical: [] };
}

export function simulateSchedule(
  activities: SimActivity[],
  edges: CpmEdgeInput[],
  opts: SchedSimOptions = {},
): SchedSimResult {
  const iterations = clampInt(opts.iterations ?? 5_000, 1_000, 20_000, 5_000);
  const confidence = clampNum(opts.confidence ?? 0.8, 0.5, 0.99, 0.8);
  const optimisticPct = clampNum(opts.optimisticPct ?? 0.15, 0, 0.9, 0.15);
  const pessimisticPct = clampNum(opts.pessimisticPct ?? 0.4, 0, 5, 0.4);
  const distribution: SchedDistribution = opts.distribution === 'triangular' ? 'triangular' : 'pert';
  const bins = clampInt(opts.bins ?? 24, 4, 60, 24);
  const rng = mulberry32(opts.seed ?? 1);

  const base = computeCpm(
    activities.map((a) => ({ id: a.id, duration: a.duration })),
    edges,
  );
  const hasNetwork = base.hasNetwork && !base.cyclic;

  const zero: SchedSimResult = {
    iterations, confidence, distribution, optimisticPct, pessimisticPct,
    hasNetwork: base.hasNetwork, cyclic: base.cyclic, activityCount: activities.length,
    deterministicDays: 0, mean: 0, min: 0, max: 0,
    percentiles: { p10: 0, p50: 0, p80: 0, p90: 0, p95: 0 },
    recommendedDays: 0, probabilityOnOrBeforePlan: 1, histogram: [], criticality: [],
  };
  if (activities.length === 0 || base.cyclic) return zero;

  const detPlanned = new Map(activities.map((a) => [a.id, a.duration]));
  const deterministicDays = finishDays(detPlanned, activities, edges, hasNetwork).days;

  // Precompute each activity's optimistic/pessimistic bounds around its planned duration.
  const bounds = activities.map((a) => ({ id: a.id, m: a.duration, o: a.duration * (1 - optimisticPct), p: a.duration * (1 + pessimisticPct) }));

  const samples = new Float64Array(iterations);
  const critCount = new Map<string, number>();
  const durs = new Map<string, number>();
  let sum = 0;
  let onOrBefore = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < iterations; i++) {
    // Round to whole days: schedules are day-based, and integer durations keep the CPM float
    // arithmetic exact so a critical task's totalFloat is exactly 0 (no fp-epsilon dropping it
    // out of the criticality tally).
    for (const b of bounds) durs.set(b.id, Math.max(0, Math.round(sampleDuration(rng, b.m, b.o, b.p, distribution))));
    const { days, critical } = finishDays(durs, activities, edges, hasNetwork);
    samples[i] = days;
    sum += days;
    if (days <= deterministicDays + 1e-9) onOrBefore++;
    if (days < min) min = days;
    if (days > max) max = days;
    for (const id of critical) critCount.set(id, (critCount.get(id) ?? 0) + 1);
  }

  const sorted = Array.from(samples).sort((a, b) => a - b);
  const mean = sum / iterations;

  // Histogram over [min, max].
  const span = max - min;
  const histogram: SchedBin[] = [];
  if (span <= 0) {
    histogram.push({ from: r2(min), to: r2(max), count: iterations });
  } else {
    const width = span / bins;
    const counts = new Array<number>(bins).fill(0);
    for (let i = 0; i < iterations; i++) {
      let b = Math.floor((sorted[i] - min) / width);
      if (b >= bins) b = bins - 1;
      if (b < 0) b = 0;
      counts[b]++;
    }
    for (let b = 0; b < bins; b++) histogram.push({ from: r2(min + b * width), to: r2(min + (b + 1) * width), count: counts[b] });
  }

  const criticality = hasNetwork
    ? Array.from(critCount.entries())
        .map(([id, c]) => ({ id, index: r2(c / iterations) }))
        .sort((a, b) => b.index - a.index)
    : [];

  return {
    iterations, confidence, distribution, optimisticPct, pessimisticPct,
    hasNetwork, cyclic: false, activityCount: activities.length,
    deterministicDays: r2(deterministicDays),
    mean: r2(mean), min: r2(min), max: r2(max),
    percentiles: {
      p10: r2(percentile(sorted, 0.1)), p50: r2(percentile(sorted, 0.5)),
      p80: r2(percentile(sorted, 0.8)), p90: r2(percentile(sorted, 0.9)), p95: r2(percentile(sorted, 0.95)),
    },
    recommendedDays: r2(percentile(sorted, confidence)),
    probabilityOnOrBeforePlan: r2(onOrBefore / iterations),
    histogram,
    criticality,
  };
}
