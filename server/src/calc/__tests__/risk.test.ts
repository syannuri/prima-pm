import { describe, it, expect } from 'vitest';
import {
  riskScore,
  severityFromScore,
  emv,
  contingencyReserve,
} from '../risk.js';

describe('risk — qualitative', () => {
  it('risk score = probability × impact', () => {
    expect(riskScore(4, 5)).toBe(20);
    expect(riskScore(3, 3)).toBe(9);
  });

  it('clamps scores to the 1..5 scale', () => {
    expect(riskScore(0, 7)).toBe(5); // 1 × 5
    expect(riskScore(9, 9)).toBe(25); // 5 × 5
  });

  it('maps score to severity bands (default thresholds)', () => {
    expect(severityFromScore(4)).toBe('LOW');
    expect(severityFromScore(10)).toBe('MEDIUM');
    expect(severityFromScore(16)).toBe('HIGH');
    expect(severityFromScore(25)).toBe('CRITICAL');
  });
});

describe('risk — EMV', () => {
  it('threat EMV is positive = prob × impact', () => {
    expect(emv(0.3, 100_000_000, 'THREAT')).toBe(30_000_000);
  });

  it('opportunity EMV is negative', () => {
    expect(emv(0.25, 40_000_000, 'OPPORTUNITY')).toBe(-10_000_000);
  });

  it('clamps probability into 0..1', () => {
    expect(emv(1.5, 10_000_000)).toBe(10_000_000); // prob clamped to 1
    expect(emv(-1, 10_000_000)).toBe(0);
  });
});

describe('risk — contingency reserve', () => {
  const risks = [
    { kind: 'THREAT' as const, emv: 30_000_000, residualEmv: 18_000_000, includeInReserve: true },
    { kind: 'THREAT' as const, emv: 5_000_000, residualEmv: 5_000_000, includeInReserve: true },
    { kind: 'THREAT' as const, emv: 9_000_000, residualEmv: 9_000_000, includeInReserve: false }, // excluded
    { kind: 'OPPORTUNITY' as const, emv: -10_000_000, residualEmv: -10_000_000, includeInReserve: true },
  ];

  it('sums residual EMV of included threats only (default)', () => {
    const r = contingencyReserve(risks);
    expect(r.threatReserve).toBe(23_000_000); // 18M + 5M (excluded 9M ignored)
    expect(r.contingencyReserve).toBe(23_000_000);
  });

  it('falls back to gross EMV when residual not provided', () => {
    const r = contingencyReserve([
      { kind: 'THREAT', emv: 12_000_000, includeInReserve: true },
    ]);
    expect(r.contingencyReserve).toBe(12_000_000);
  });

  it('nets opportunities when enabled', () => {
    const r = contingencyReserve(risks, { netOpportunities: true });
    expect(r.opportunityOffset).toBe(10_000_000);
    expect(r.contingencyReserve).toBe(13_000_000); // 23M - 10M
  });

  it('applies a confidence factor', () => {
    const r = contingencyReserve(risks, { confidenceFactor: 1.1 });
    expect(r.contingencyReserve).toBe(25_300_000); // 23M × 1.1
  });

  it('never returns a negative reserve', () => {
    const r = contingencyReserve(
      [{ kind: 'OPPORTUNITY', emv: -50_000_000, includeInReserve: true }],
      { netOpportunities: true },
    );
    expect(r.contingencyReserve).toBe(0);
  });
});
