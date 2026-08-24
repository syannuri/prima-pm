import type { ReactNode } from 'react';
import type { EvmTrend, Forecast } from '../api/types';
import { formatIdrShort, formatIdr, formatNum, formatDate } from '../lib/format';
import ChartZoomFrame, { nearestIndex } from './chart/ChartZoomFrame';
import { TimeAxisLabels, ChartTip, visibleTicks, tickX } from './chart/timeAxis';
import { smoothPath, areaPath, type Pt } from './chart/smoothPath';

const PV = '#94a3b8'; // slate-400 — planned value backdrop
const EV = '#10b981'; // emerald-500 — earned value (physical progress in money)
const AC = '#0ea5e9'; // sky-500 — actual cost
const FC = '#f59e0b'; // amber-500 — forecast / EAC projection
const CPI = '#0ea5e9'; // sky-500
const SPI = '#8b5cf6'; // violet-500

const W = 720, padL = 8, padR = 12, padT = 12, padB = 26;

// A closed ribbon between two same-x polylines (top forward, bottom reversed) — used to shade
// a variance band (EV vs AC / EV vs PV) without a fill library.
function ribbonPath(top: Pt[], bottom: Pt[]): string {
  if (top.length < 2) return '';
  const fwd = top.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  const back = [...bottom].reverse().map((p) => `L ${p.x} ${p.y}`).join(' ');
  return `${fwd} ${back} Z`;
}

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
// with the CAPTURED earned-value (EV) and actual-cost (AC) history as connected markers, plus an
// EAC forecast projection (dashed, from today to the forecast finish) and its optimistic–pessimistic
// cone. Variance is shaded (EV vs AC in money mode, EV vs PV in progress mode) and vertical markers
// flag today / baseline finish / forecast finish. `mode` switches between money (IDR) and physical
// progress (% of BAC). Wrapped in ChartZoomFrame: drag to zoom, hover to read values, ⤢ to enlarge.
export default function EvmTrendChart({ data, forecast, mode = 'money', bare, compact, title }: {
  data: EvmTrend;
  forecast?: Forecast | null;
  mode?: 'money' | 'progress';
  bare?: boolean;
  compact?: boolean;
  title?: ReactNode; // override the built-in title (pass null to hide it, e.g. embedded under a tab toggle)
}) {
  const snaps = data.snapshots;
  const curve = data.plannedCurve;
  if (!snaps.length && curve.length < 2) {
    return <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">No schedule baseline or snapshots yet to draw a trend.</div>;
  }

  const progress = mode === 'progress';
  const bac = data.bac || 1;
  const V = (v: number) => (progress ? (v / bac) * 100 : v); // value → axis unit
  const fmtShort = progress ? (v: number) => `${formatNum(v, 0)}%` : formatIdrShort;
  const fmtFull = progress ? (v: number) => `${formatNum(v, 1)}%` : formatIdr;

  const H = compact ? 210 : 240;
  const y = (v: number) => padT + (1 - V(v) / (progress ? 105 : maxRaw)) * (H - padT - padB);

  // Forecast (cost) trajectory — server gives it only in money terms (AC → likely EAC).
  const fcSeries = !progress && forecast?.sCurve ? forecast.sCurve.filter((p) => p.forecast != null).map((p) => ({ t: +new Date(p.t), v: p.forecast as number })) : [];
  const statusMs = +new Date(forecast?.statusDate ?? data.statusDate);
  const plannedFinishMs = data.plannedFinish ? +new Date(data.plannedFinish) : (forecast?.schedule.plannedFinish ? +new Date(forecast.schedule.plannedFinish) : null);
  const forecastFinishMs = forecast?.schedule.forecastFinish ? +new Date(forecast.schedule.forecastFinish) : null;
  const fcFinishMs = forecastFinishMs ?? plannedFinishMs;

  const times = [
    ...curve.map((p) => +new Date(p.t)), ...snaps.map((s) => +new Date(s.statusDate)),
    ...fcSeries.map((p) => p.t), statusMs,
    ...(plannedFinishMs ? [plannedFinishMs] : []), ...(forecastFinishMs ? [forecastFinishMs] : []),
  ].filter((n) => Number.isFinite(n));
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const maxRaw = (Math.max(data.bac, ...curve.map((p) => p.pv), ...snaps.flatMap((s) => [s.ev, s.ac, s.pv]), ...fcSeries.map((p) => p.v), forecast?.eac.pessimistic ?? 0) || 1) * 1.02;
  const targetY = y(bac); // BAC (money) / 100% (progress) reference line
  const snapTimes = snaps.map((s) => +new Date(s.statusDate));

  // EAC cone endpoints (money): optimistic..pessimistic interpolated on the same dates as the line.
  const cone = (!progress && forecast && fcFinishMs && fcFinishMs > statusMs && fcSeries.length)
    ? fcSeries.map((p) => {
        const frac = Math.min(1, Math.max(0, (p.t - statusMs) / (fcFinishMs - statusMs)));
        return { t: p.t, lo: forecast.ac + (forecast.eac.optimistic - forecast.ac) * frac, hi: forecast.ac + (forecast.eac.pessimistic - forecast.ac) * frac };
      })
    : [];

  const uid = progress ? 'prog' : 'money';
  return (
    <ChartZoomFrame
      fullDomain={[t0, t1]}
      title={title !== undefined ? title : (progress ? 'Progress S-curve' : 'Earned-value trend (S-curve)')}
      ariaLabel="Earned-value trend S-curve"
      showPeriod
      bare={bare}
      legend={<Legend items={[
        { color: PV, label: progress ? 'Planned %' : 'Planned (PV)' },
        { color: EV, label: progress ? 'Earned %' : 'Earned (EV)' },
        { color: AC, label: progress ? 'Spent %' : 'Actual (AC)' },
        ...(fcSeries.length ? [{ color: FC, label: 'Forecast (EAC)' }] : []),
      ]} />}
      footer={(vp) => <TimeAxisLabels t0={vp.domain[0]} t1={vp.domain[1]} granularity={vp.granularity} />}
      tooltip={snaps.length ? ({ hoverTime }) => {
        const s = snaps[nearestIndex(snapTimes, hoverTime)];
        return <ChartTip heading={formatDate(s.statusDate)} rows={[
          { label: progress ? 'Planned' : 'PV', value: fmtFull(s.pv), color: PV },
          { label: progress ? 'Earned' : 'EV', value: fmtFull(s.ev), color: EV },
          { label: progress ? 'Spent' : 'AC', value: fmtFull(s.ac), color: AC },
          { label: 'CPI · SPI', value: `${formatNum(s.cpi, 2)} · ${formatNum(s.spi, 2)}`, color: '#64748b' },
          { label: 'Complete', value: `${formatNum(s.weightedProgress * 100, 0)}%`, color: '#64748b' },
        ]} />;
      } : undefined}
    >
      {(vp) => {
        const [d0, d1] = vp.domain;
        const x = (t: number) => padL + ((t - d0) / Math.max(1, d1 - d0)) * (W - padL - padR);
        const toPts = (pts: { t: number; v: number }[]): Pt[] => pts.map((p) => ({ x: x(p.t), y: y(p.v) }));
        const pvPts = toPts(curve.map((p) => ({ t: +new Date(p.t), v: p.pv })));
        const snapPts = (sel: (s: EvmTrend['snapshots'][number]) => number): Pt[] =>
          snaps.map((s) => ({ x: x(+new Date(s.statusDate)), y: y(sel(s)) }));
        const evPts = snapPts((s) => s.ev), acPts = snapPts((s) => s.ac), pvSnapPts = snapPts((s) => s.pv);
        const fcPts = toPts(fcSeries);
        // Variance ribbon: EV vs AC (cost) in money mode, EV vs PV (schedule) in progress mode.
        const other = progress ? pvSnapPts : acPts;
        const latest = snaps[snaps.length - 1];
        const favourable = latest ? (progress ? latest.ev >= latest.pv : latest.ev >= latest.ac) : true;
        const ribbon = evPts.length > 1 ? ribbonPath(evPts, other) : '';
        const hi = vp.hoverTime != null && snaps.length ? nearestIndex(snapTimes, vp.hoverTime) : -1;
        const ticks = visibleTicks(d0, d1, 9, vp.granularity);
        const marker = (t: number | null, cls: string, label: string, dash = true) => {
          if (t == null || t < d0 || t > d1) return null;
          const mx = x(t);
          return (
            <g key={label}>
              <line x1={mx} x2={mx} y1={padT} y2={H - padB} stroke="currentColor" className={cls} strokeWidth="1.25" strokeDasharray={dash ? '3 3' : undefined} vectorEffect="non-scaling-stroke" />
              <text x={mx} y={padT + 8} textAnchor={mx > W - 60 ? 'end' : 'middle'} className={`${cls} text-[9px] font-medium`} style={{ fill: 'currentColor' }}>{label}</text>
            </g>
          );
        };
        return (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id={`evTrendGrad-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={EV} stopOpacity="0.22" />
                <stop offset="100%" stopColor={EV} stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`evPlotBg-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#108AB1" stopOpacity="0.07" />
                <stop offset="100%" stopColor="#108AB1" stopOpacity="0.01" />
              </linearGradient>
            </defs>
            <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill={`url(#evPlotBg-${uid})`} />
            {ticks.map((tk) => {
              const gx = tickX(tk.ms, d0, d1);
              return <line key={tk.ms} x1={gx} x2={gx} y1={padT} y2={H - padB} stroke="currentColor" className={tk.major ? 'text-slate-200 dark:text-slate-700/70' : 'text-slate-100 dark:text-slate-800'} strokeWidth="1" vectorEffect="non-scaling-stroke" />;
            })}
            {/* Horizontal gridlines + value labels so intermediate values read without hovering. */}
            {[0.25, 0.5, 0.75].map((fr) => {
              const gy = y((progress ? 100 : maxRaw) * fr);
              return (
                <g key={fr}>
                  <line x1={padL} x2={W - padR} y1={gy} y2={gy} stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <text x={padL + 1} y={gy - 2} className="fill-slate-300 text-[9px] dark:fill-slate-600">{fmtShort((progress ? 100 : maxRaw) * fr)}</text>
                </g>
              );
            })}
            {/* Variance shading — favourable (green) / unfavourable (red), very subtle. */}
            {ribbon && <path d={ribbon} className={favourable ? 'fill-emerald-400/10' : 'fill-red-400/10'} stroke="none" />}
            {evPts.length > 1 && <path d={areaPath(evPts, H - padB)} fill={`url(#evTrendGrad-${uid})`} stroke="none" />}
            {/* EAC cone (optimistic..pessimistic). */}
            {cone.length > 1 && <path d={ribbonPath(toPts(cone.map((c) => ({ t: c.t, v: c.hi }))), toPts(cone.map((c) => ({ t: c.t, v: c.lo }))))} className="fill-amber-400/10" stroke="none" />}
            {/* Target reference line: BAC (money) or 100% (progress). */}
            <line x1={padL} x2={W - padR} y1={targetY} y2={targetY} stroke="currentColor" className="text-slate-300 dark:text-slate-700" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            {curve.length > 1 && <path d={smoothPath(pvPts)} fill="none" stroke={PV} strokeWidth="2.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            {acPts.length > 1 && <path d={smoothPath(acPts)} fill="none" stroke={AC} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            {/* Forecast projection — dashed amber from today to the forecast finish. */}
            {fcPts.length > 1 && <path d={smoothPath(fcPts)} fill="none" stroke={FC} strokeWidth="2.25" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
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
            {/* Vertical markers: today (status date) + baseline & forecast finish. */}
            {marker(statusMs, 'text-slate-400 dark:text-slate-500', 'today')}
            {marker(plannedFinishMs, 'text-slate-400 dark:text-slate-500', 'plan finish')}
            {forecastFinishMs && forecastFinishMs !== plannedFinishMs ? marker(forecastFinishMs, 'text-amber-500 dark:text-amber-400', 'forecast') : null}
            <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="currentColor" className="text-slate-300 dark:text-slate-600" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
            {ticks.map((tk) => {
              const gx = tickX(tk.ms, d0, d1);
              return <line key={tk.ms} x1={gx} x2={gx} y1={H - padB} y2={H - padB + (tk.major ? 5 : 3)} stroke="currentColor" className={tk.major ? 'text-slate-400 dark:text-slate-500' : 'text-slate-300 dark:text-slate-600'} strokeWidth="1" vectorEffect="non-scaling-stroke" />;
            })}
            <text x={W - padR} y={targetY - 3} textAnchor="end" className="fill-slate-400 text-[10px]">{progress ? '100% · BAC' : `BAC ${formatIdrShort(data.bac)}`}</text>
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
