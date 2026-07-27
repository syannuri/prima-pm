import { useEffect, useState } from 'react';
import type { PortfolioHealth } from '../api/types';

// Concentric "EVM rings" gauge (Apple-Watch activity-ring style) — one glance shows all three EVM
// dimensions at once: OUTER = Schedule (SPI), MIDDLE = Cost (CPI), INNER = Progress (% complete).
// SPI/CPI rings are RAG-coloured by their own thresholds; the progress ring is a neutral sky arc.
// Drop-in replacement for HealthGauge (same props) — used on the portfolio Dashboard (both themes).

const RAG: Record<PortfolioHealth, string> = { GREEN: '#22c55e', AMBER: '#f59e0b', RED: '#ef4444', NO_DATA: '#94a3b8' };
const PROG = '#0ea5e9'; // sky — progress is not a RAG metric
const TRACK = 'rgba(148,163,184,0.22)'; // groove, reads on both light & dark cards
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
// SPI/CPI live on a 0.5–1.5 band → fill fraction (1.0 target sits at the halfway mark).
const ratioFrac = (v: number) => clamp01((v - 0.5) / 1.0);
const ragOf = (v: number): PortfolioHealth => (v >= 0.95 ? 'GREEN' : v >= 0.85 ? 'AMBER' : 'RED');

function Ring({ r, frac, color, on }: { r: number; frac: number; color: string; on: boolean }) {
  const C = 2 * Math.PI * r;
  return (
    <>
      <circle cx="100" cy="100" r={r} fill="none" strokeWidth="13" stroke={TRACK} />
      <circle
        cx="100" cy="100" r={r} fill="none" strokeWidth="13" stroke={color} strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={on ? C * (1 - frac) : C}
        style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(.4,0,.2,1)', filter: `drop-shadow(0 0 3px ${color}55)` }}
      />
    </>
  );
}

export default function EvmRings({ spi, cpi, pct, status, statusLabel, className, compact }: {
  spi: number; cpi: number; pct: number; status: PortfolioHealth; statusLabel: string;
  className?: string; compact?: boolean;
}) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, [spi, cpi, pct]);

  const noData = status === 'NO_DATA';
  const spiStatus: PortfolioHealth = noData ? 'NO_DATA' : ragOf(spi);
  const cpiStatus: PortfolioHealth = cpi > 0 ? ragOf(cpi) : 'NO_DATA';
  const sFrac = noData ? 0 : ratioFrac(spi);
  const cFrac = cpi > 0 ? ratioFrac(cpi) : 0;
  const pFrac = clamp01(pct / 100);
  const size = compact ? 128 : 152;

  const rows: { label: string; value: string; color: string }[] = [
    { label: 'Schedule', value: noData ? '—' : spi.toFixed(2), color: RAG[spiStatus] },
    { label: 'Cost', value: cpi > 0 ? cpi.toFixed(2) : '—', color: RAG[cpiStatus] },
    { label: 'Progress', value: `${pct}%`, color: PROG },
  ];

  return (
    <div className={`flex items-center gap-4 ${className ?? ''}`}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
          <Ring r={80} frac={sFrac} color={RAG[spiStatus]} on={on} />
          <Ring r={61} frac={cFrac} color={RAG[cpiStatus]} on={on} />
          <Ring r={42} frac={pFrac} color={PROG} on={on} />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-2xl font-extrabold leading-none tabular-nums text-slate-800 dark:text-white">{noData ? '—' : `${pct}%`}</div>
            <div className="mt-1 text-[9px] font-bold uppercase tracking-wide" style={{ color: RAG[status] }}>{statusLabel}</div>
          </div>
        </div>
      </div>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
            <span className="w-16 text-slate-500 dark:text-white/60">{row.label}</span>
            <span className="font-semibold tabular-nums text-slate-800 dark:text-white">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
