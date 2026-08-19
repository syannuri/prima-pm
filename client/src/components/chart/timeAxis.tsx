// Shared time axis for the S-curve charts. The axis is ADAPTIVE: short spans (≤ ~12 weeks) tick by
// week with dated labels ("6 Jan"), longer spans tick by month-start ("Jan 2026"). Positions are
// percentages of the container width, matching the charts' viewBox plot area (720 wide, 8/12
// left/right padding) so labels + vertical gridlines line up with the curve even when zoomed
// (t0/t1 = the current visible domain). `major` marks a month boundary (week mode) or January /
// the first tick (month mode) so callers can emphasise those guides.
const W = 720, PADL = 8, PADR = 12;
const DAY = 86_400_000;

export type Tick = { ms: number; label: string; major: boolean };
// Axis granularity: 'auto' picks week/month by span; 'week'/'month' force it (user-selectable).
export type Granularity = 'auto' | 'week' | 'month';

// Legacy month-start ticks (kept for callers that still want month-only granularity).
export function monthTicks(t0: number, t1: number): { ms: number; label: string }[] {
  const start = new Date(t0);
  let cur = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
  const out: { ms: number; label: string }[] = [];
  let first = true;
  while (cur <= t1) {
    const d = new Date(cur);
    const mon = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
    out.push({ ms: cur, label: first || d.getUTCMonth() === 0 ? `${mon} ${d.getUTCFullYear()}` : mon });
    first = false;
    cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return out;
}

// Adaptive ticks — weekly (Monday-aligned) for short spans, monthly otherwise. Pass a granularity
// to force weekly/monthly regardless of span (the chart's period selector).
export function timeTicks(t0: number, t1: number, g: Granularity = 'auto'): Tick[] {
  const out: Tick[] = [];
  const spanDays = (t1 - t0) / DAY;
  const weekly = g === 'week' || (g === 'auto' && spanDays <= 84);

  if (weekly) {
    // Weekly, snapped back to the Monday of t0's week (UTC).
    const s = new Date(t0);
    const dow = (s.getUTCDay() + 6) % 7; // Monday = 0
    let cur = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() - dow);
    let first = true, lastMonth = -1, lastYear = -1;
    while (cur <= t1) {
      const d = new Date(cur);
      const day = d.getUTCDate();
      const mon = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
      const yr = d.getUTCFullYear();
      const major = first || d.getUTCMonth() !== lastMonth;
      const showYear = first || yr !== lastYear;
      out.push({ ms: cur, label: showYear ? `${day} ${mon} ${yr}` : `${day} ${mon}`, major });
      lastMonth = d.getUTCMonth(); lastYear = yr; first = false;
      cur += 7 * DAY;
    }
    return out;
  }

  // Monthly.
  const start = new Date(t0);
  let cur = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
  let first = true;
  while (cur <= t1) {
    const d = new Date(cur);
    const mon = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
    const jan = d.getUTCMonth() === 0;
    out.push({ ms: cur, label: first || jan ? `${mon} ${d.getUTCFullYear()}` : mon, major: first || jan });
    first = false;
    cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return out;
}

// Thin the adaptive ticks to at most `max` labels (keeps them from crowding on a narrow chart).
export function visibleTicks(t0: number, t1: number, max = 9, g: Granularity = 'auto'): Tick[] {
  const raw = timeTicks(t0, t1, g);
  const step = Math.max(1, Math.ceil(raw.length / max));
  return raw.filter((_, i) => i % step === 0);
}

// SVG-space x for a tick, clamped to the plot area — so gridlines/ticks drawn inside the chart's
// viewBox line up exactly with the HTML axis labels below (both use W / PADL / PADR).
export function tickX(ms: number, t0: number, t1: number): number {
  const xv = PADL + ((ms - t0) / Math.max(1, t1 - t0)) * (W - PADL - PADR);
  return Math.max(PADL, Math.min(W - PADR, xv));
}

export function TimeAxisLabels({ t0, t1, granularity = 'auto' }: { t0: number; t1: number; granularity?: Granularity }) {
  const ticks = visibleTicks(t0, t1, 9, granularity);
  const pct = (ms: number) => (tickX(ms, t0, t1) / W) * 100;
  return (
    <div className="relative mt-1 h-3 text-[10px]">
      {ticks.map((tk) => (
        <span
          key={tk.ms}
          className={`absolute -translate-x-1/2 whitespace-nowrap tabular-nums ${tk.major ? 'font-medium text-slate-500 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500'}`}
          style={{ left: `${pct(tk.ms)}%` }}
        >
          {tk.label}
        </span>
      ))}
    </div>
  );
}

// Tooltip body: a date heading + coloured metric rows. Shared by the chart tooltips.
export function ChartTip({ heading, rows }: { heading: string; rows: { label: string; value: string; color: string }[] }) {
  return (
    <div className="whitespace-nowrap">
      <div className="mb-0.5 font-medium text-slate-700 dark:text-slate-200">{heading}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-1.5 tabular-nums text-slate-600 dark:text-slate-300">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />
          <span className="text-slate-400 dark:text-slate-500">{r.label}</span>
          <span className="ml-auto font-medium">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
