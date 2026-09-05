import { describe, it, expect } from 'vitest';
import { progressSeriesFromLeaves, type ProgressLeaf } from './evm.batch.js';

const D = (s: string): Date => new Date(s + 'T00:00:00.000Z');
const ms = (s: string): number => +D(s);

// Two equal-weight leaves: A completed (finished 01-15), B in-progress at 50% (started 01-20).
// Status date = 02-01. Plan window spans 01-01 → 03-01.
const leaves: ProgressLeaf[] = [
  { weight: 1, progressPct: 100, planStart: D('2026-01-01'), planEnd: D('2026-02-01'), baselineStart: null, baselineFinish: null, actualStart: D('2026-01-01'), actualFinish: D('2026-01-15') },
  { weight: 1, progressPct: 50, planStart: D('2026-01-15'), planEnd: D('2026-03-01'), baselineStart: null, baselineFinish: null, actualStart: D('2026-01-20'), actualFinish: null },
];
const statusDate = D('2026-02-01');

describe('progressSeriesFromLeaves', () => {
  it('actual at the status date equals weighted progress; future is null; planned is monotonic 0..1', () => {
    const dates = [ms('2026-01-01'), ms('2026-01-10'), ms('2026-01-15'), ms('2026-02-01'), ms('2026-03-01')];
    const s = progressSeriesFromLeaves(leaves, statusDate, dates);
    expect(s).toHaveLength(5);

    // Weighted progress = (1·1.0 + 1·0.5) / 2 = 0.75 — the actual point AT the status date.
    const atStatus = s.find((p) => p.t === D('2026-02-01').toISOString())!;
    expect(atStatus.actualPct).toBeCloseTo(0.75, 4);

    // Future date (after status): actual is null, planned still reported.
    const future = s[s.length - 1];
    expect(future.actualPct).toBeNull();
    expect(future.plannedPct).toBeGreaterThan(0);

    // Planned progress rises monotonically from 0 to 1 across the window.
    expect(s[0].plannedPct).toBe(0);
    for (let i = 1; i < s.length; i++) expect(s[i].plannedPct).toBeGreaterThanOrEqual(s[i - 1].plannedPct);
    expect(s[s.length - 1].plannedPct).toBeCloseTo(1, 4);

    // Actual is monotonic up to the status date too.
    const upto = s.filter((p) => p.actualPct != null).map((p) => p.actualPct!);
    for (let i = 1; i < upto.length; i++) expect(upto[i]).toBeGreaterThanOrEqual(upto[i - 1]);
  });

  it('a completed leaf earns from its actualFinish, not before its actualStart', () => {
    const one: ProgressLeaf[] = [leaves[0]]; // completed leaf only
    const s = progressSeriesFromLeaves(one, statusDate, [ms('2025-12-31'), ms('2026-01-15'), ms('2026-02-01')]);
    expect(s[0].actualPct).toBe(0); // before actualStart → nothing earned
    expect(s[1].actualPct).toBeCloseTo(1, 4); // at actualFinish → fully earned
    expect(s[2].actualPct).toBeCloseTo(1, 4); // stays complete
  });

  it('returns [] when there is no weight', () => {
    expect(progressSeriesFromLeaves([{ ...leaves[0], weight: 0 }], statusDate, [ms('2026-02-01')])).toEqual([]);
  });
});
