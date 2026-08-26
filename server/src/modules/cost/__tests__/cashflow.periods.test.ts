import { describe, it, expect } from 'vitest';
import { enumeratePeriods, assembleCashflow, type Period } from '../cashflow.periods.js';

const U = (y: number, m: number, d = 1) => Date.UTC(y, m, d); // month is 0-based

describe('enumeratePeriods', () => {
  it('buckets a window into calendar months', () => {
    const ps = enumeratePeriods(U(2026, 0, 1), U(2026, 2, 31), 'month');
    expect(ps.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(ps[0].label).toBe('Jan 2026');
    // endMs is the exclusive next-period boundary
    expect(ps[0].endMs).toBe(U(2026, 1, 1));
  });

  it('buckets into calendar quarters', () => {
    const ps = enumeratePeriods(U(2026, 1, 15), U(2026, 7, 10), 'quarter');
    expect(ps.map((p) => p.key)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3']);
  });

  it('buckets into Monday-aligned weeks', () => {
    const ps = enumeratePeriods(U(2026, 0, 1), U(2026, 0, 20), 'week');
    // Jan 1 2026 is a Thursday → first week starts Mon Dec 29 2025
    expect(ps.length).toBe(4);
    expect(new Date(ps[0].startMs).getUTCDay()).toBe(1); // Monday
    expect(ps[1].startMs - ps[0].startMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('always returns at least one period', () => {
    expect(enumeratePeriods(U(2026, 0, 1), U(2026, 0, 1), 'month').length).toBe(1);
  });
});

describe('assembleCashflow', () => {
  // Linear cumulative PV: 0 → 300 across Jan1..Apr1; AC 80 spent by the status date (Feb1).
  const pv = new Map<number, number>([
    [U(2026, 0), 0],
    [U(2026, 1), 100],
    [U(2026, 2), 200],
    [U(2026, 3), 300],
  ]);
  const ac = new Map<number, number>([
    [U(2026, 0), 0],
    [U(2026, 1), 80],
  ]);
  const periods: Period[] = enumeratePeriods(U(2026, 0, 1), U(2026, 2, 31), 'month');
  const committed: Record<string, number> = { '2026-02': 50 };

  const out = assembleCashflow({
    periods,
    pvAt: (ms) => pv.get(ms) ?? 0,
    acAt: (ms) => ac.get(ms) ?? 0,
    committedInPeriod: (p) => committed[p.key] ?? 0,
    nowMs: U(2026, 1), // Feb 1
    eacLikely: 320,
    windowEndMs: U(2026, 3), // Apr 1
  });

  it('reports AC to date and remaining EAC', () => {
    expect(out.acNow).toBe(80);
    expect(out.remaining).toBe(240); // 320 − 80
  });

  it('splits planned outflow per period (BCWS increment)', () => {
    expect(out.periods.map((p) => p.planned)).toEqual([100, 100, 100]);
  });

  it('caps actual at the status date; future periods are null', () => {
    expect(out.periods[0].actual).toBe(80); // Jan (past)
    expect(out.periods[1].actual).toBeNull(); // Feb (future)
    expect(out.periods[2].actual).toBeNull(); // Mar (future)
  });

  it('spreads remaining EAC across future periods by planned shape', () => {
    expect(out.periods[0].forecast).toBeNull(); // past
    expect(out.periods[1].forecast).toBe(120); // 240 × (100/200)
    expect(out.periods[2].forecast).toBe(120);
  });

  it('builds the cumulative S-curves', () => {
    expect(out.periods.map((p) => p.cumPlanned)).toEqual([100, 200, 300]);
    expect(out.periods[0].cumActual).toBe(80);
    expect(out.periods[1].cumActual).toBeNull();
    // forecast S-curve rises from AC@now (80) up to EAC (320)
    expect(out.periods[0].cumForecast).toBeNull();
    expect(out.periods[1].cumForecast).toBe(200);
    expect(out.periods[2].cumForecast).toBe(320);
  });

  it('passes through committed cost per period', () => {
    expect(out.periods.map((p) => p.committed)).toEqual([0, 50, 0]);
  });
});
