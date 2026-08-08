import type { PortfolioHealth } from '../api/types';
import { RAG } from '../lib/rag';

// Colourblind-safe status indicator: the RAG COLOUR plus a distinct SHAPE per state
// (● on track · ◆ at risk · ▲ behind · ◌ no data), so status is legible without relying on
// hue alone. Drop-in replacement for the bare coloured status dots across the app.
export default function RagGlyph({ status, size = 10, className = '' }: { status: PortfolioHealth; size?: number; className?: string }) {
  const { solid, shape, label } = RAG[status] ?? RAG.NO_DATA;
  const s = size, c = s / 2;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className={`inline-block shrink-0 ${className}`} role="img" aria-label={label}>
      {shape === 'circle' && <circle cx={c} cy={c} r={c - 0.5} fill={solid} />}
      {shape === 'diamond' && <path d={`M${c} 0.6 L${s - 0.6} ${c} L${c} ${s - 0.6} L0.6 ${c} Z`} fill={solid} />}
      {shape === 'triangle' && <path d={`M${c} 1 L${s - 0.6} ${s - 1} L0.6 ${s - 1} Z`} fill={solid} />}
      {shape === 'ring' && <circle cx={c} cy={c} r={c - 1.4} fill="none" stroke={solid} strokeWidth="1.5" />}
    </svg>
  );
}
