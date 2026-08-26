import { useState } from 'react';
import type { CashflowPeriod } from '../api/types';
import { useLang } from '../context/LanguageContext';
import { formatIdr, formatIdrShort } from '../lib/format';

// Hand-rolled SVG cash-flow chart (no chart lib in this app). Two modes:
//  • "period"     — grouped bars per period: planned vs actual/forecast + a committed tick.
//  • "cumulative" — the classic S-curve: cumulative planned / actual / forecast lines.
// Kept purely presentational; data comes from GET /projects/:id/cashflow.

const PLAN = '#94a3b8'; // slate-400
const ACT = '#0ea5e9'; // sky-500
const FC = '#f4675f'; // brand-500
const COMM = '#f59e0b'; // amber-500

const W = 760, H = 264, padL = 52, padR = 16, padT = 16, padB = 46;
const plotW = W - padL - padR;
const plotH = H - padT - padB;

type Mode = 'period' | 'cumulative';

export default function CashflowChart({ periods, eacLikely }: { periods: CashflowPeriod[]; eacLikely: number }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const [mode, setMode] = useState<Mode>('period');
  const [hover, setHover] = useState<number | null>(null);

  if (periods.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{id ? 'Tak ada window rencana untuk dibagi per periode.' : 'No planned window to time-phase.'}</p>;
  }

  const n = periods.length;
  const groupW = plotW / n;
  const cx = (i: number) => padL + groupW * (i + 0.5);

  const maxY = mode === 'period'
    ? Math.max(1, ...periods.map((p) => Math.max(p.planned, p.actual ?? 0, p.forecast ?? 0, p.committed)))
    : Math.max(1, eacLikely, ...periods.map((p) => Math.max(p.cumPlanned, p.cumActual ?? 0, p.cumForecast ?? 0)));
  const y = (v: number) => padT + (1 - v / maxY) * plotH;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY);

  // Cumulative polyline point sets (drop null tails so actual stops at the status date).
  const line = (pick: (p: CashflowPeriod) => number | null) =>
    periods.map((p, i) => ({ x: cx(i), v: pick(p) })).filter((pt) => pt.v != null).map((pt) => `${pt.x},${y(pt.v as number)}`).join(' ');

  const btn = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`rounded px-2 py-0.5 text-xs font-medium ${mode === m ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}
    >{label}</button>
  );

  const barW = Math.min(18, groupW * 0.32);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          {mode === 'period' ? (
            <>
              <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: PLAN }} />{id ? 'Rencana' : 'Planned'}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: ACT }} />{id ? 'Aktual' : 'Actual'}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm opacity-60" style={{ background: FC }} />{id ? 'Proyeksi' : 'Forecast'}</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-3" style={{ background: COMM }} />Committed</span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: PLAN }} />{id ? 'Σ Rencana' : 'Cum. planned'}</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: ACT }} />{id ? 'Σ Aktual' : 'Cum. actual'}</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-4 border-t border-dashed" style={{ borderColor: FC }} />{id ? 'Σ Proyeksi' : 'Cum. forecast'}</span>
            </>
          )}
        </div>
        <div className="flex gap-1">{btn('period', id ? 'Per periode' : 'Per period')}{btn('cumulative', id ? 'Kumulatif' : 'Cumulative')}</div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Cash-flow chart">
        {/* y grid + labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400 text-[9px]">{formatIdrShort(t)}</text>
          </g>
        ))}

        {mode === 'period'
          ? periods.map((p, i) => {
              const base = cx(i);
              const secVal = p.actual != null ? p.actual : p.forecast ?? 0;
              const secColor = p.actual != null ? ACT : FC;
              const secOpacity = p.actual != null ? 1 : 0.6;
              return (
                <g key={p.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  {/* hover hit-area */}
                  <rect x={padL + groupW * i} y={padT} width={groupW} height={plotH} fill={hover === i ? 'currentColor' : 'transparent'} className="text-slate-100 dark:text-slate-800" opacity={hover === i ? 0.5 : 0} />
                  <rect x={base - barW - 1} y={y(p.planned)} width={barW} height={Math.max(0, y(0) - y(p.planned))} fill={PLAN} rx={1.5} />
                  <rect x={base + 1} y={y(secVal)} width={barW} height={Math.max(0, y(0) - y(secVal))} fill={secColor} opacity={secOpacity} rx={1.5} />
                  {p.committed > 0 && (
                    <line x1={base - barW - 2} y1={y(p.committed)} x2={base + barW + 2} y2={y(p.committed)} stroke={COMM} strokeWidth={2} />
                  )}
                </g>
              );
            })
          : (
            <>
              <polyline points={line((p) => p.cumPlanned)} fill="none" stroke={PLAN} strokeWidth={2} />
              <polyline points={line((p) => p.cumActual)} fill="none" stroke={ACT} strokeWidth={2} />
              <polyline points={line((p) => p.cumForecast)} fill="none" stroke={FC} strokeWidth={2} strokeDasharray="5 3" />
              {periods.map((p, i) => (
                <g key={p.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={padL + groupW * i} y={padT} width={groupW} height={plotH} fill="transparent" />
                  {hover === i && <line x1={cx(i)} y1={padT} x2={cx(i)} y2={padT + plotH} stroke="currentColor" className="text-slate-300 dark:text-slate-600" strokeWidth={1} />}
                </g>
              ))}
            </>
          )}

        {/* x labels — thin out when crowded */}
        {periods.map((p, i) => {
          const step = Math.ceil(n / 12);
          if (i % step !== 0 && i !== n - 1) return null;
          return <text key={p.key} x={cx(i)} y={H - padB + 16} textAnchor="middle" className="fill-slate-400 text-[9px]">{p.label}</text>;
        })}
      </svg>

      {hover != null && (
        <div className="mt-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <span className="font-medium">{periods[hover].label}</span>
          <span className="mx-2 text-slate-400">·</span>
          {mode === 'period' ? (
            <>
              <span style={{ color: PLAN }}>{id ? 'Rencana' : 'Planned'} {formatIdr(periods[hover].planned)}</span>
              {periods[hover].actual != null && <span className="ml-2" style={{ color: ACT }}>{id ? 'Aktual' : 'Actual'} {formatIdr(periods[hover].actual as number)}</span>}
              {periods[hover].forecast != null && <span className="ml-2" style={{ color: FC }}>{id ? 'Proyeksi' : 'Forecast'} {formatIdr(periods[hover].forecast as number)}</span>}
              {periods[hover].committed > 0 && <span className="ml-2" style={{ color: COMM }}>Committed {formatIdr(periods[hover].committed)}</span>}
            </>
          ) : (
            <>
              <span style={{ color: PLAN }}>{id ? 'Σ Rencana' : 'Σ Planned'} {formatIdr(periods[hover].cumPlanned)}</span>
              {periods[hover].cumActual != null && <span className="ml-2" style={{ color: ACT }}>{id ? 'Σ Aktual' : 'Σ Actual'} {formatIdr(periods[hover].cumActual as number)}</span>}
              {periods[hover].cumForecast != null && <span className="ml-2" style={{ color: FC }}>{id ? 'Σ Proyeksi' : 'Σ Forecast'} {formatIdr(periods[hover].cumForecast as number)}</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
