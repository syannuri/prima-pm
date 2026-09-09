import { describe, it, expect } from 'vitest';
import { simulateRiskExposure, seedFromString, type RiskForSim } from '../riskSimulation.js';

const threat = (probabilityPct: number, impact: number, extra: Partial<RiskForSim> = {}): RiskForSim => ({
  kind: 'THREAT',
  includeInReserve: true,
  probabilityPct,
  emv: probabilityPct * impact,
  residualEmv: null,
  ...extra,
});

describe('riskSimulation — Monte-Carlo exposure', () => {
  it('is deterministic for a fixed seed + inputs', () => {
    const risks = [threat(0.3, 10_000_000), threat(0.5, 4_000_000), threat(0.1, 20_000_000)];
    const a = simulateRiskExposure(risks, { iterations: 5_000, seed: 42 });
    const b = simulateRiskExposure(risks, { iterations: 5_000, seed: 42 });
    expect(b).toEqual(a);
  });

  it('mean converges to the deterministic EMV (Σ residualEmv ?? emv)', () => {
    const risks = [threat(0.3, 10_000_000), threat(0.5, 4_000_000), threat(0.2, 15_000_000)];
    const r = simulateRiskExposure(risks, { iterations: 40_000, seed: 7 });
    // Σ emv = 3.0M + 2.0M + 3.0M = 8.0M
    expect(r.deterministicEmv).toBeCloseTo(8_000_000, 0);
    // With enough trials the sampled mean tracks the expected value within ~2%.
    expect(Math.abs(r.mean - r.deterministicEmv) / r.deterministicEmv).toBeLessThan(0.02);
  });

  it('produces a monotonic percentile ladder with the reserve at the confidence level', () => {
    const risks = [threat(0.4, 8_000_000), threat(0.25, 12_000_000), threat(0.15, 30_000_000)];
    const r = simulateRiskExposure(risks, { iterations: 20_000, seed: 3, confidence: 0.8 });
    const { p10, p50, p80, p90, p95 } = r.percentiles;
    expect(p10).toBeLessThanOrEqual(p50);
    expect(p50).toBeLessThanOrEqual(p80);
    expect(p80).toBeLessThanOrEqual(p90);
    expect(p90).toBeLessThanOrEqual(p95);
    expect(r.recommendedReserve).toBe(p80);
    // A confident reserve should exceed the mean (the point of quantifying the tail).
    expect(r.recommendedReserve).toBeGreaterThan(r.mean);
  });

  it('uses residual EMV over gross when present (post-response)', () => {
    const risks = [threat(0.5, 20_000_000, { residualEmv: 2_000_000 })]; // gross emv 10M, residual 2M
    const r = simulateRiskExposure(risks, { iterations: 20_000, seed: 11 });
    expect(r.deterministicEmv).toBeCloseTo(2_000_000, 0);
  });

  it('excludes risks flagged out of the reserve, and zero-probability risks', () => {
    const risks = [threat(0.5, 10_000_000, { includeInReserve: false }), threat(0, 10_000_000)];
    const r = simulateRiskExposure(risks, { iterations: 2_000, seed: 1 });
    expect(r.riskCount).toBe(0);
    expect(r.recommendedReserve).toBe(0);
    expect(r.probabilityOfZero).toBe(1);
  });

  it('ignores opportunities by default but nets them when asked', () => {
    const risks: RiskForSim[] = [
      threat(0.5, 10_000_000),
      { kind: 'OPPORTUNITY', includeInReserve: true, probabilityPct: 0.5, emv: 4_000_000, residualEmv: null },
    ];
    const base = simulateRiskExposure(risks, { iterations: 20_000, seed: 5 });
    const net = simulateRiskExposure(risks, { iterations: 20_000, seed: 5, netOpportunities: true });
    expect(base.riskCount).toBe(1); // threat only
    expect(net.riskCount).toBe(2);
    expect(net.mean).toBeLessThan(base.mean); // opportunity pulls exposure down
  });

  it('handles an empty register without throwing', () => {
    const r = simulateRiskExposure([], { iterations: 1_000, seed: 1 });
    expect(r.riskCount).toBe(0);
    expect(r.histogram).toEqual([]);
    expect(r.recommendedReserve).toBe(0);
  });

  it('clamps iterations and confidence into range', () => {
    const r = simulateRiskExposure([threat(0.5, 1_000_000)], { iterations: 10, confidence: 2, seed: 1 });
    expect(r.iterations).toBe(1_000); // floored to the minimum
    expect(r.confidence).toBe(0.99); // capped
  });

  it('seedFromString is stable and varies by input', () => {
    expect(seedFromString('project-a')).toBe(seedFromString('project-a'));
    expect(seedFromString('project-a')).not.toBe(seedFromString('project-b'));
  });
});
