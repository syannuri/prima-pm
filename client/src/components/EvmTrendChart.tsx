import type { EvmTrend } from '../api/types';
import { formatIdrShort, formatNum } from '../lib/format';

const PV = '#94a3b8'; // slate-400 — planned value backdrop
const EV = '#22c55e'; // green-500 — earned value (physical progress in money)
const AC = '#0ea5e9'; // sky-500 — actual cost
const CPI = '#0ea5e9'; // sky-500
const SPI = '#8b5cf6'; // violet-500

// Month-start ticks spanning [t0, t1] (copied style from ForecastChart so the two
// EVM charts read identically). January / the first tick carry the year.
function monthTicks(t0: number, t1: number): { ms: number; label: string }[] {
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

function TimeAxisLabels({ t0, t1, x, W, padL, padR }: { t0: number; t1: number; x: (t: number) => number; W: number; padL: number; padR: number }) {
  const raw = monthTicks(t0, t1);
  const step = Math.max(1, Math.ceil(raw.length / 9));
  const ticks = raw.filter((_, i) => i % step === 0);
  const tickX = (ms: number) => Math.max(padL, Math.min(W - padR, x(ms)));
  return (
    <div className="relative mt-1 h-3 text-[10px] text-slate-400 dark:text-slate-500">
      {ticks.map((tk) => (
        <span key={tk.ms} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(tickX(tk.ms) / W) * 100}%` }}>{tk.label}</span>
      ))}
    </div>
  );
}

// The trend S-curve: a smooth planned-value backdrop (PV, from the schedule
// baseline) overlaid with the CAPTURED earned-value (EV) and actual-cost (AC)
// history as connected markers. Unlike the Forecast S-curve, EV here is REAL
// recorded history (each dot is a status snapshot), not a single "now" point.
export default function EvmTrendChart({ data }: { data: EvmTrend }) {
  const snaps = data.snapshots;
  const curve = data.plannedCurve;
  if (!snaps.length && curve.length < 2) {
    return <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">No schedule baseline or snapshots yet to draw a trend.</div>;
  }

  const W = 720, H = 240, padL = 8, padR = 12, padT = 12, padB = 26;
  const times = [...curve.map((p) => +new Date(p.t)), ...snaps.map((s) => +new Date(s.statusDate))];
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const maxY = Math.max(
    data.bac,
    ...curve.map((p) => p.pv),
    ...snaps.flatMap((s) => [s.ev, s.ac, s.pv]),
  ) || 1;
  const x = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);

  const pvPath = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(+new Date(p.t)).toFixed(1)},${y(p.pv).toFixed(1)}`).join(' ');
  const snapLine = (sel: (s: EvmTrend['snapshots'][number]) => number) =>
    snaps.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(+new Date(s.statusDate)).toFixed(1)},${y(sel(s)).toFixed(1)}`).join(' ');
  const bacY = y(data.bac);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Earned-value trend (S-curve)</div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: PV }} />Planned (PV)</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: EV }} />Earned (EV)</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: AC }} />Actual (AC)</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Earned-value trend S-curve">
        {/* BAC reference */}
        <line x1={padL} x2={W - padR} y1={bacY} y2={bacY} stroke="currentColor" className="text-slate-300 dark:text-slate-700" strokeWidth="1" strokeDasharray="2 3" />
        {/* planned backdrop */}
        {curve.length > 1 && <path d={pvPath} fill="none" stroke={PV} strokeWidth="2" />}
        {/* captured EV & AC history */}
        {snaps.length > 1 && <path d={snapLine((s) => s.ac)} fill="none" stroke={AC} strokeWidth="2.5" strokeLinecap="round" />}
        {snaps.length > 1 && <path d={snapLine((s) => s.ev)} fill="none" stroke={EV} strokeWidth="2.5" strokeLinecap="round" />}
        {snaps.map((s) => (
          <g key={s.id}>
            <circle cx={x(+new Date(s.statusDate))} cy={y(s.ac)} r="3" fill={AC} />
            <circle cx={x(+new Date(s.statusDate))} cy={y(s.ev)} r="3" fill={EV} />
          </g>
        ))}
        {/* x-axis baseline */}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeWidth="1" />
        <text x={W - padR} y={bacY - 3} textAnchor="end" className="fill-slate-400 text-[10px]">BAC {formatIdrShort(data.bac)}</text>
      </svg>
      <TimeAxisLabels t0={t0} t1={t1} x={x} W={W} padL={padL} padR={padR} />
    </div>
  );
}

// CPI & SPI over time — the performance-index history. A dashed 1.0 line is the
// on-target reference; a series sitting below it is running over cost / behind
// schedule. Needs ≥ 2 snapshots to read as a trend.
export function CpiSpiTrend({ data }: { data: EvmTrend }) {
  const pts = data.snapshots.filter((s) => s.cpi > 0 || s.spi > 0);
  if (pts.length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        Capture at least two status snapshots to see the CPI / SPI trend.
      </div>
    );
  }
  const W = 720, H = 180, padL = 8, padR = 12, padT = 14, padB = 26;
  const t0 = Math.min(...pts.map((s) => +new Date(s.statusDate)));
  const t1 = Math.max(...pts.map((s) => +new Date(s.statusDate)));
  const vals = pts.flatMap((s) => [s.cpi, s.spi]).filter((v) => v > 0);
  const yMax = Math.max(1.15, ...vals) + 0.05;
  const yMin = Math.min(0.85, ...vals) - 0.05;
  const x = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);
  const line = (sel: (s: EvmTrend['snapshots'][number]) => number) =>
    pts.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(+new Date(s.statusDate)).toFixed(1)},${y(sel(s)).toFixed(1)}`).join(' ');
  const oneY = y(1);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Performance indices over time</div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: CPI }} />CPI (cost)</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: SPI }} />SPI (schedule)</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="CPI and SPI trend">
        {/* on-target 1.0 line */}
        <line x1={padL} x2={W - padR} y1={oneY} y2={oneY} stroke="currentColor" className="text-slate-300 dark:text-slate-600" strokeWidth="1" strokeDasharray="4 3" />
        <path d={line((s) => s.cpi)} fill="none" stroke={CPI} strokeWidth="2.5" strokeLinecap="round" />
        <path d={line((s) => s.spi)} fill="none" stroke={SPI} strokeWidth="2.5" strokeLinecap="round" />
        {pts.map((s) => (
          <g key={s.id}>
            <circle cx={x(+new Date(s.statusDate))} cy={y(s.cpi)} r="3" fill={CPI} />
            <circle cx={x(+new Date(s.statusDate))} cy={y(s.spi)} r="3" fill={SPI} />
          </g>
        ))}
        <text x={padL + 2} y={oneY - 3} className="fill-slate-400 text-[10px]">1.00 · on target</text>
      </svg>
      <TimeAxisLabels t0={t0} t1={t1} x={x} W={W} padL={padL} padR={padR} />
      <div className="mt-1 text-right text-[10px] text-slate-400 dark:text-slate-500">latest CPI {formatNum(pts[pts.length - 1].cpi, 2)} · SPI {formatNum(pts[pts.length - 1].spi, 2)}</div>
    </div>
  );
}
