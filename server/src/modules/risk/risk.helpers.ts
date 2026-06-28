// =====================================================================
// Risk Management — pure derivation & aggregation helpers (no DB). Tested.
// Wraps the calc/risk primitives into the shape the service persists.
// =====================================================================
import {
  riskScore as calcRiskScore,
  severityFromScore,
  emv as calcEmv,
  contingencyReserve,
  DEFAULT_SEVERITY_THRESHOLDS,
  type Severity,
  type RiskKind,
  type SeverityThresholds,
  type RiskForReserve,
  type ContingencyOptions,
} from '../../calc/risk.js';

export interface RiskMetricsInput {
  probabilityScore: number; // 1..5
  impactScore: number; // 1..5
  probabilityPct: number; // 0..1
  impactCostIdr: number;
  kind: RiskKind;
  // Optional residual (post-response) figures:
  residualProbabilityPct?: number | null;
  residualImpactCost?: number | null;
}

export interface RiskMetrics {
  riskScore: number;
  severity: Severity;
  emv: number;
  /** null when no residual inputs supplied -> reserve falls back to gross EMV. */
  residualEmv: number | null;
}

/** Derive all stored risk metrics from raw inputs (single source of truth). */
export function deriveRiskMetrics(
  input: RiskMetricsInput,
  thresholds: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
): RiskMetrics {
  const score = calcRiskScore(input.probabilityScore, input.impactScore);
  const severity = severityFromScore(score, thresholds);
  const emv = calcEmv(input.probabilityPct, input.impactCostIdr, input.kind);

  let residualEmv: number | null = null;
  if (input.residualProbabilityPct != null && input.residualImpactCost != null) {
    residualEmv = calcEmv(input.residualProbabilityPct, input.residualImpactCost, input.kind);
  }

  return { riskScore: score, severity, emv, residualEmv };
}

/** Generate a per-project risk code: R-001, R-002, ... */
export function generateRiskCode(seq: number): string {
  return `R-${String(seq).padStart(3, '0')}`;
}

// --- Aggregations for the dashboard ---

export interface HeatmapCell {
  probability: number; // 1..5
  impact: number; // 1..5
  count: number;
  score: number; // probability * impact
}

/** Build a 5x5 heat-map (probability × impact) with risk counts per cell. */
export function buildHeatmap(
  risks: Array<{ probabilityScore: number; impactScore: number }>,
): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  for (let p = 1; p <= 5; p++) {
    for (let i = 1; i <= 5; i++) {
      cells.push({ probability: p, impact: i, count: 0, score: p * i });
    }
  }
  for (const r of risks) {
    const p = clamp15(r.probabilityScore);
    const i = clamp15(r.impactScore);
    const cell = cells.find((c) => c.probability === p && c.impact === i);
    if (cell) cell.count += 1;
  }
  return cells;
}

function clamp15(n: number): number {
  const v = Math.round(n);
  return v < 1 ? 1 : v > 5 ? 5 : v;
}

export interface RiskSummary {
  total: number;
  bySeverity: Record<Severity, number>;
  topByEmv: Array<{ id: string; code: string; title: string; emv: number }>;
  reserve: ReturnType<typeof contingencyReserve>;
}

/** Summarize a project's risks: severity counts, EMV ranking, contingency reserve. */
export function summarizeRisks(
  risks: Array<{
    id: string;
    code: string;
    title: string;
    severity: Severity;
    kind: RiskKind;
    emv: number;
    residualEmv: number | null;
    includeInReserve: boolean;
  }>,
  opts?: ContingencyOptions,
  limit = 5,
): RiskSummary {
  const bySeverity: Record<Severity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const r of risks) bySeverity[r.severity] += 1;

  const topByEmv = [...risks]
    .sort((a, b) => Math.abs(b.emv) - Math.abs(a.emv))
    .slice(0, limit)
    .map((r) => ({ id: r.id, code: r.code, title: r.title, emv: r.emv }));

  const reserve = contingencyReserve(
    risks.map<RiskForReserve>((r) => ({
      kind: r.kind,
      emv: r.emv,
      residualEmv: r.residualEmv,
      includeInReserve: r.includeInReserve,
    })),
    opts,
  );

  return { total: risks.length, bySeverity, topByEmv, reserve };
}
