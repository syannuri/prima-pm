import { describe, it, expect } from 'vitest';
import { computeEvm, plannedProgress, type EvmTask } from '../evm.js';

const d = (s: string) => new Date(s);

describe('evm — planned progress', () => {
  const task: EvmTask = {
    budgetCost: 10_000_000,
    progressPct: 0,
    planStart: d('2026-01-01'),
    planEnd: d('2026-01-11'), // 10-day window
  };

  it('0% before start, 100% after end', () => {
    expect(plannedProgress(task, d('2025-12-30'))).toBe(0);
    expect(plannedProgress(task, d('2026-02-01'))).toBe(1);
  });

  it('linear midpoint ~50%', () => {
    expect(plannedProgress(task, d('2026-01-06'))).toBeCloseTo(0.5, 5);
  });

  it('measures PV against the BASELINE window, not the re-planned dates', () => {
    // Baseline says Jan 1–11; the plan was later pushed out to Feb. At Jan 6 the
    // baseline says 50% should be done — re-planning must NOT reset that to 0.
    const rebased: EvmTask = {
      budgetCost: 10_000_000,
      progressPct: 0,
      planStart: d('2026-02-01'),
      planEnd: d('2026-02-11'),
      baselineStart: d('2026-01-01'),
      baselineEnd: d('2026-01-11'),
    };
    expect(plannedProgress(rebased, d('2026-01-06'))).toBeCloseTo(0.5, 5);
  });

  it('falls back to plan dates when not yet baselined', () => {
    expect(plannedProgress(task, d('2026-01-06'))).toBeCloseTo(0.5, 5);
  });
});

describe('evm — full metric set', () => {
  // Two tasks, BAC = 20M. Status at day 6 of a 10-day plan.
  const tasks: EvmTask[] = [
    { budgetCost: 10_000_000, progressPct: 50, planStart: d('2026-01-01'), planEnd: d('2026-01-11') },
    { budgetCost: 10_000_000, progressPct: 25, planStart: d('2026-01-01'), planEnd: d('2026-01-11') },
  ];

  const r = computeEvm({ tasks, actualCost: 9_000_000, statusDate: d('2026-01-06') });

  it('BAC, EV, PV', () => {
    expect(r.bac).toBe(20_000_000);
    expect(r.ev).toBe(7_500_000); // 10M*0.5 + 10M*0.25
    expect(r.pv).toBe(10_000_000); // both 50% planned at midpoint
  });

  it('variances', () => {
    expect(r.cv).toBe(-1_500_000); // EV - AC
    expect(r.sv).toBe(-2_500_000); // EV - PV
  });

  it('indices', () => {
    expect(r.cpi).toBeCloseTo(0.8333, 4); // 7.5M / 9M
    expect(r.spi).toBe(0.75); // 7.5M / 10M
  });

  it('forecasts', () => {
    expect(r.eac).toBe(24_000_000); // BAC / CPI = 20M / 0.8333
    expect(r.vac).toBe(-4_000_000); // BAC - EAC
    expect(r.etc).toBe(15_000_000); // EAC - AC
  });

  it('health is RED when indices are poor', () => {
    expect(r.health).toBe('RED');
  });

  it('green health when on/ahead of plan and budget', () => {
    const good = computeEvm({
      tasks: [
        { budgetCost: 10_000_000, progressPct: 60, planStart: d('2026-01-01'), planEnd: d('2026-01-11') },
      ],
      actualCost: 5_500_000,
      statusDate: d('2026-01-06'),
    });
    expect(good.cpi).toBeGreaterThanOrEqual(0.95);
    expect(good.spi).toBeGreaterThanOrEqual(0.95);
    expect(good.health).toBe('GREEN');
  });

  it('handles zero actual cost without dividing by zero', () => {
    const z = computeEvm({
      tasks: [{ budgetCost: 10_000_000, progressPct: 0, planStart: d('2026-01-01'), planEnd: d('2026-01-11') }],
      actualCost: 0,
      statusDate: d('2026-01-01'),
    });
    expect(z.cpi).toBe(0);
    expect(z.eac).toBe(10_000_000);
  });
});

describe('evm — BAC distribution & weighting', () => {
  // Weights 3 & 1 (e.g. duration days), authoritative BAC = 100M. The 75%-weighted
  // task at 100% + the 25%-weighted task at 0% → 75% earned, EV = 75M of the real BAC.
  const tasks: EvmTask[] = [
    { budgetCost: 3, progressPct: 100, planStart: d('2026-01-01'), planEnd: d('2026-01-04') },
    { budgetCost: 1, progressPct: 0, planStart: d('2026-01-01'), planEnd: d('2026-01-02') },
  ];

  it('scales weights to the authoritative BAC (100% rule) and keeps EV in real money', () => {
    const r = computeEvm({ tasks, bac: 100_000_000, actualCost: 0, statusDate: d('2026-02-01') });
    expect(r.bac).toBe(100_000_000);
    expect(r.ev).toBe(75_000_000); // 3/4 of BAC earned
    expect(r.percentComplete).toBe(0.75); // EV / BAC
    expect(r.weightedProgress).toBe(0.75); // Σ(w·%)/Σw, BAC-independent
  });

  it('weightedProgress is valid even when BAC is unknown (0)', () => {
    const r = computeEvm({ tasks, actualCost: 0, statusDate: d('2026-02-01') });
    expect(r.weightedProgress).toBe(0.75);
  });

  it('health is NO_DATA when neither index is available (no AC, not started)', () => {
    const r = computeEvm({
      tasks: [{ budgetCost: 5, progressPct: 0, planStart: d('2026-06-01'), planEnd: d('2026-06-10') }],
      actualCost: 0,
      statusDate: d('2026-01-01'), // before start → PV = 0
    });
    expect(r.health).toBe('NO_DATA');
  });

  it('EAC exposes overrun when cost is incurred with no earned value', () => {
    const r = computeEvm({
      tasks: [{ budgetCost: 10_000_000, progressPct: 0, planStart: d('2026-01-01'), planEnd: d('2026-01-11') }],
      actualCost: 4_000_000, // spent 4M, earned nothing
      statusDate: d('2026-01-06'),
    });
    expect(r.eac).toBe(14_000_000); // AC + (BAC - EV) = 4M + 10M
    expect(r.vac).toBe(-4_000_000); // BAC - EAC → forecast overrun
  });
});
