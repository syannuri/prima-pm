import { useEffect, useState } from 'react';
import type { PortfolioHealth } from '../api/types';

// Flat-but-lively 270° arc gauge for LIGHT mode — a brighter alternative to the dark
// speedometer (HealthGauge). Same SPI 0.5–1.5 scale + RAG thresholds. The groove is carved
// into the card (inner-shadow emboss), the value-arc fills 0→SPI with a status gradient that
// glows, a glossy sheen rides the top, and the marker dot is haloed. Dark mode keeps the
// speedometer; this is used on both the mobile dashboard and the project Overview tab (light).
const CX = 110, CY = 104, R = 84, SWEEP = 270, START = 225;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const spiToF = (spi: number) => clamp01((spi - 0.5) / 1.0);

function point(f: number, radius = R) {
  const rad = ((START - f * SWEEP) * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) };
}
function arc(f0: number, f1: number, radius = R) {
  const p0 = point(f0, radius), p1 = point(f1, radius);
  const large = (f1 - f0) * SWEEP > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

const ZONE = { red: '#ef4444', amber: '#f59e0b', green: '#22c55e' };
// [deep → bright] gradient stops per status: deep anchors the read, bright makes it "alive".
const GRAD: Record<PortfolioHealth, [string, string]> = {
  GREEN: ['#15803d', '#4ade80'],
  AMBER: ['#b45309', '#fbbf24'],
  RED: ['#b91c1c', '#fb7185'],
  NO_DATA: ['#94a3b8', '#cbd5e1'],
};
const TEXT_COLOR: Record<PortfolioHealth, string> = { GREEN: '#16a34a', AMBER: '#d97706', RED: '#dc2626', NO_DATA: '#64748b' };

export default function HealthArcGauge({ spi, cpi, pct, status, statusLabel, className, compact }: {
  spi: number; cpi: number; pct: number; status: PortfolioHealth; statusLabel: string;
  className?: string;
  compact?: boolean;
}) {
  const noData = status === 'NO_DATA';
  const f = noData ? 0.5 : spiToF(spi);
  const fAmber = spiToF(0.85), fGreen = spiToF(0.95);
  const [c0, c1] = GRAD[status];
  const textColor = TEXT_COLOR[status];
  const marker = point(f);

  // Grow the value-arc from empty on mount (CSS transition on the dash offset). Honours
  // prefers-reduced-motion by starting already-grown.
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [grown, setGrown] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const r = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(r);
  }, [reduce]);

  return (
    <div className={`relative mx-auto w-full ${className ?? 'max-w-[280px]'}`}>
      <svg viewBox="0 0 220 168" className="w-full">
        <defs>
          <linearGradient id="hgArcFill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={c0} /><stop offset="100%" stopColor={c1} />
          </linearGradient>
          {/* Inner-shadow emboss so the groove reads as carved into the light card. */}
          <filter id="hgInset" x="-20%" y="-20%" width="140%" height="140%">
            <feComponentTransfer in="SourceAlpha"><feFuncA type="table" tableValues="1 0" /></feComponentTransfer>
            <feGaussianBlur stdDeviation="1.6" />
            <feOffset dx="0" dy="1.3" result="off" />
            <feFlood floodColor="#0f172a" floodOpacity="0.28" />
            <feComposite in2="off" operator="in" />
            <feComposite in2="SourceAlpha" operator="in" />
            <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode /></feMerge>
          </filter>
          {/* Coloured glow around the value arc + marker (status hue). */}
          <filter id="hgGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="0" stdDeviation="3.2" floodColor={c1} floodOpacity="0.6" />
          </filter>
        </defs>

        {/* Carved groove */}
        <path d={arc(0, 1)} fill="none" stroke="#e6eaf1" strokeWidth="14" strokeLinecap="round" filter="url(#hgInset)" />
        {/* Soft RAG zones (muted, so thresholds stay visible under/after the fill) */}
        {!noData && (
          <>
            <path d={arc(0, fAmber)} fill="none" stroke={ZONE.red} strokeOpacity={0.28} strokeWidth="14" strokeLinecap="round" />
            <path d={arc(fAmber, fGreen)} fill="none" stroke={ZONE.amber} strokeOpacity={0.28} strokeWidth="14" />
            <path d={arc(fGreen, 1)} fill="none" stroke={ZONE.green} strokeOpacity={0.28} strokeWidth="14" strokeLinecap="round" />
          </>
        )}
        {/* Value fill 0→SPI: status gradient + glow, animated grow */}
        {!noData && (
          <path
            d={arc(0, 1)} fill="none" stroke="url(#hgArcFill)" strokeWidth="13" strokeLinecap="round"
            filter="url(#hgGlow)" pathLength={1}
            style={{ strokeDasharray: 1, strokeDashoffset: grown ? 1 - f : 1, transition: 'stroke-dashoffset 950ms cubic-bezier(0.34,1.1,0.64,1)' }}
          />
        )}
        {/* Glossy top sheen along the fill */}
        {!noData && (
          <path
            d={arc(0, 1, R + 3.5)} fill="none" stroke="#ffffff" strokeOpacity={0.5} strokeWidth="2.4" strokeLinecap="round"
            pathLength={1}
            style={{ strokeDasharray: 1, strokeDashoffset: grown ? 1 - f : 1, transition: 'stroke-dashoffset 950ms cubic-bezier(0.34,1.1,0.64,1)' }}
          />
        )}
        {/* Glowing marker dot at the value */}
        {!noData && (
          <>
            <circle cx={marker.x} cy={marker.y} r="7" fill={c1} filter="url(#hgGlow)" opacity={0.9} />
            <circle cx={marker.x} cy={marker.y} r="6" fill="#ffffff" stroke={c1} strokeWidth="3" />
          </>
        )}
        {/* Scale labels (0.5 · 1.0 · 1.5) */}
        {[{ f: 0, t: '0.5' }, { f: 0.5, t: '1.0' }, { f: 1, t: '1.5' }].map(({ f: lf, t }) => {
          const q = point(lf, R - 20);
          return <text key={t} x={q.x} y={q.y + 3} textAnchor="middle" className="fill-slate-400 text-[8px] font-semibold tabular-nums">{t}</text>;
        })}
      </svg>

      {/* Digital read-out in the open lower-middle of the arc. */}
      <div className={`pointer-events-none absolute inset-x-0 flex flex-col items-center ${compact ? 'bottom-0' : 'bottom-1'}`}>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: textColor }}>{statusLabel}</span>
        <span className={`mt-0.5 font-extrabold leading-none tabular-nums text-slate-800 ${compact ? 'text-[16px]' : 'text-3xl'}`}>
          {noData ? '—' : spi.toFixed(2)}
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">SPI</span>
        <span className={`mt-0.5 tabular-nums text-slate-500 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
          CPI {cpi > 0 ? cpi.toFixed(2) : '—'} · {pct}%
        </span>
      </div>
    </div>
  );
}
