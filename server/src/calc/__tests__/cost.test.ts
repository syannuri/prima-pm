import { describe, it, expect } from 'vitest';
import {
  materialAmount,
  manpowerCost,
  directTotal,
  indirectTotal,
  rollupCost,
  charterVariance,
} from '../cost.js';

describe('cost — line calculations', () => {
  it('material amount = qty × unitCost', () => {
    expect(materialAmount(3, 1_500_000)).toBe(4_500_000);
  });

  it('manpower cost = rate × mandays', () => {
    expect(manpowerCost(2_000_000, 12)).toBe(24_000_000);
  });

  it('handles fractional mandays with 2-decimal rounding', () => {
    expect(manpowerCost(1_000_000, 0.5)).toBe(500_000);
    expect(manpowerCost(333_333.33, 3)).toBe(999_999.99);
  });

  it('treats missing/invalid inputs as zero', () => {
    expect(materialAmount(NaN as unknown as number, 100)).toBe(0);
    expect(manpowerCost(100, undefined as unknown as number)).toBe(0);
  });
});

describe('cost — totals', () => {
  it('direct total sums material amounts and manpower costs', () => {
    const total = directTotal([
      { amount: 4_500_000 }, // material
      { amount: 10_000_000 }, // material
      { manpowerCost: 24_000_000 }, // manpower
      { manpowerCost: 6_000_000 }, // manpower
    ]);
    expect(total).toBe(44_500_000);
  });

  it('counts manpower lines whose amount is explicitly null (regression)', () => {
    // A manpower line carries manpowerCost with amount=null; it must not be skipped.
    expect(directTotal([
      { amount: null, manpowerCost: 60_000_000 },
      { amount: 10_000_000, manpowerCost: null },
    ])).toBe(70_000_000);
  });

  it('indirect total sums transport/accommodation/entertainment', () => {
    expect(
      indirectTotal([{ amount: 2_000_000 }, { amount: 3_500_000 }, { amount: 1_000_000 }]),
    ).toBe(6_500_000);
  });
});

describe('cost — roll-up & baseline', () => {
  it('costBaseline = direct + indirect + contingency; BAC adds management reserve', () => {
    const r = rollupCost({
      directTotal: 44_500_000,
      indirectTotal: 6_500_000,
      contingencyReserve: 5_000_000,
      managementReserve: 3_000_000,
    });
    expect(r.costBaseline).toBe(56_000_000);
    expect(r.budgetAtCompletion).toBe(59_000_000);
  });

  it('defaults management reserve to 0', () => {
    const r = rollupCost({ directTotal: 10_000_000, indirectTotal: 0, contingencyReserve: 0 });
    expect(r.managementReserve).toBe(0);
    expect(r.budgetAtCompletion).toBe(10_000_000);
  });
});

describe('cost — charter vs baseline variance', () => {
  it('flags overrun when baseline exceeds the committed high-level cost', () => {
    const v = charterVariance(50_000_000, 56_000_000);
    expect(v.variance).toBe(6_000_000);
    expect(v.variancePct).toBe(12);
    expect(v.isOverrun).toBe(true);
  });

  it('not an overrun when baseline is under estimate', () => {
    const v = charterVariance(50_000_000, 45_000_000);
    expect(v.variance).toBe(-5_000_000);
    expect(v.isOverrun).toBe(false);
  });
});
