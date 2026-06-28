import { describe, it, expect } from 'vitest';
import {
  deriveRiskMetrics,
  generateRiskCode,
  buildHeatmap,
  summarizeRisks,
} from '../risk.helpers.js';

describe('risk — derive metrics', () => {
  it('computes score, severity and gross EMV', () => {
    const m = deriveRiskMetrics({
      probabilityScore: 4,
      impactScore: 5,
      probabilityPct: 0.4,
      impactCostIdr: 100_000_000,
      kind: 'THREAT',
    });
    expect(m.riskScore).toBe(20);
    expect(m.severity).toBe('CRITICAL');
    expect(m.emv).toBe(40_000_000);
    expect(m.residualEmv).toBeNull(); // no residual inputs
  });

  it('computes residual EMV when residual inputs supplied', () => {
    const m = deriveRiskMetrics({
      probabilityScore: 3,
      impactScore: 3,
      probabilityPct: 0.4,
      impactCostIdr: 100_000_000,
      kind: 'THREAT',
      residualProbabilityPct: 0.1,
      residualImpactCost: 100_000_000,
    });
    expect(m.emv).toBe(40_000_000);
    expect(m.residualEmv).toBe(10_000_000);
  });

  it('opportunity EMV is negative', () => {
    const m = deriveRiskMetrics({
      probabilityScore: 2,
      impactScore: 2,
      probabilityPct: 0.5,
      impactCostIdr: 20_000_000,
      kind: 'OPPORTUNITY',
    });
    expect(m.emv).toBe(-10_000_000);
  });
});

describe('risk — code generation', () => {
  it('zero-pads to 3 digits', () => {
    expect(generateRiskCode(1)).toBe('R-001');
    expect(generateRiskCode(42)).toBe('R-042');
  });
});

describe('risk — heatmap', () => {
  it('produces 25 cells and counts placements', () => {
    const cells = buildHeatmap([
      { probabilityScore: 5, impactScore: 5 },
      { probabilityScore: 5, impactScore: 5 },
      { probabilityScore: 1, impactScore: 2 },
    ]);
    expect(cells).toHaveLength(25);
    expect(cells.find((c) => c.probability === 5 && c.impact === 5)!.count).toBe(2);
    expect(cells.find((c) => c.probability === 1 && c.impact === 2)!.count).toBe(1);
    expect(cells.find((c) => c.probability === 3 && c.impact === 3)!.count).toBe(0);
  });
});

describe('risk — summary', () => {
  const risks = [
    { id: '1', code: 'R-001', title: 'Vendor delay', severity: 'HIGH' as const, kind: 'THREAT' as const, emv: 30_000_000, residualEmv: 18_000_000, includeInReserve: true },
    { id: '2', code: 'R-002', title: 'Scope creep', severity: 'CRITICAL' as const, kind: 'THREAT' as const, emv: 50_000_000, residualEmv: null, includeInReserve: true },
    { id: '3', code: 'R-003', title: 'Early discount', severity: 'LOW' as const, kind: 'OPPORTUNITY' as const, emv: -10_000_000, residualEmv: null, includeInReserve: true },
  ];

  it('counts by severity', () => {
    const s = summarizeRisks(risks);
    expect(s.total).toBe(3);
    expect(s.bySeverity.HIGH).toBe(1);
    expect(s.bySeverity.CRITICAL).toBe(1);
    expect(s.bySeverity.LOW).toBe(1);
  });

  it('ranks by absolute EMV', () => {
    const s = summarizeRisks(risks);
    expect(s.topByEmv[0].code).toBe('R-002'); // 50M
    expect(s.topByEmv[1].code).toBe('R-001'); // 30M (residual 18M but ranking uses gross emv)
  });

  it('reserve sums residual (or gross) EMV of threats', () => {
    const s = summarizeRisks(risks);
    // R-001 residual 18M + R-002 gross 50M = 68M (opportunity excluded by default)
    expect(s.reserve.contingencyReserve).toBe(68_000_000);
  });
});
