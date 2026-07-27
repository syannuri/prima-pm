import { describe, it, expect } from 'vitest';
import { eacScenarios } from './forecast.service.js';

// Pure EAC-scenario maths (no DB). The invariant that matters for the UI: whatever the
// performance, the three cards must read best ≤ likely ≤ worst.
describe('eacScenarios', () => {
  it('keeps best ≤ likely ≤ worst even when the project runs UNDER budget (CPI>1)', () => {
    // BAC 100, EV 50, AC 40 → CPI 1.25. The "remaining-at-plan" figure (90) is HIGHER than the
    // trend figure (80); the naive labelling used to show that as "best case".
    const s = eacScenarios(100, 50, 40, 1.25, 1);
    expect(s.likely).toBe(80); // BAC / CPI
    expect(s.optimistic).toBeLessThanOrEqual(s.likely);
    expect(s.pessimistic).toBeGreaterThanOrEqual(s.likely);
    expect(s.optimistic).toBe(80); // min(90, 80, 80)
  });

  it('orders correctly when OVER budget & behind schedule (CPI<1, SPI<1)', () => {
    // BAC 100, EV 40, AC 50 → CPI 0.8, SPI 0.8. Trend 125; both-drag = 50 + 60/0.64 ≈ 143.75.
    const s = eacScenarios(100, 40, 50, 0.8, 0.8);
    expect(s.optimistic).toBeLessThanOrEqual(s.likely);
    expect(s.likely).toBeLessThanOrEqual(s.pessimistic);
    expect(s.likely).toBe(125);
    expect(s.pessimistic).toBeCloseTo(143.75, 2);
  });

  it('falls back to BAC when there is no cost performance yet (CPI=0)', () => {
    const s = eacScenarios(100, 0, 0, 0, 0);
    expect(s.likely).toBe(100);
    expect(s.optimistic).toBe(100);
    expect(s.pessimistic).toBe(100);
  });
});
