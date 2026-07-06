// =====================================================================
// EVM-TREND helpers — PURE, ZERO imports.
// Kept import-free so unit tests never transitively load prisma/config/env
// (the CI "Unit tests" step runs DB-less — see the ops memory / CI gotcha).
// =====================================================================

export interface TrendPoint {
  statusDate: string; // ISO
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  cpi: number;
  spi: number;
  weightedProgress: number; // 0..1
}

export type Direction = 'up' | 'down' | 'flat';

/** Direction of change a→b, with a dead-band so small noise reads as flat. */
export function direction(a: number, b: number, eps = 0.01): Direction {
  const d = b - a;
  if (Math.abs(d) < eps) return 'flat';
  return d > 0 ? 'up' : 'down';
}

/**
 * Sample day-normalized timestamps across [start, end]: n even steps plus the
 * endpoints and any `extra` marks that fall in range (deduped, sorted). Used to
 * pick the dates at which the planned-value backdrop curve is evaluated.
 */
export function sampleDates(start: number, end: number, n: number, extra: number[] = []): number[] {
  if (!(end > start) || n < 1) return [start];
  const set = new Set<number>([start, end, ...extra.filter((d) => d >= start && d <= end)]);
  for (let i = 0; i <= n; i++) set.add(Math.round(start + ((end - start) * i) / n));
  return [...set].sort((a, b) => a - b);
}

/**
 * Compact summary of a captured snapshot series for the KPI strip: latest values,
 * whether CPI/SPI are improving vs the previous capture, and the worst (lowest)
 * CPI/SPI reached across the whole recorded history.
 */
export function summarizeTrend(points: TrendPoint[]) {
  if (!points.length) return null;
  const latest = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const cpis = points.map((p) => p.cpi).filter((v) => v > 0);
  const spis = points.map((p) => p.spi).filter((v) => v > 0);
  return {
    count: points.length,
    latest,
    cpiDirection: prev ? direction(prev.cpi, latest.cpi) : ('flat' as Direction),
    spiDirection: prev ? direction(prev.spi, latest.spi) : ('flat' as Direction),
    worstCpi: cpis.length ? Math.min(...cpis) : 0,
    worstSpi: spis.length ? Math.min(...spis) : 0,
  };
}
