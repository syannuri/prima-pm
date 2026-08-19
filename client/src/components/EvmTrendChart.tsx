import type { EvmTrend } from '../api/types';
import { formatIdrShort, formatIdr, formatNum, formatDate } from '../lib/format';
import ChartZoomFrame, { nearestIndex } from './chart/ChartZoomFrame';
import { TimeAxisLabels, ChartTip, visibleTicks, tickX } from './chart/timeAxis';
import { smoothPath, areaPath, type Pt } from './chart/smoothPath';

const PV = '#94a3b8'; // slate-400 — planned value backdrop
const EV = '#10b981'; // emerald-500 — earned value (physical progress in money)
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
      showPeriod
      legend={<Legend items={[{ color: PV, label: 'Planned (PV)' }, { color: EV, label: 'Earned (EV)' }, { color: AC, label: 'Actual (AC)' }]} />}
      footer={(vp) => <TimeAxisLabels t0={vp.domain[0]} t1={vp.domain[1]} granularity={vp.granularity} />}
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
        const toPts = (pts: { t: string; v: number }[]): Pt[] => pts.map((p) => ({ x: x(+new Date(p.t)), y: y(p.v) }));
        const pvPts = toPts(curve.map((p) => ({ t: p.t, v: p.pv })));
        const snapPts = (sel: (s: EvmTrend['snapshots'][number]) => number): Pt[] =>
          snaps.map((s) => ({ x: x(+new Date(s.statusDate)), y: y(sel(s)) }));
        const evPts = snapPts((s) => s.ev), acPts = snapPts((s) => s.ac);
        // Emphasise the snapshot nearest the cursor with a halo ring (modern hover affordance).
        const hi = vp.hoverTime != null && snaps.length ? nearestIndex(snapTimes, vp.hoverTime) : -1;
        // Adaptive date/week guides — vertical gridlines that align with the axis labels below.
        const ticks = visibleTicks(d0, d1, 9, vp.granularity);
        return (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="evTrendGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={EV} stopOpacity="0.22" />
                <stop offset="100%" stopColor={EV} stopOpacity="0" />
              </linearGradient>
              <linearGradient id="evPlotBg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#108AB1" stopOpacity="0.07" />
                <stop offset="100%" stopColor="#108AB1" stopOpacity="0.01" />
              </linearGradient>
            </defs>
            {/* Soft tinted canvas behind the plot so the curves sit on a defined background. */}
            <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="url(#evPlotBg)" />
            {/* Vertical date/week guides (drawn first, behind everything). Month-boundary /
                year ticks read a touch stronger than in-between weeks. */}
            {ticks.map((tk) => {
              const gx = tickX(tk.ms, d0, d1);
              return <line key={tk.ms} x1={gx} x2={gx} y1={padT} y2={H - padB} stroke="currentColor" className={tk.major ? 'text-slate-200 dark:text-slate-700/70' : 'text-slate-100 dark:text-slate-800'} strokeWidth="1" vectorEffect="non-scaling-stroke" />;
            })}
            {/* Faint horizontal gridlines + IDR labels so intermediate values read without hovering. */}
            {[0.25, 0.5, 0.75].map((fr) => {
              const gy = y(maxY * fr);
              return (
                <g key={fr}>
                  <line x1={padL} x2={W - padR} y1={gy} y2={gy} stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <text x={padL + 1} y={gy - 2} className="fill-slate-300 text-[9px] dark:fill-slate-600">{formatIdrShort(maxY * fr)}</text>
                </g>
              );
            })}
            {evPts.length > 1 && <path d={areaPath(evPts, H - padB)} fill="url(#evTrendGrad)" stroke="none" />}
            <line x1={padL} x2={W - padR} y1={bacY} y2={bacY} stroke="currentColor" className="text-slate-300 dark:text-slate-700" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            {curve.length > 1 && <path d={smoothPath(pvPts)} fill="none" stroke={PV} strokeWidth="2.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            {acPts.length > 1 && <path d={smoothPath(acPts)} fill="none" stroke={AC} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            {/* Earned value is the hero series — a soft wide halo under a crisp line reads strong yet elegant. */}
            {evPts.length > 1 && <path d={smoothPath(evPts)} fill="none" stroke={EV} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.14" vectorEffect="non-scaling-stroke" />}
            {evPts.length > 1 && <path d={smoothPath(evPts)} fill="none" stroke={EV} strokeWidth="3.25" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            {snaps.map((s, i) => (
              <g key={s.id}>
                {i === hi && <circle cx={acPts[i].x} cy={acPts[i].y} r="6" fill={AC} opacity="0.18" />}
                {i === hi && <circle cx={evPts[i].x} cy={evPts[i].y} r="6" fill={EV} opacity="0.18" />}
                <circle cx={acPts[i].x} cy={acPts[i].y} r={i === hi ? 3.6 : 2.8} fill={AC} stroke="#fff" strokeWidth="1.1" />
                <circle cx={evPts[i].x} cy={evPts[i].y} r={i === hi ? 3.6 : 2.8} fill={EV} stroke="#fff" strokeWidth="1.1" />
              </g>
            ))}
            <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="currentColor" className="text-slate-300 dark:text-slate-600" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
            {ticks.map((tk) => {
              const gx = tickX(tk.ms, d0, d1);
              return <line key={tk.ms} x1={gx} x2={gx} y1={H - padB} y2={H - padB + (tk.major ? 5 : 3)} stroke="currentColor" className={tk.major ? 'text-slate-400 dark:text-slate-500' : 'text-slate-300 dark:text-slate-600'} strokeWidth="1" vectorEffect="non-scaling-stroke" />;
            })}
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
        const line = (sel: (s: EvmTrend['snapshots'][number]) => number): Pt[] =>
          pts.map((s) => ({ x: x(+new Date(s.statusDate)), y: y(sel(s)) }));
        const cpiPts = line((s) => s.cpi), spiPts = line((s) => s.spi);
        const hi = vp.hoverTime != null ? nearestIndex(ptTimes, vp.hoverTime) : -1;
        return (
          <svg viewBox={`0 0 ${W} ${h}`} className="w-full" preserveAspectRatio="none">
            {/* Subtle favourable/unfavourable tint split at the 1.00 on-target line. */}
            <rect x={padL} y={pt} width={W - padL - padR} height={Math.max(0, oneY - pt)} className="fill-emerald-400/5 dark:fill-emerald-400/[0.07]" />
            <rect x={padL} y={oneY} width={W - padL - padR} height={Math.max(0, h - pb - oneY)} className="fill-red-400/5 dark:fill-red-400/[0.07]" />
            <line x1={padL} x2={W - padR} y1={oneY} y2={oneY} stroke="currentColor" className="text-slate-300 dark:text-slate-600" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            <path d={smoothPath(cpiPts)} fill="none" stroke={CPI} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <path d={smoothPath(spiPts)} fill="none" stroke={SPI} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {pts.map((s, i) => (
              <g key={s.id}>
                <circle cx={cpiPts[i].x} cy={cpiPts[i].y} r={i === hi ? 3.6 : 2.8} fill={CPI} stroke="#fff" strokeWidth="1.1" />
                <circle cx={spiPts[i].x} cy={spiPts[i].y} r={i === hi ? 3.6 : 2.8} fill={SPI} stroke="#fff" strokeWidth="1.1" />
              </g>
            ))}
            <text x={padL + 2} y={oneY - 3} className="fill-slate-400 text-[10px]">1.00 · on target</text>
          </svg>
        );
      }}
    </ChartZoomFrame>
  );
}
