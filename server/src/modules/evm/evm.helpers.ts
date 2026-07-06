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

export interface RollupInput {
  projectId: string;
  statusDate: string; // ISO, day-normalized (lexically comparable)
  pv: number;
  ev: number;
  ac: number;
}

/**
 * Roll up per-project snapshots into a portfolio trend. Projects capture on
 * different dates, so at each date in the union we take each project's LATEST
 * snapshot as-of that date (a step/cumulative view) and sum PV/EV/AC, then derive
 * the portfolio CPI (ΣEV/ΣAC) and SPI (ΣEV/ΣPV). A project contributes only once
 * it has a snapshot on/before the date.
 */
export function rollupPortfolioTrend(snaps: RollupInput[]) {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  if (!snaps.length) return [] as { statusDate: string; pv: number; ev: number; ac: number; cpi: number; spi: number; projectCount: number }[];

  const dates = [...new Set(snaps.map((s) => s.statusDate))].sort();
  const byProject = new Map<string, RollupInput[]>();
  for (const s of snaps) {
    const arr = byProject.get(s.projectId) ?? [];
    arr.push(s);
    byProject.set(s.projectId, arr);
  }
  for (const arr of byProject.values()) arr.sort((a, b) => (a.statusDate < b.statusDate ? -1 : a.statusDate > b.statusDate ? 1 : 0));

  return dates.map((d) => {
    let pv = 0, ev = 0, ac = 0, projectCount = 0;
    for (const arr of byProject.values()) {
      let latest: RollupInput | null = null;
      for (const s of arr) {
        if (s.statusDate <= d) latest = s;
        else break;
      }
      if (latest) { pv += latest.pv; ev += latest.ev; ac += latest.ac; projectCount++; }
    }
    return {
      statusDate: d,
      pv: round2(pv),
      ev: round2(ev),
      ac: round2(ac),
      cpi: ac > 0 ? round4(ev / ac) : 0,
      spi: pv > 0 ? round4(ev / pv) : 0,
      projectCount,
    };
  });
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
