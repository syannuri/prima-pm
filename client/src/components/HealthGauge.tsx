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

export default function HealthGauge({ spi, cpi, pct, status, statusLabel }: {
  spi: number; cpi: number; pct: number; status: PortfolioHealth; statusLabel: string;
}) {
  const noData = status === 'NO_DATA';
  const f = noData ? 0.5 : spiToF(spi);
  const needleAngle = -(START - f * SWEEP); // SVG rotate is CW; math angle is CCW → negate

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
      </div>
    </div>
  );
}
