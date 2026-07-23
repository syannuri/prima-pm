import type { Forecast } from '../api/types';
import { formatIdrShort, formatIdr, formatDate } from '../lib/format';
import ChartZoomFrame, { nearestIndex } from './chart/ChartZoomFrame';
import { TimeAxisLabels, monthTicks, ChartTip } from './chart/timeAxis';

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
  const maxY = Math.max(
    data.bac, data.eac.pessimistic, data.eac.likely,
    ...pts.map((p) => Math.max(p.pv, p.ac ?? 0, p.forecast ?? 0)),
  ) || 1;
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
        const line = (sel: (p: Forecast['sCurve'][number]) => number | null) =>
          pts.map((p) => ({ px: x(+new Date(p.t)), v: sel(p) })).filter((d) => d.v != null)
            .map((d, i) => `${i === 0 ? 'M' : 'L'}${d.px.toFixed(1)},${y(d.v as number).toFixed(1)}`).join(' ');
        const nowX = x(+new Date(data.statusDate));
        const rawTicks = monthTicks(d0, d1);
        const step = Math.max(1, Math.ceil(rawTicks.length / 9));
        const ticks = rawTicks.filter((_, i) => i % step === 0);
        const tickX = (ms: number) => Math.max(padL, Math.min(W - padR, x(ms)));
        return (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
            <line x1={padL} x2={W - padR} y1={bacY} y2={bacY} stroke="currentColor" className="text-slate-300 dark:text-slate-700" strokeWidth="1" strokeDasharray="2 3" />
            <line x1={padL} x2={W - padR} y1={eacY} y2={eacY} stroke={FC} strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
            <line x1={nowX} x2={nowX} y1={padT} y2={H - padB} stroke="currentColor" className="text-slate-300 dark:text-slate-600" strokeWidth="1" />
            <path d={line((p) => p.pv)} fill="none" stroke={PV} strokeWidth="2" />
            <path d={line((p) => p.ac)} fill="none" stroke={AC} strokeWidth="2.5" strokeLinecap="round" />
            <path d={line((p) => p.forecast)} fill="none" stroke={FC} strokeWidth="2.5" strokeDasharray="5 4" strokeLinecap="round" />
            <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeWidth="1" />
            {ticks.map((tk) => (
              <line key={tk.ms} x1={tickX(tk.ms)} x2={tickX(tk.ms)} y1={H - padB} y2={H - padB + 4} stroke="currentColor" className="text-slate-300 dark:text-slate-600" strokeWidth="1" />
            ))}
            <text x={W - padR} y={bacY - 3} textAnchor="end" className="fill-slate-400 text-[10px]">BAC {formatIdrShort(data.bac)}</text>
            <text x={W - padR} y={Math.abs(eacY - bacY) < 12 ? eacY + 11 : eacY - 3} textAnchor="end" fill={FC} className="text-[10px]" opacity="0.9">EAC {formatIdrShort(data.eac.likely)}</text>
            <text x={Math.min(nowX + 4, W - 40)} y={padT + 10} className="fill-slate-400 text-[10px]">today</text>
          </svg>
        );
      }}
    </ChartZoomFrame>
  );
}
