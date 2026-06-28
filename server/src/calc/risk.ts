// =====================================================================
// RISK MANAGEMENT calculations (Module 3)
// Qualitative (P×I, 5x5 severity) + Quantitative (EMV) -> Contingency Reserve
// =====================================================================
import { round2, sumMoney } from './money.js';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskKind = 'THREAT' | 'OPPORTUNITY';

// --- Qualitative ---

/** Risk Score = Probability(1..5) × Impact(1..5) -> 1..25 */
export function riskScore(probabilityScore: number, impactScore: number): number {
  return clampScale(probabilityScore) * clampScale(impactScore);
}

function clampScale(n: number): number {
  const v = Math.round(n);
  if (v < 1) return 1;
  if (v > 5) return 5;
  return v;
}

export interface SeverityThresholds {
  // upper bound (inclusive) for each band on a 1..25 score
  lowMax: number; // e.g. 5
  mediumMax: number; // e.g. 12
  highMax: number; // e.g. 19  (above -> CRITICAL, max 25)
}

export const DEFAULT_SEVERITY_THRESHOLDS: SeverityThresholds = {
  lowMax: 5,
  mediumMax: 12,
  highMax: 19,
};

/** Map a 1..25 risk score to a severity band (configurable thresholds). */
export function severityFromScore(
  score: number,
  t: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
): Severity {
  if (score <= t.lowMax) return 'LOW';
  if (score <= t.mediumMax) return 'MEDIUM';
  if (score <= t.highMax) return 'HIGH';
  return 'CRITICAL';
}

// --- Quantitative (EMV) ---

/**
 * Expected Monetary Value.
 * @param probabilityPct fraction 0..1
 * @param impactCost monetary impact in IDR (always provide a positive magnitude)
 * @param kind THREAT -> positive EMV (cost/reserve); OPPORTUNITY -> negative EMV (benefit)
 */
export function emv(
  probabilityPct: number,
  impactCost: number,
  kind: RiskKind = 'THREAT',
): number {
  const p = clamp01(probabilityPct);
  const magnitude = round2(p * Math.abs(impactCost || 0));
  return kind === 'OPPORTUNITY' ? -magnitude : magnitude;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// --- Contingency Reserve ---

export interface RiskForReserve {
  kind: RiskKind;
  /** Residual EMV after response (falls back to gross EMV if not provided). */
  residualEmv?: number | null;
  emv: number;
  includeInReserve: boolean;
}

export interface ContingencyOptions {
  /** If true, opportunities (negative EMV) offset the reserve. Default false (threats only). */
  netOpportunities?: boolean;
  /** Optional confidence multiplier (e.g. 1.1 for +10% buffer). Default 1. */
  confidenceFactor?: number;
}

export interface ContingencyResult {
  threatReserve: number; // Σ residual EMV of threats
  opportunityOffset: number; // Σ |residual EMV| of opportunities (as positive number)
  confidenceFactor: number;
  contingencyReserve: number; // final reserve fed to Cost roll-up (never negative)
}

/**
 * Contingency Reserve = Σ residual EMV of included THREATS
 * (optionally net of opportunities), times an optional confidence factor.
 * Clamped at 0 (a reserve is never negative).
 */
export function contingencyReserve(
  risks: RiskForReserve[],
  opts: ContingencyOptions = {},
): ContingencyResult {
  const confidenceFactor = opts.confidenceFactor ?? 1;
  const included = risks.filter((r) => r.includeInReserve);

  const threatReserve = sumMoney(
    included
      .filter((r) => r.kind === 'THREAT')
      .map((r) => r.residualEmv ?? r.emv),
  );

  const opportunityOffset = sumMoney(
    included
      .filter((r) => r.kind === 'OPPORTUNITY')
      .map((r) => Math.abs(r.residualEmv ?? r.emv)),
  );

  const base = opts.netOpportunities ? threatReserve - opportunityOffset : threatReserve;
  const contingency = Math.max(0, round2(base * confidenceFactor));

  return {
    threatReserve,
    opportunityOffset,
    confidenceFactor,
    contingencyReserve: contingency,
  };
}
