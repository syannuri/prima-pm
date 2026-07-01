import type { Forecast } from '../api/types';
import { formatIdrShort, formatIdr, formatDate } from '../lib/format';

const PV = '#94a3b8'; // slate-400 — planned value baseline
const AC = '#0ea5e9'; // sky-500 — actual cost to date
const FC = '#f4675f'; // brand-500 — forecast cost to EAC

// EVM cost S-curve: planned PV (baseline), actual AC (to today), and a dashed
// forecast line projecting cost to the likely EAC at the forecast finish date.
export default function ForecastChart({ data }: { data: Forecast }) {
  const pts = data.sCurve;
  if (pts.length < 2) {
    return <div className="rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">No schedule data to project a cost curve.</div>;
  }

  const W = 720, H = 240, padL = 8, padR = 12, padT = 12, padB = 26;
  const t0 = +new Date(pts[0].t), t1 = +new Date(pts[pts.length - 1].t);
  const maxY = Math.max(
    data.bac, data.eac.pessimistic, data.eac.likely,
    ...pts.map((p) => Math.max(p.pv, p.ac ?? 0, p.forecast ?? 0)),
  ) || 1;
  const x = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);
  const line = (sel: (p: Forecast['sCurve'][number]) => number | null) =>
    pts.map((p) => ({ px: x(+new Date(p.t)), v: sel(p) })).filter((d) => d.v != null)
      .map((d, i) => `${i === 0 ? 'M' : 'L'}${d.px.toFixed(1)},${y(d.v as number).toFixed(1)}`).join(' ');

  const nowX = x(+new Date(data.statusDate));
  const bacY = y(data.bac);
  const eacY = y(data.eac.likely);
  const finish = data.schedule.forecastFinish;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Cost projection (S-curve)</div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: PV }} />Planned (PV)</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: AC }} />Actual (AC)</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-4 border-t border-dashed" style={{ borderColor: FC }} />Forecast</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Cost S-curve forecast">
        {/* BAC & EAC reference lines */}
        <line x1={padL} x2={W - padR} y1={bacY} y2={bacY} stroke="currentColor" className="text-slate-300 dark:text-slate-700" strokeWidth="1" strokeDasharray="2 3" />
        <line x1={padL} x2={W - padR} y1={eacY} y2={eacY} stroke={FC} strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
        {/* today marker */}
        <line x1={nowX} x2={nowX} y1={padT} y2={H - padB} stroke="currentColor" className="text-slate-300 dark:text-slate-600" strokeWidth="1" />
        {/* series */}
        <path d={line((p) => p.pv)} fill="none" stroke={PV} strokeWidth="2" />
        <path d={line((p) => p.ac)} fill="none" stroke={AC} strokeWidth="2.5" strokeLinecap="round" />
        <path d={line((p) => p.forecast)} fill="none" stroke={FC} strokeWidth="2.5" strokeDasharray="5 4" strokeLinecap="round" />
        {/* labels */}
        <text x={W - padR} y={bacY - 3} textAnchor="end" className="fill-slate-400 text-[10px]">BAC {formatIdrShort(data.bac)}</text>
        <text x={W - padR} y={eacY - 3} textAnchor="end" fill={FC} className="text-[10px]" opacity="0.9">EAC {formatIdrShort(data.eac.likely)}</text>
        <text x={Math.min(nowX + 4, W - 40)} y={H - padB + 16} className="fill-slate-400 text-[10px]">today</text>
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400 dark:text-slate-500">
        <span title={formatIdr(data.bac)}>{formatDate(pts[0].t)}</span>
        {finish && <span>forecast finish · {formatDate(finish)}</span>}
      </div>
    </div>
  );
}
