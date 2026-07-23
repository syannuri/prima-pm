import type { EvmTrend } from '../api/types';
import { formatIdrShort, formatIdr, formatNum, formatDate } from '../lib/format';
import ChartZoomFrame, { nearestIndex } from './chart/ChartZoomFrame';
import { TimeAxisLabels, ChartTip } from './chart/timeAxis';

const PV = '#94a3b8'; // slate-400 — planned value backdrop
const EV = '#22c55e'; // green-500 — earned value (physical progress in money)
const AC = '#0ea5e9'; // sky-500 — actual cost
const CPI = '#0ea5e9'; // sky-500
const SPI = '#8b5cf6'; // violet-500

const W = 720, H = 240, padL = 8, padR = 12, padT = 12, padB = 26;

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: it.color }} />{it.label}</span>
      ))}
    </>
  );
}

// The trend S-curve: a smooth planned-value backdrop (PV, from the schedule baseline) overlaid
// with the CAPTURED earned-value (EV) and actual-cost (AC) history as connected markers. Unlike
// the Forecast S-curve, EV here is REAL recorded history (each dot is a status snapshot).
// Wrapped in ChartZoomFrame: drag to zoom a date range, hover to read values, ⤢ to enlarge.
export default function EvmTrendChart({ data }: { data: EvmTrend }) {
  const snaps = data.snapshots;
  const curve = data.plannedCurve;
  if (!snaps.length && curve.length < 2) {
    return <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">No schedule baseline or snapshots yet to draw a trend.</div>;
  }

  const times = [...curve.map((p) => +new Date(p.t)), ...snaps.map((s) => +new Date(s.statusDate))];
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const maxY = Math.max(data.bac, ...curve.map((p) => p.pv), ...snaps.flatMap((s) => [s.ev, s.ac, s.pv])) || 1;
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);
  const bacY = y(data.bac);
  const snapTimes = snaps.map((s) => +new Date(s.statusDate));

  return (
    <ChartZoomFrame
      fullDomain={[t0, t1]}
      title="Earned-value trend (S-curve)"
      ariaLabel="Earned-value trend S-curve"
      legend={<Legend items={[{ color: PV, label: 'Planned (PV)' }, { color: EV, label: 'Earned (EV)' }, { color: AC, label: 'Actual (AC)' }]} />}
      footer={(vp) => <TimeAxisLabels t0={vp.domain[0]} t1={vp.domain[1]} />}
      tooltip={snaps.length ? ({ hoverTime }) => {
        const s = snaps[nearestIndex(snapTimes, hoverTime)];
        return <ChartTip heading={formatDate(s.statusDate)} rows={[
          { label: 'PV', value: formatIdr(s.pv), color: PV },
          { label: 'EV', value: formatIdr(s.ev), color: EV },
          { label: 'AC', value: formatIdr(s.ac), color: AC },
        ]} />;
      } : undefined}
    >
      {(vp) => {
        const [d0, d1] = vp.domain;
        const x = (t: number) => padL + ((t - d0) / Math.max(1, d1 - d0)) * (W - padL - padR);
        const pvPath = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(+new Date(p.t)).toFixed(1)},${y(p.pv).toFixed(1)}`).join(' ');
        const snapLine = (sel: (s: EvmTrend['snapshots'][number]) => number) =>
          snaps.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(+new Date(s.statusDate)).toFixed(1)},${y(sel(s)).toFixed(1)}`).join(' ');
        return (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
            <line x1={padL} x2={W - padR} y1={bacY} y2={bacY} stroke="currentColor" className="text-slate-300 dark:text-slate-700" strokeWidth="1" strokeDasharray="2 3" />
            {curve.length > 1 && <path d={pvPath} fill="none" stroke={PV} strokeWidth="2" />}
            {snaps.length > 1 && <path d={snapLine((s) => s.ac)} fill="none" stroke={AC} strokeWidth="2.5" strokeLinecap="round" />}
            {snaps.length > 1 && <path d={snapLine((s) => s.ev)} fill="none" stroke={EV} strokeWidth="2.5" strokeLinecap="round" />}
            {snaps.map((s) => (
              <g key={s.id}>
                <circle cx={x(+new Date(s.statusDate))} cy={y(s.ac)} r="3" fill={AC} />
                <circle cx={x(+new Date(s.statusDate))} cy={y(s.ev)} r="3" fill={EV} />
              </g>
            ))}
            <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeWidth="1" />
            <text x={W - padR} y={bacY - 3} textAnchor="end" className="fill-slate-400 text-[10px]">BAC {formatIdrShort(data.bac)}</text>
          </svg>
        );
      }}
    </ChartZoomFrame>
  );
}

// CPI & SPI over time — the performance-index history. A dashed 1.0 line is the on-target
// reference; a series below it is running over cost / behind schedule. Needs ≥ 2 snapshots.
export function CpiSpiTrend({ data }: { data: EvmTrend }) {
  const pts = data.snapshots.filter((s) => s.cpi > 0 || s.spi > 0);
  if (pts.length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        Capture at least two status snapshots to see the CPI / SPI trend.
      </div>
    );
  }
  const h = 180, pt = 14, pb = 26;
  const t0 = Math.min(...pts.map((s) => +new Date(s.statusDate)));
  const t1 = Math.max(...pts.map((s) => +new Date(s.statusDate)));
  const vals = pts.flatMap((s) => [s.cpi, s.spi]).filter((v) => v > 0);
  const yMax = Math.max(1.15, ...vals) + 0.05;
  const yMin = Math.min(0.85, ...vals) - 0.05;
  const y = (v: number) => pt + (1 - (v - yMin) / (yMax - yMin)) * (h - pt - pb);
  const oneY = y(1);
  const ptTimes = pts.map((s) => +new Date(s.statusDate));

  return (
    <ChartZoomFrame
      fullDomain={[t0, t1]}
      title="Performance indices over time"
      ariaLabel="CPI and SPI trend"
      legend={<Legend items={[{ color: CPI, label: 'CPI (cost)' }, { color: SPI, label: 'SPI (schedule)' }]} />}
      footer={(vp) => (
        <>
          <TimeAxisLabels t0={vp.domain[0]} t1={vp.domain[1]} />
          <div className="mt-1 text-right text-[10px] text-slate-400 dark:text-slate-500">latest CPI {formatNum(pts[pts.length - 1].cpi, 2)} · SPI {formatNum(pts[pts.length - 1].spi, 2)}</div>
        </>
      )}
      tooltip={({ hoverTime }) => {
        const s = pts[nearestIndex(ptTimes, hoverTime)];
        return <ChartTip heading={formatDate(s.statusDate)} rows={[
          { label: 'CPI', value: formatNum(s.cpi, 2), color: CPI },
          { label: 'SPI', value: formatNum(s.spi, 2), color: SPI },
        ]} />;
      }}
    >
      {(vp) => {
        const [d0, d1] = vp.domain;
        const x = (t: number) => padL + ((t - d0) / Math.max(1, d1 - d0)) * (W - padL - padR);
        const line = (sel: (s: EvmTrend['snapshots'][number]) => number) =>
          pts.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(+new Date(s.statusDate)).toFixed(1)},${y(sel(s)).toFixed(1)}`).join(' ');
        return (
          <svg viewBox={`0 0 ${W} ${h}`} className="w-full" preserveAspectRatio="none">
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
        );
      }}
    </ChartZoomFrame>
  );
}
