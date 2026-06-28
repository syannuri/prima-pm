import { describe, it, expect } from 'vitest';
import { round2, sumMoney } from '../money.js';

describe('money — rounding', () => {
  it('rounds half-up to 2 decimals', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(0.1 + 0.2)).toBe(0.3); // classic FP case
  });

  it('handles negatives symmetrically', () => {
    expect(round2(-1.005)).toBe(-1.01);
  });

  it('returns 0 for non-finite', () => {
    expect(round2(NaN)).toBe(0);
    expect(round2(Infinity)).toBe(0);
  });

  it('sumMoney accumulates and rounds, ignoring invalid', () => {
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
    expect(sumMoney([1_000_000, NaN, 500_000])).toBe(1_500_000);
  });
});
