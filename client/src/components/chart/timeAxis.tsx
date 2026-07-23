// Shared time axis for the S-curve charts. Month-start ticks spanning [t0, t1]; the first tick
// and any January carry the year. Positions are percentages of the container width, matching the
// charts' viewBox plot area (720 wide, 8/12 left/right padding) so labels line up with the curve
// even when the chart is zoomed (t0/t1 = the current visible domain).
const W = 720, PADL = 8, PADR = 12;

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

export function TimeAxisLabels({ t0, t1 }: { t0: number; t1: number }) {
  const raw = monthTicks(t0, t1);
  const step = Math.max(1, Math.ceil(raw.length / 9));
  const ticks = raw.filter((_, i) => i % step === 0);
  const pct = (ms: number) => {
    const xv = PADL + ((ms - t0) / Math.max(1, t1 - t0)) * (W - PADL - PADR);
    return (Math.max(PADL, Math.min(W - PADR, xv)) / W) * 100;
  };
  return (
    <div className="relative mt-1 h-3 text-[10px] text-slate-400 dark:text-slate-500">
      {ticks.map((tk) => (
        <span key={tk.ms} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${pct(tk.ms)}%` }}>{tk.label}</span>
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
