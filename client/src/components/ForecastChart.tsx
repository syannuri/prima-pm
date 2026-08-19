import type { Forecast } from '../api/types';
import { formatIdrShort, formatIdr, formatDate } from '../lib/format';
import ChartZoomFrame, { nearestIndex } from './chart/ChartZoomFrame';
import { TimeAxisLabels, ChartTip, visibleTicks, tickX } from './chart/timeAxis';
import { smoothPath, areaPath, type Pt } from './chart/smoothPath';

const PV = '#94a3b8'; // slate-400 — planned value baseline
const AC = '#0ea5e9'; // sky-500 — actual cost to date
const FC = '#f4675f'; // brand-500 — forecast cost to EAC

const W = 720, H = 240, padL = 8, padR = 12, padT = 12, padB = 26;

// EVM cost S-curve: planned PV (baseline), actual AC (to today), and a dashed forecast line
// projecting cost to the likely EAC at the forecast finish date. `bare` strips the outer card so
// the chart can sit inside an existing Card. Wrapped in ChartZoomFrame for zoom / hover / enlarge.
export default function ForecastChart({ data, bare }: { data: Forecast; bare?: boolean }) {
  const pts = data.sCurve;
  if (pts.length < 2) {
    return <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No schedule data to project a cost curve.</p>;
  }

  const t0 = +new Date(pts[0].t), t1 = +new Date(pts[pts.length - 1].t);
  // Scale to what is actually drawn (BAC, the likely EAC, and the PV/AC/forecast points) — NOT the
  // pessimistic EAC, which isn't plotted and (when CPI·SPI is small) would inflate the axis and
  // squash the visible curves. A little headroom keeps the top line off the frame edge.
  const maxY = Math.max(
    data.bac, data.eac.likely,
    ...pts.map((p) => Math.max(p.pv, p.ac ?? 0, p.forecast ?? 0)),
  ) * 1.06 || 1;
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);
  const bacY = y(data.bac);
  const eacY = y(data.eac.likely);
  const finish = data.schedule.forecastFinish;
  const ptTimes = pts.map((p) => +new Date(p.t));

  return (
    <ChartZoomFrame
      fullDomain={[t0, t1]}
      title="Cost projection (S-curve)"
      ariaLabel="Cost S-curve forecast"
      bare={bare}
      legend={
        <>
          <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: PV }} />Planned (PV)</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: AC }} />Actual (AC)</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-4 border-t border-dashed" style={{ borderColor: FC }} />Forecast</span>
        </>
      }
      footer={(vp) => (
        <>
          <TimeAxisLabels t0={vp.domain[0]} t1={vp.domain[1]} />
          {finish && <div className="mt-0.5 text-right text-[10px] text-slate-400 dark:text-slate-500" title={formatIdr(data.bac)}>forecast finish · {formatDate(finish)}</div>}
        </>
      )}
      tooltip={({ hoverTime }) => {
        const p = pts[nearestIndex(ptTimes, hoverTime)];
        const rows = [{ label: 'PV', value: formatIdr(p.pv), color: PV }];
        if (p.ac != null) rows.push({ label: 'AC', value: formatIdr(p.ac), color: AC });
        if (p.forecast != null) rows.push({ label: 'Forecast', value: formatIdr(p.forecast), color: FC });
        return <ChartTip heading={formatDate(p.t)} rows={rows} />;
      }}
    >
      {(vp) => {
        const [d0, d1] = vp.domain;
        const x = (t: number) => padL + ((t - d0) / Math.max(1, d1 - d0)) * (W - padL - padR);
        const pointsOf = (sel: (p: Forecast['sCurve'][number]) => number | null): Pt[] =>
          pts.map((p) => ({ px: x(+new Date(p.t)), v: sel(p) })).filter((d) => d.v != null)
            .map((d) => ({ x: d.px, y: y(d.v as number) }));
        const pvPts = pointsOf((p) => p.pv), acPts = pointsOf((p) => p.ac), fcPts = pointsOf((p) => p.forecast);
        const nowX = x(+new Date(data.statusDate));
        const hi = vp.hoverTime != null ? nearestIndex(ptTimes, vp.hoverTime) : -1;
        const hiP = hi >= 0 ? pts[hi] : null;
        const ticks = visibleTicks(d0, d1);
        return (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="fcAcGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={AC} stopOpacity="0.20" />
                <stop offset="100%" stopColor={AC} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Vertical date/week guides aligned to the axis labels below (drawn behind the curves). */}
            {ticks.map((tk) => {
              const gx = tickX(tk.ms, d0, d1);
              return <line key={tk.ms} x1={gx} x2={gx} y1={padT} y2={H - padB} stroke="currentColor" className={tk.major ? 'text-slate-200 dark:text-slate-700/70' : 'text-slate-100 dark:text-slate-800'} strokeWidth="1" vectorEffect="non-scaling-stroke" />;
            })}
            {/* Faint horizontal gridlines + IDR-short labels so intermediate cost values are readable
                without hovering. vector-effect keeps strokes an even 1px despite the non-uniform
                stretch (preserveAspectRatio=none fills the width but would otherwise distort them). */}
            {[0.25, 0.5, 0.75].map((fr) => {
              const gy = y(maxY * fr);
              return (
                <g key={fr}>
                  <line x1={padL} x2={W - padR} y1={gy} y2={gy} stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <text x={padL + 1} y={gy - 2} className="fill-slate-300 text-[9px] dark:fill-slate-600">{formatIdrShort(maxY * fr)}</text>
                </g>
              );
            })}
            {acPts.length > 1 && <path d={areaPath(acPts, H - padB)} fill="url(#fcAcGrad)" stroke="none" />}
            <line x1={padL} x2={W - padR} y1={bacY} y2={bacY} stroke="currentColor" className="text-slate-300 dark:text-slate-700" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            <line x1={padL} x2={W - padR} y1={eacY} y2={eacY} stroke={FC} strokeWidth="1" strokeDasharray="2 3" opacity="0.5" vectorEffect="non-scaling-stroke" />
            {/* "today" marker: a soft vertical guide capped with a dot at the axis. */}
            <line x1={nowX} x2={nowX} y1={padT} y2={H - padB} stroke="currentColor" className="text-slate-300 dark:text-slate-600" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <path d={smoothPath(pvPts)} fill="none" stroke={PV} strokeWidth="2.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {/* Actual cost is the hero line here — soft halo under a crisp stroke: strong but elegant. */}
            <path d={smoothPath(acPts)} fill="none" stroke={AC} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.12" vectorEffect="non-scaling-stroke" />
            <path d={smoothPath(acPts)} fill="none" stroke={AC} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <path d={smoothPath(fcPts)} fill="none" stroke={FC} strokeWidth="2.75" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="currentColor" className="text-slate-300 dark:text-slate-600" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
            {ticks.map((tk) => (
              <line key={tk.ms} x1={tickX(tk.ms, d0, d1)} x2={tickX(tk.ms, d0, d1)} y1={H - padB} y2={H - padB + (tk.major ? 5 : 3)} stroke="currentColor" className={tk.major ? 'text-slate-400 dark:text-slate-500' : 'text-slate-300 dark:text-slate-600'} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {/* Active-point rings following the cursor, on whichever series carry a value there. */}
            {hiP && (
              <g>
                <circle cx={x(+new Date(hiP.t))} cy={y(hiP.pv)} r="3.4" fill={PV} stroke="#fff" strokeWidth="1.2" />
                {hiP.ac != null && <circle cx={x(+new Date(hiP.t))} cy={y(hiP.ac)} r="3.4" fill={AC} stroke="#fff" strokeWidth="1.2" />}
                {hiP.forecast != null && <circle cx={x(+new Date(hiP.t))} cy={y(hiP.forecast)} r="3.4" fill={FC} stroke="#fff" strokeWidth="1.2" />}
              </g>
            )}
            <text x={W - padR} y={bacY - 3} textAnchor="end" className="fill-slate-400 text-[10px]">BAC {formatIdrShort(data.bac)}</text>
            <text x={W - padR} y={Math.abs(eacY - bacY) < 12 ? eacY + 11 : eacY - 3} textAnchor="end" fill={FC} className="text-[10px]" opacity="0.9">EAC {formatIdrShort(data.eac.likely)}</text>
            <text x={Math.min(nowX + 4, W - 40)} y={padT + 10} className="fill-slate-400 text-[10px]">today</text>
          </svg>
        );
      }}
    </ChartZoomFrame>
  );
}
