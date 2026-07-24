import { useEffect, useState } from 'react';
import type { PortfolioHealth } from '../api/types';

// Flat 270° arc gauge for LIGHT mode (mobile) — a brighter, skeuomorphism-free alternative to
// the dark speedometer in HealthGauge. Same SPI 0.5–1.5 scale + RAG thresholds so it reads
// identically: a soft RAG track shows the zones, a bold value-arc fills 0→SPI in the current
// status colour, and a marker dot sits at the value. No metal/needle — airy on a white card.
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
// Solid, slightly deeper tones for the value fill + read-out so text stays legible on white.
const STATUS_COLOR: Record<PortfolioHealth, string> = { GREEN: '#16a34a', AMBER: '#d97706', RED: '#dc2626', NO_DATA: '#64748b' };

export default function HealthArcGauge({ spi, cpi, pct, status, statusLabel, className, compact }: {
  spi: number; cpi: number; pct: number; status: PortfolioHealth; statusLabel: string;
  className?: string;
  compact?: boolean;
}) {
  const noData = status === 'NO_DATA';
  const f = noData ? 0.5 : spiToF(spi);
  const fAmber = spiToF(0.85), fGreen = spiToF(0.95);
  const color = STATUS_COLOR[status];
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
        {/* Base track */}
        <path d={arc(0, 1)} fill="none" stroke="#e2e8f0" strokeWidth="14" strokeLinecap="round" />
        {/* Soft RAG zones (muted so the card stays light) */}
        {!noData && (
          <>
            <path d={arc(0, fAmber)} fill="none" stroke={ZONE.red} strokeOpacity={0.3} strokeWidth="14" strokeLinecap="round" />
            <path d={arc(fAmber, fGreen)} fill="none" stroke={ZONE.amber} strokeOpacity={0.3} strokeWidth="14" />
            <path d={arc(fGreen, 1)} fill="none" stroke={ZONE.green} strokeOpacity={0.3} strokeWidth="14" strokeLinecap="round" />
          </>
        )}
        {/* Value fill 0→SPI in the current status colour, animated grow */}
        {!noData && (
          <path
            d={arc(0, 1)} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
            pathLength={1}
            style={{ strokeDasharray: 1, strokeDashoffset: grown ? 1 - f : 1, transition: 'stroke-dashoffset 900ms cubic-bezier(0.34,1.1,0.64,1)' }}
          />
        )}
        {/* Marker dot at the value */}
        {!noData && <circle cx={marker.x} cy={marker.y} r="6" fill="#ffffff" stroke={color} strokeWidth="3" />}
        {/* Scale labels (0.5 · 1.0 · 1.5) */}
        {[{ f: 0, t: '0.5' }, { f: 0.5, t: '1.0' }, { f: 1, t: '1.5' }].map(({ f: lf, t }) => {
          const q = point(lf, R - 20);
          return <text key={t} x={q.x} y={q.y + 3} textAnchor="middle" className="fill-slate-400 text-[8px] font-semibold tabular-nums">{t}</text>;
        })}
      </svg>

      {/* Digital read-out in the open lower-middle of the arc. */}
      <div className={`pointer-events-none absolute inset-x-0 flex flex-col items-center ${compact ? 'bottom-0' : 'bottom-1'}`}>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color }}>{statusLabel}</span>
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
