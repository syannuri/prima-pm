import { useEffect, useId, useState } from 'react';
import type { PortfolioHealth } from '../api/types';

// Flat "neon" half-donut gauge — a single-focus, striking alternative to the speedometer/rings.
// A 180° groove carries a RAG gradient value-arc (deep→bright) that glows and animates its draw on
// mount; the bowl shows the big SPI number + status, with a small CPI/progress caption for context.
// Drop-in replacement for HealthGauge (same props). Used on the portfolio Dashboard (both themes).

const CX = 100, CY = 100, R = 82, SW = 15, SWEEP = 180, START = 180;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const spiToF = (spi: number) => clamp01((spi - 0.5) / 1.0); // SPI 0.5–1.5 → 0..1 along the arc

function point(f: number, radius = R) {
  const rad = ((START - f * SWEEP) * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) };
}
function arcPath(f0: number, f1: number, radius = R) {
  const a = point(f0, radius), b = point(f1, radius);
  const large = (f1 - f0) * SWEEP > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

// [deep → bright] gradient per status: deep anchors the read, bright makes it glow.
const GRAD: Record<PortfolioHealth, [string, string]> = {
  GREEN: ['#15803d', '#4ade80'], AMBER: ['#b45309', '#fbbf24'], RED: ['#b91c1c', '#fb7185'], NO_DATA: ['#94a3b8', '#cbd5e1'],
};
const TEXT: Record<PortfolioHealth, string> = { GREEN: '#16a34a', AMBER: '#d97706', RED: '#dc2626', NO_DATA: '#64748b' };

export default function NeonGauge({ spi, cpi, pct, status, statusLabel, className, compact }: {
  spi: number; cpi: number; pct: number; status: PortfolioHealth; statusLabel: string;
  className?: string; compact?: boolean;
}) {
  const gid = useId();
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, [spi, status]);

  const noData = status === 'NO_DATA';
  const f = noData ? 0 : spiToF(spi);
  const [deep, bright] = GRAD[status];
  const marker = point(f);
  const size = compact ? 208 : 240;

  return (
    <div className={`inline-flex flex-col items-center ${className ?? ''}`}>
      <div className="relative" style={{ width: size, height: size * 0.62 }}>
        <svg viewBox="0 0 200 120" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id={`neon-${gid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={deep} />
              <stop offset="100%" stopColor={bright} />
            </linearGradient>
            <filter id={`glow-${gid}`} x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="0" stdDeviation="3.2" floodColor={bright} floodOpacity="0.7" />
            </filter>
          </defs>
          {/* Groove */}
          <path d={arcPath(0, 1)} fill="none" stroke="rgba(148,163,184,0.22)" strokeWidth={SW} strokeLinecap="round" />
          {/* Threshold ticks (amber 0.85 · green 0.95 · target 1.0) */}
          {!noData && [spiToF(0.85), spiToF(0.95), spiToF(1.0)].map((tf, i) => {
            const o = point(tf, R + SW / 2 + 1.5), inn = point(tf, R - SW / 2 - 1.5);
            return <line key={i} x1={inn.x} y1={inn.y} x2={o.x} y2={o.y} stroke="rgba(100,116,139,0.45)" strokeWidth={i === 2 ? 1.6 : 1} />;
          })}
          {/* Value arc — draws on mount, glows */}
          <path
            d={arcPath(0, Math.max(f, 0.001))} fill="none" stroke={`url(#neon-${gid})`} strokeWidth={SW} strokeLinecap="round"
            pathLength={1} strokeDasharray={1} strokeDashoffset={on ? 0 : 1} filter={`url(#glow-${gid})`}
            style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(.4,0,.2,1)' }}
          />
          {/* Marker */}
          {!noData && (
            <circle cx={marker.x} cy={marker.y} r={5} fill="#fff" stroke={bright} strokeWidth={3}
              style={{ filter: `drop-shadow(0 0 3px ${bright})`, opacity: on ? 1 : 0, transition: 'opacity .5s ease .6s' }} />
          )}
          {/* End scale labels */}
          <text x={point(0).x - 2} y={point(0).y + 12} textAnchor="middle" className="fill-slate-400 text-[8px] dark:fill-white/40">0.5</text>
          <text x={point(1).x + 2} y={point(1).y + 12} textAnchor="middle" className="fill-slate-400 text-[8px] dark:fill-white/40">1.5</text>
        </svg>
        {/* Bowl content */}
        <div className="absolute inset-x-0 top-[42%] flex flex-col items-center text-center">
          <div className="text-3xl font-extrabold leading-none tabular-nums" style={{ color: TEXT[status] }}>{noData ? '—' : spi.toFixed(2)}</div>
          <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: TEXT[status] }}>{statusLabel}</div>
          <div className="mt-0.5 text-[10px] text-slate-400 dark:text-white/40">SPI · schedule</div>
        </div>
      </div>
      {/* Supporting metrics so cost & progress aren't lost with the single-metric focus */}
      <div className="-mt-1 flex items-center gap-3 text-[11px] text-slate-500 dark:text-white/60">
        <span>CPI <span className="font-semibold tabular-nums text-slate-700 dark:text-white">{cpi > 0 ? cpi.toFixed(2) : '—'}</span></span>
        <span className="text-slate-300 dark:text-white/20">·</span>
        <span><span className="font-semibold tabular-nums text-slate-700 dark:text-white">{pct}%</span> done</span>
      </div>
    </div>
  );
}
