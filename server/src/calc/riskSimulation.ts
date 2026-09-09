// =====================================================================
// RISK MANAGEMENT — Quantitative Monte-Carlo simulation (Module 3, cont.)
// Turns the register's per-risk probability × impact into a *distribution*
// of total exposure, so the contingency reserve can be set at a chosen
// confidence level (P80…) instead of a single expected value.
//
// Model (point-impact): each included risk either occurs or not in a given
// iteration ~ Bernoulli(probabilityPct). When it occurs it adds its impact.
// The per-occurrence impact is derived so the simulation MEAN ties back to
// the deterministic reserve: impact = (residualEmv ?? emv) / probability,
// hence E[contribution] = p · impact = residualEmv ?? emv. Summed over risks
// per iteration and repeated N times yields the exposure distribution.
//
// The PRNG is seeded so results are reproducible for a given project + inputs
// (stable UI, deterministic tests).
// =====================================================================
import { round2 } from './money.js';
import type { RiskKind } from './risk.js';

export interface RiskForSim {
  kind: RiskKind;
  includeInReserve: boolean;
  /** Occurrence probability, fraction 0..1. */
  probabilityPct: number;
  /** Gross expected monetary value (magnitude), = probability × impact. */
  emv: number;
  /** Residual EMV after response; falls back to gross emv when null. */
  residualEmv?: number | null;
}

export interface SimOptions {
  /** Number of trials. Default 10 000; clamped to [1 000, 50 000]. */
  iterations?: number;
  /** Reserve percentile (0..1). Default 0.8; clamped to [0.5, 0.99]. */
  confidence?: number;
  /** If true, opportunities offset exposure. Default false (threats only, matching the reserve). */
  netOpportunities?: boolean;
  /** PRNG seed for reproducibility. Default 1. */
  seed?: number;
  /** Histogram bucket count. Default 24; clamped to [4, 60]. */
  bins?: number;
}

export interface SimPercentiles {
  p10: number;
  p50: number;
  p80: number;
  p90: number;
  p95: number;
}

export interface SimBin {
  from: number;
  to: number;
  count: number;
}

export interface RiskSimulationResult {
  iterations: number;
  confidence: number;
  /** Active risks actually simulated (included, probability > 0, non-zero effect). */
  riskCount: number;
  mean: number;
  min: number;
  max: number;
  percentiles: SimPercentiles;
  /** Exposure at the chosen confidence level — the recommended reserve. */
  recommendedReserve: number;
  /** Σ (residualEmv ?? emv) of the simulated risks — mean should converge to this. */
  deterministicEmv: number;
  /** Fraction of iterations in which no simulated risk occurred (zero exposure). */
  probabilityOfZero: number;
  histogram: SimBin[];
}

// mulberry32 — a tiny, fast, well-distributed seeded PRNG (deterministic).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string → a seed (so a project's sim is reproducible). */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function clampInt(n: number, lo: number, hi: number, dflt: number): number {
  const v = Math.round(Number.isFinite(n) ? n : dflt);
  return v < lo ? lo : v > hi ? hi : v;
}

// Nearest-rank percentile over an ascending-sorted array.
function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(q * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

const EMPTY: Omit<RiskSimulationResult, 'iterations' | 'confidence'> = {
  riskCount: 0,
  mean: 0,
  min: 0,
  max: 0,
  percentiles: { p10: 0, p50: 0, p80: 0, p90: 0, p95: 0 },
  recommendedReserve: 0,
  deterministicEmv: 0,
  probabilityOfZero: 1,
  histogram: [],
};

/**
 * Run the Monte-Carlo exposure simulation over a project's risks.
 * Pure & deterministic for a fixed seed + inputs.
 */
export function simulateRiskExposure(
  risks: RiskForSim[],
  opts: SimOptions = {},
): RiskSimulationResult {
  const iterations = clampInt(opts.iterations ?? 10_000, 1_000, 50_000, 10_000);
  const confidence = Math.min(0.99, Math.max(0.5, opts.confidence ?? 0.8));
  const netOpportunities = opts.netOpportunities ?? false;
  const bins = clampInt(opts.bins ?? 24, 4, 60, 24);
  const rng = mulberry32(opts.seed ?? 1);

  // Build the active set: included risks with a real occurrence chance and effect.
  const active = risks
    .filter((r) => r.includeInReserve)
    .map((r) => {
      const p = clamp01(r.probabilityPct);
      const sign = r.kind === 'OPPORTUNITY' ? (netOpportunities ? -1 : 0) : 1;
      const expected = Math.abs(r.residualEmv ?? r.emv); // magnitude of the expected value
      const impact = p > 0 ? expected / p : 0;           // per-occurrence impact (EMV-preserving)
      return { p, sign, impact, expected: sign * expected };
    })
    .filter((r) => r.p > 0 && r.sign !== 0 && r.impact > 0);

  if (active.length === 0) {
    return { iterations, confidence, ...EMPTY };
  }

  const deterministicEmv = round2(active.reduce((a, r) => a + r.expected, 0));

  const samples = new Float64Array(iterations);
  let sum = 0;
  let zeroCount = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let k = 0; k < active.length; k++) {
      if (rng() < active[k].p) s += active[k].sign * active[k].impact;
    }
    samples[i] = s;
    sum += s;
    if (s === 0) zeroCount++;
    if (s < min) min = s;
    if (s > max) max = s;
  }

  const sorted = Array.from(samples).sort((a, b) => a - b);
  const mean = round2(sum / iterations);
  const recommendedReserve = round2(Math.max(0, percentile(sorted, confidence)));

  // Histogram over [min, max] into `bins` equal buckets.
  const span = max - min;
  const histogram: SimBin[] = [];
  if (span <= 0) {
    histogram.push({ from: round2(min), to: round2(max), count: iterations });
  } else {
    const width = span / bins;
    const counts = new Array<number>(bins).fill(0);
    for (let i = 0; i < iterations; i++) {
      let b = Math.floor((sorted[i] - min) / width);
      if (b >= bins) b = bins - 1;
      if (b < 0) b = 0;
      counts[b]++;
    }
    for (let b = 0; b < bins; b++) {
      histogram.push({ from: round2(min + b * width), to: round2(min + (b + 1) * width), count: counts[b] });
    }
  }

  return {
    iterations,
    confidence,
    riskCount: active.length,
    mean,
    min: round2(min),
    max: round2(max),
    percentiles: {
      p10: round2(percentile(sorted, 0.1)),
      p50: round2(percentile(sorted, 0.5)),
      p80: round2(percentile(sorted, 0.8)),
      p90: round2(percentile(sorted, 0.9)),
      p95: round2(percentile(sorted, 0.95)),
    },
    recommendedReserve,
    deterministicEmv,
    probabilityOfZero: round2(zeroCount / iterations),
    histogram,
  };
}
