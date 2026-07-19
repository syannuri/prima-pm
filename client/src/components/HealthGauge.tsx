import { useEffect, useRef, useState } from 'react';
import type { PortfolioHealth } from '../api/types';

// A 3D speedometer-style gauge for portfolio schedule health. The needle points to
// SPI on a 0.5–1.5 scale; the coloured zones (red < 0.85, amber 0.85–0.95, green ≥ 0.95)
// mirror the RAG status so "needle in the green" reads as on-track at a glance.
//
// Geometry: a 270° sweep from 225° (lower-left) clockwise over the top to -45°
// (lower-right). f∈[0,1] maps SPI 0.5→1.5. Angles are math-convention (CCW, y-up)
// and converted to SVG (y-down) in point().
const CX = 110;
const CY = 104;
const R = 84;
const SWEEP = 270;
const START = 225;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const spiToF = (spi: number) => clamp01((spi - 0.5) / 1.0);

function point(f: number, radius = R) {
  const deg = START - f * SWEEP;
  const rad = (deg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) };
}

// Arc path following the gauge from f0→f1 (increasing f = clockwise on screen).
function arc(f0: number, f1: number, radius = R) {
  const p0 = point(f0, radius);
  const p1 = point(f1, radius);
  const large = (f1 - f0) * SWEEP > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

export default function HealthGauge({ spi, cpi, pct, status, statusLabel, margin }: {
  spi: number; cpi: number; pct: number; status: PortfolioHealth; statusLabel: string;
  // Optional projected-margin read-out shown inside the dial (project Overview only).
  margin?: { text: string; warn: boolean } | null;
}) {
  const noData = status === 'NO_DATA';
  const f = noData ? 0.5 : spiToF(spi);

  // Needle animation: on first appearance run a car-dashboard "self-test" — the needle
  // sweeps from the dial's start (min) all the way to max, holds briefly, then settles
  // onto the actual value. Later value changes do a quick direct tween. Honours
  // prefers-reduced-motion.
  const [displayF, setDisplayF] = useState(noData ? 0.5 : 0);
  const fromRef = useRef(noData ? 0.5 : 0);
  const firstRef = useRef(true);
  useEffect(() => {
    const target = noData ? 0.5 : f;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || noData) { setDisplayF(target); fromRef.current = target; firstRef.current = false; return; }
    const selfTest = firstRef.current;
    firstRef.current = false;
    const from = fromRef.current;
    const dur = selfTest ? 1900 : 750;
    const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
    const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const easeOutBack = (x: number) => { const c1 = 1.2, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
    // Self-test trajectory: 0→max (sweep up), hold at max, then max→target (settle).
    const UP = 0.4, HOLD = 0.52;
    const value = (p: number) => {
      if (!selfTest) return from + (target - from) * easeOutBack(p);
      if (p <= UP) return easeOut(p / UP);                                  // min → max
      if (p <= HOLD) return 1;                                             // hold at max
      return 1 + easeInOut((p - HOLD) / (1 - HOLD)) * (target - 1);        // max → value
    };
    let raf = 0; let startTs: number | undefined;
    const step = (ts: number) => {
      if (startTs === undefined) startTs = ts;
      const p = Math.min(1, (ts - startTs) / dur);
      setDisplayF(value(p));
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [f, noData]);

  const needleAngle = -(START - displayF * SWEEP); // SVG rotate is CW; math angle is CCW → negate

  // Zone boundaries in f-space: red 0.5–0.85, amber 0.85–0.95, green 0.95–1.5.
  const fAmber = spiToF(0.85);
  const fGreen = spiToF(0.95);

  // Tick marks every 1/10 of the sweep.
  const ticks = Array.from({ length: 11 }, (_, i) => i / 10);

  return (
    <div className="relative mx-auto w-full max-w-[280px]">
      <svg viewBox="0 0 220 168" className="w-full drop-shadow-[0_6px_10px_rgba(0,0,0,0.35)]">
        <defs>
          {/* Glossy face — radial depth so the gauge reads as a physical dial. */}
          <radialGradient id="hgFace" cx="50%" cy="42%" r="72%">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="70%" stopColor="#0b1220" />
            <stop offset="100%" stopColor="#020617" />
          </radialGradient>
          <linearGradient id="hgRed" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#7f1d1d" /><stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
          <linearGradient id="hgAmber" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f59e0b" /><stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>
          <linearGradient id="hgGreen" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22c55e" /><stop offset="100%" stopColor="#4ade80" />
          </linearGradient>
          <linearGradient id="hgNeedle" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#e2e8f0" /><stop offset="55%" stopColor="#f8fafc" /><stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>
          <radialGradient id="hgHub" cx="38%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#f8fafc" /><stop offset="45%" stopColor="#94a3b8" /><stop offset="100%" stopColor="#334155" />
          </radialGradient>
          <linearGradient id="hgGloss" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" /><stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <filter id="hgShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.45" />
          </filter>
        </defs>

        {/* Dial face */}
        <circle cx={CX} cy={CY} r={R + 14} fill="url(#hgFace)" stroke="#1e293b" strokeWidth="1.5" />
        <path d={arc(0, 1, R + 14)} fill="none" stroke="url(#hgGloss)" strokeWidth="10" strokeLinecap="round" opacity="0.5" />

        {/* Track groove */}
        <path d={arc(0, 1)} fill="none" stroke="#0f172a" strokeWidth="15" strokeLinecap="round" />

        {/* Coloured zones */}
        <path d={arc(0, fAmber)} fill="none" stroke={noData ? '#334155' : 'url(#hgRed)'} strokeWidth="12" strokeLinecap="round" />
        <path d={arc(fAmber, fGreen)} fill="none" stroke={noData ? '#334155' : 'url(#hgAmber)'} strokeWidth="12" />
        <path d={arc(fGreen, 1)} fill="none" stroke={noData ? '#334155' : 'url(#hgGreen)'} strokeWidth="12" strokeLinecap="round" />

        {/* Ticks */}
        {ticks.map((tf) => {
          const a = point(tf, R - 9);
          const b = point(tf, R - 2);
          const major = tf === 0 || tf === 0.5 || tf === 1;
          return <line key={tf} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e2e8f0" strokeOpacity={major ? 0.9 : 0.4} strokeWidth={major ? 1.6 : 1} />;
        })}

        {/* SPI scale labels at the major ticks (0.5 left · 1.0 top · 1.5 right). */}
        {[{ f: 0, t: '0.5' }, { f: 0.5, t: '1.0' }, { f: 1, t: '1.5' }].map(({ f: lf, t: lt }) => {
          const q = point(lf, R - 20);
          return <text key={lt} x={q.x} y={q.y + 3} textAnchor="middle" className="fill-white/55 text-[8px] font-semibold tabular-nums">{lt}</text>;
        })}

        {/* Needle */}
        {!noData && (
          <g transform={`rotate(${needleAngle} ${CX} ${CY})`} filter="url(#hgShadow)">
            <polygon points={`${CX - 10},${CY} ${CX},${CY - 4} ${CX + R - 16},${CY} ${CX},${CY + 4}`} fill="url(#hgNeedle)" />
          </g>
        )}
        {/* Hub */}
        <circle cx={CX} cy={CY} r="11" fill="url(#hgHub)" stroke="#0f172a" strokeWidth="1" filter="url(#hgShadow)" />
        <circle cx={CX - 3} cy={CY - 3} r="3" fill="#fff" opacity="0.55" />
      </svg>

      {/* Digital read-out — sits in the open lower-middle of the dial. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-1 flex flex-col items-center">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/70">{statusLabel}</span>
        <span className="mt-0.5 text-2xl font-extrabold leading-none tabular-nums text-white drop-shadow">
          {noData ? '—' : `SPI ${spi.toFixed(2)}`}
        </span>
        <span className="mt-1 text-[11px] tabular-nums text-white/70">
          CPI {cpi > 0 ? cpi.toFixed(2) : '—'} · {pct}% complete
        </span>
        {margin && (
          <span className={`mt-0.5 text-[11px] font-semibold tabular-nums ${margin.warn ? 'text-rose-300' : 'text-emerald-300'}`}>
            {margin.text}
          </span>
        )}
      </div>
    </div>
  );
}
