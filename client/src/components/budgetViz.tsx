import { formatIdr, formatIdrShort } from '../lib/format';

// Shared budget-visualization primitives used by both the project Cost summary and the dashboard's
// Portfolio budget band, so the two read as one design language: gradient stacked bars with hairline
// separators + inner-shadow track, a compact spent progress ring, and a gradient-dot legend.

export interface Seg { key: string; label: string; value: number; grad: string }

// A proportional stacked bar. The 2px flex gap shows the track colour through as a hairline separator;
// widths transition in once `mounted` flips true (mount-in animation).
export function StackBar({ segs, over, mounted }: { segs: Seg[]; over: number; mounted: boolean }) {
  const denom = over > 0 ? over : segs.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  return (
    <div className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full bg-slate-100 shadow-inner ring-1 ring-slate-900/5 dark:bg-slate-800 dark:ring-white/5">
      {segs.map((s) => {
        const pct = Math.max(0, Math.min(100, (Math.max(0, s.value) / denom) * 100));
        if (pct <= 0) return null;
        return (
          <div
            key={s.key}
            className={`h-full bg-gradient-to-b ${s.grad} transition-[width] duration-700 ease-out first:rounded-l-full last:rounded-r-full`}
            style={{ width: mounted ? `${pct}%` : '0%' }}
            title={`${s.label}: ${formatIdr(s.value)}`}
          />
        );
      })}
    </div>
  );
}

export function Legend({ segs }: { segs: Seg[] }) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
      {segs.map((s) => (
        <div key={s.key} className="flex items-center gap-1.5" title={formatIdr(s.value)}>
          <span className={`h-2 w-2 shrink-0 rounded-full bg-gradient-to-b ${s.grad}`} />
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{s.label}</span>
          <span className="text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatIdrShort(s.value)}</span>
        </div>
      ))}
    </div>
  );
}

// A compact progress ring (e.g. spent as a share of BAC). Animates its sweep in with `mounted`.
export function SpentRing({ pct, stroke, mounted, caption = 'spent' }: { pct: number; stroke: string; mounted: boolean; caption?: string }) {
  const r = 26;
  const C = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = mounted ? C * (1 - clamped / 100) : C;
  return (
    <div className="relative h-[68px] w-[68px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-slate-100 dark:stroke-slate-800" />
        <circle
          cx="32" cy="32" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
          className={stroke}
          strokeDasharray={C}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 800ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{Math.round(clamped)}%</span>
        <span className="text-[9px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{caption}</span>
      </div>
    </div>
  );
}

// Cost-health (CPI) → the ring stroke + a legend/chip colour set. Shared so both surfaces agree.
export function cpiHealthStroke(cpi: number | null, ac: number): string {
  if (ac <= 0 || cpi == null) return 'stroke-slate-300 dark:stroke-slate-600';
  if (cpi >= 0.95) return 'stroke-emerald-500';
  if (cpi >= 0.85) return 'stroke-amber-500';
  return 'stroke-red-500';
}
