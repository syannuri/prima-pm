import { useEffect, useState } from 'react';

// Bullet gauge for project performance — the data-viz standard for "value vs target within
// qualitative ranges" (Stephen Few). Two stacked rows: Schedule (SPI) + Cost (CPI). Each row is a
// track on the 0.5–1.5 index scale carrying faint RAG bands (red < 0.85 · amber 0.85–0.95 · green
// ≥ 0.95), a vivid MEASURE bar filled 0→value and coloured by the ZONE the value lands in (so
// "green bar = healthy" is literally true), and a TARGET tick fixed at 1.0. Replaces the radial
// HealthArcGauge on the project Overview — clearer, shows the 1.0 target explicitly, and surfaces
// both schedule AND cost at a glance. Works in light + dark.

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
// Map an index value onto the 0.5–1.5 track (0→100%). Values are clamped to the ends.
const posPct = (v: number) => clamp01((v - 0.5) / 1.0) * 100;

type Zone = 'RED' | 'AMBER' | 'GREEN';
const zoneOf = (v: number): Zone => (v >= 0.95 ? 'GREEN' : v >= 0.85 ? 'AMBER' : 'RED');

// Band edges on the 0.5–1.5 scale: red 0.5–0.85 (35%), amber 0.85–0.95 (10%), green 0.95–1.5 (55%).
const BAND_AMBER = posPct(0.85); // 35
const BAND_GREEN = posPct(0.95); // 45
const TARGET = posPct(1.0);      // 50

const BAR: Record<Zone, string> = {
  RED: 'from-red-400 to-red-500',
  AMBER: 'from-amber-400 to-amber-500',
  GREEN: 'from-emerald-400 to-emerald-500',
};
const TXT: Record<Zone, string> = {
  RED: 'text-red-600 dark:text-red-400',
  AMBER: 'text-amber-600 dark:text-amber-500',
  GREEN: 'text-emerald-600 dark:text-emerald-400',
};
const DOT: Record<Zone, string> = {
  RED: 'bg-red-500',
  AMBER: 'bg-amber-500',
  GREEN: 'bg-emerald-500',
};
// Zone verdicts per metric — [English, Indonesian].
const WORDS: Record<'schedule' | 'cost', Record<Zone, [string, string]>> = {
  schedule: { GREEN: ['On track', 'Sesuai jadwal'], AMBER: ['Slightly behind', 'Agak mundur'], RED: ['Behind', 'Terlambat'] },
  cost: { GREEN: ['On budget', 'Sesuai anggaran'], AMBER: ['Watch', 'Waspada'], RED: ['Over budget', 'Boros'] },
};

function BulletRow({ kind, label, value, has, id, compact, grown }: {
  kind: 'schedule' | 'cost';
  label: string;
  value: number;
  has: boolean; // is there enough data (PV>0 for SPI, AC>0 for CPI) to score this index?
  id?: boolean; // Indonesian copy
  compact?: boolean;
  grown: boolean;
}) {
  const zone = has ? zoneOf(value) : null;
  const p = has ? posPct(value) : 0;
  const trackH = compact ? 'h-2.5' : 'h-3';
  const barH = compact ? 'h-1' : 'h-1.5';
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className={`font-extrabold leading-none tabular-nums ${compact ? 'text-sm' : 'text-base'} ${zone ? TXT[zone] : 'text-slate-400 dark:text-slate-500'}`}>
            {has ? value.toFixed(2) : '—'}
          </span>
          {zone && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${TXT[zone]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${DOT[zone]}`} />
              {WORDS[kind][zone][id ? 1 : 0]}
            </span>
          )}
        </span>
      </div>
      {/* Track: faint RAG bands full-width, a vivid measure bar 0→value over them, a target tick at 1.0. */}
      <div className={`relative w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 ${trackH}`}>
        <div className="absolute inset-y-0 left-0 bg-red-300/50 dark:bg-red-500/20" style={{ width: `${BAND_AMBER}%` }} />
        <div className="absolute inset-y-0 bg-amber-300/50 dark:bg-amber-500/20" style={{ left: `${BAND_AMBER}%`, width: `${BAND_GREEN - BAND_AMBER}%` }} />
        <div className="absolute inset-y-0 right-0 bg-emerald-300/50 dark:bg-emerald-500/20" style={{ left: `${BAND_GREEN}%` }} />
        {has && (
          <div
            className={`absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r shadow-sm transition-[width] duration-700 ease-out ${barH} ${BAR[zone!]}`}
            style={{ width: grown ? `${Math.max(2, p)}%` : '0%' }}
          />
        )}
        {/* Target 1.0 — the on-plan line every index is measured against. */}
        <div className="absolute -inset-y-0.5 w-[2px] rounded bg-slate-700/80 dark:bg-white/80" style={{ left: `calc(${TARGET}% - 1px)` }} title="Target 1.00" />
      </div>
    </div>
  );
}

export default function HealthBulletGauge({ spi, cpi, hasSchedule, hasCost, id, compact, className }: {
  spi: number; cpi: number;
  hasSchedule: boolean; // PV > 0
  hasCost: boolean;     // AC > 0
  id?: boolean;
  compact?: boolean;
  className?: string;
}) {
  // Grow the measure bars from 0 on mount (respects prefers-reduced-motion).
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [grown, setGrown] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const r = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(r);
  }, [reduce]);

  return (
    <div className={`w-full ${compact ? 'space-y-2.5' : 'space-y-3'} ${className ?? ''}`}>
      <BulletRow kind="schedule" label={id ? 'Jadwal · SPI' : 'Schedule · SPI'} value={spi} has={hasSchedule} id={id} compact={compact} grown={grown} />
      <BulletRow kind="cost" label={id ? 'Biaya · CPI' : 'Cost · CPI'} value={cpi} has={hasCost} id={id} compact={compact} grown={grown} />
      {/* Scale legend + the 1.0 target callout. */}
      <div className="relative pt-0.5 text-[9px] font-medium tabular-nums text-slate-400 dark:text-slate-500">
        <span className="absolute left-0">0.5</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${TARGET}%` }}>▲ 1.0</span>
        <span className="absolute right-0">1.5</span>
        <span className="invisible">.</span>
      </div>
    </div>
  );
}
