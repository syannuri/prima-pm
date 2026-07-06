import { describe, it, expect } from 'vitest';
import { direction, sampleDates, summarizeTrend, type TrendPoint } from '../evm.helpers.js';

const pt = (statusDate: string, cpi: number, spi: number, over: Partial<TrendPoint> = {}): TrendPoint => ({
  statusDate,
  bac: 1000,
  pv: 500,
  ev: 480,
  ac: 500,
  cpi,
  spi,
  weightedProgress: 0.48,
  ...over,
});

describe('direction', () => {
  it('reports up/down/flat with a dead-band', () => {
    expect(direction(0.9, 1.0)).toBe('up');
    expect(direction(1.0, 0.9)).toBe('down');
    expect(direction(1.0, 1.005)).toBe('flat'); // within eps
    expect(direction(1.0, 1.0)).toBe('flat');
  });
});

describe('sampleDates', () => {
  const d = (s: string) => +new Date(s);

  it('includes both endpoints and the even steps, sorted & deduped', () => {
    const out = sampleDates(d('2026-01-01'), d('2026-01-11'), 10);
    expect(out[0]).toBe(d('2026-01-01'));
    expect(out[out.length - 1]).toBe(d('2026-01-11'));
    expect(out).toEqual([...out].sort((a, b) => a - b));
    expect(new Set(out).size).toBe(out.length);
  });

  it('folds in extra marks that fall inside the range and ignores out-of-range ones', () => {
    const start = d('2026-01-01');
    const end = d('2026-01-31');
    const out = sampleDates(start, end, 4, [d('2026-01-15'), d('2025-12-01'), d('2026-06-01')]);
    expect(out).toContain(d('2026-01-15'));
    expect(out).not.toContain(d('2025-12-01'));
    expect(out).not.toContain(d('2026-06-01'));
  });

  it('degrades to a single point when the window is empty/invalid', () => {
    const t = d('2026-01-01');
    expect(sampleDates(t, t, 10)).toEqual([t]);
    expect(sampleDates(d('2026-02-01'), d('2026-01-01'), 10)).toEqual([d('2026-02-01')]);
  });
});

describe('summarizeTrend', () => {
  it('returns null for an empty series', () => {
    expect(summarizeTrend([])).toBeNull();
  });

  it('picks the latest values and the direction vs the previous capture', () => {
    const s = summarizeTrend([
      pt('2026-01-31T00:00:00Z', 0.85, 0.9),
      pt('2026-02-28T00:00:00Z', 0.95, 0.88),
    ])!;
    expect(s.count).toBe(2);
    expect(s.latest.cpi).toBe(0.95);
    expect(s.cpiDirection).toBe('up'); // 0.85 → 0.95
    expect(s.spiDirection).toBe('down'); // 0.90 → 0.88
  });

  it('tracks the worst (lowest positive) CPI/SPI across the whole history', () => {
    const s = summarizeTrend([
      pt('2026-01-31T00:00:00Z', 1.1, 1.0),
      pt('2026-02-28T00:00:00Z', 0.7, 0.8), // the trough
      pt('2026-03-31T00:00:00Z', 0.95, 0.92),
    ])!;
    expect(s.worstCpi).toBe(0.7);
    expect(s.worstSpi).toBe(0.8);
  });

  it('ignores zero CPI/SPI (no cost / not started) when finding the worst', () => {
    const s = summarizeTrend([
      pt('2026-01-31T00:00:00Z', 0, 0),
      pt('2026-02-28T00:00:00Z', 1.05, 0.97),
    ])!;
    expect(s.worstCpi).toBe(1.05);
    expect(s.worstSpi).toBe(0.97);
    expect(s.cpiDirection).toBe('up'); // 0 → 1.05
  });
});
