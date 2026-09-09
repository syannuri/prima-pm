import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { RiskSimulation } from '../api/types';
import { Card, SectionTitle, Skeleton } from './ui';
import { formatIdr, formatIdrShort } from '../lib/format';

// Quantitative risk — Monte-Carlo. Turns the register's probability × impact into a *distribution*
// of total exposure so the reserve can be set at a confidence level (P80…) rather than a single
// expected value. Reads GET /projects/:id/risk/simulation (seeded server-side → stable results).
const CONF = [0.7, 0.8, 0.9, 0.95] as const;

export default function RiskSimulationCard({ projectId }: { projectId: string }) {
  const [confidence, setConfidence] = useState<number>(0.8);
  const { data: s, isLoading } = useQuery({
    queryKey: ['risk-sim', projectId, confidence],
    queryFn: () => api.get<RiskSimulation>(`/projects/${projectId}/risk/simulation?confidence=${confidence}&iterations=10000`),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle sub="Simulated exposure distribution — set the reserve at a confidence level, not just the average">
          Quantitative risk — Monte-Carlo
        </SectionTitle>
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5 text-xs">
          {CONF.map((c) => (
            <button
              key={c}
              onClick={() => setConfidence(c)}
              className={`rounded-md px-2.5 py-1 font-medium ${confidence === c ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
            >
              P{Math.round(c * 100)}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !s ? (
        <Skeleton className="mt-3 h-56 w-full" />
      ) : s.riskCount === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">
          Add risks with a probability &amp; cost impact (kept in the reserve) to simulate total exposure.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {/* Headline: reserve at the chosen confidence, vs the expected value. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-brand-50 dark:bg-brand-900/20 p-3">
              <div className="text-xs text-brand-600 dark:text-brand-300">Reserve at P{Math.round(confidence * 100)}</div>
              <div className="text-xl font-bold text-brand-700 dark:text-brand-200">{formatIdr(s.recommendedReserve)}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {Math.round(confidence * 100)}% confident exposure stays at or below this
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Expected (EMV)</div>
              <div className="text-xl font-bold text-slate-700 dark:text-slate-200">{formatIdr(s.mean)}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">average across {s.iterations.toLocaleString()} trials</div>
            </div>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3">
              <div className="text-xs text-amber-600 dark:text-amber-300">Buffer over expected</div>
              <div className="text-xl font-bold text-amber-700 dark:text-amber-200">{formatIdr(Math.max(0, s.recommendedReserve - s.mean))}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">the price of the tail risk</div>
            </div>
          </div>

          <Histogram s={s} confidence={confidence} />

          {/* Percentile ladder */}
          <div className="grid grid-cols-5 gap-2 text-center">
            {([['P10', s.percentiles.p10], ['P50', s.percentiles.p50], ['P80', s.percentiles.p80], ['P90', s.percentiles.p90], ['P95', s.percentiles.p95]] as const).map(([label, v]) => (
              <div key={label} className="rounded-lg border border-slate-100 dark:border-slate-800 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{formatIdrShort(v)}</div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-slate-400">
            {s.riskCount} risk{s.riskCount === 1 ? '' : 's'} simulated · {s.iterations.toLocaleString()} trials ·
            {' '}{Math.round(s.probabilityOfZero * 100)}% chance no risk hits (zero exposure). Point-impact model over the register.
          </p>
        </div>
      )}
    </Card>
  );
}

// SVG histogram of the exposure distribution, with markers for the mean and the chosen reserve.
function Histogram({ s, confidence }: { s: RiskSimulation; confidence: number }) {
  const W = 520, H = 180, padL = 8, padR = 8, padB = 26, padT = 10;
  const bins = s.histogram;
  if (bins.length === 0) return null;
  const lo = bins[0].from;
  const hi = bins[bins.length - 1].to;
  const span = hi - lo || 1;
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const plotW = W - padL - padR;
  const plotH = H - padB - padT;
  const xAt = (v: number) => padL + ((v - lo) / span) * plotW;
  const barW = plotW / bins.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Exposure distribution histogram">
      {bins.map((b, i) => {
        const h = (b.count / maxCount) * plotH;
        const overReserve = b.from >= s.recommendedReserve;
        return (
          <rect
            key={i}
            x={padL + i * barW + 0.5}
            y={padT + plotH - h}
            width={Math.max(0.5, barW - 1)}
            height={h}
            className={overReserve ? 'fill-amber-400/70' : 'fill-brand-400/70'}
          >
            <title>{`${formatIdrShort(b.from)}–${formatIdrShort(b.to)}: ${b.count} trials`}</title>
          </rect>
        );
      })}
      {/* mean + reserve markers */}
      <Marker x={xAt(s.mean)} plotH={plotH} padT={padT} color="#64748b" label={`EMV ${formatIdrShort(s.mean)}`} anchor="start" />
      <Marker x={xAt(s.recommendedReserve)} plotH={plotH} padT={padT} color="#d97706" label={`P${Math.round(confidence * 100)} ${formatIdrShort(s.recommendedReserve)}`} anchor="end" />
      {/* baseline + axis endpoints */}
      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="#cbd5e1" strokeWidth="1" />
      <text x={padL} y={H - 8} fontSize="9" fill="#94a3b8">{formatIdrShort(lo)}</text>
      <text x={W - padR} y={H - 8} fontSize="9" fill="#94a3b8" textAnchor="end">{formatIdrShort(hi)}</text>
    </svg>
  );
}

function Marker({ x, plotH, padT, color, label, anchor }: { x: number; plotH: number; padT: number; color: string; label: string; anchor: 'start' | 'end' }) {
  return (
    <g>
      <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke={color} strokeWidth="1.5" strokeDasharray="3 2" />
      <text x={anchor === 'end' ? x - 3 : x + 3} y={padT + 9} fontSize="9" fill={color} textAnchor={anchor} fontWeight="600">{label}</text>
    </g>
  );
}
