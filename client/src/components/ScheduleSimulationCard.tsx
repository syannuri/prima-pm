import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ScheduleSimulation } from '../api/types';
import { Card, SectionTitle, Skeleton } from './ui';
import { formatDate } from '../lib/format';

// Schedule-risk Monte-Carlo. Samples each activity's duration (PERT bands around its planned
// duration) and propagates through the dependency network (CPM) each trial → a distribution of
// the project finish, so completion can be committed at a confidence level (P80…) instead of the
// single optimistic plan date. Reads GET /projects/:id/schedule/simulation (seeded → stable).
const CONF = [0.7, 0.8, 0.9, 0.95] as const;

export default function ScheduleSimulationCard({ projectId }: { projectId: string }) {
  const [confidence, setConfidence] = useState<number>(0.8);
  const { data: s, isLoading } = useQuery({
    queryKey: ['schedule-sim', projectId, confidence],
    queryFn: () => api.get<ScheduleSimulation>(`/projects/${projectId}/schedule/simulation?confidence=${confidence}&iterations=5000`),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle sub="Simulated finish-date distribution — commit a completion date at a confidence level, not the single optimistic plan">
          Schedule risk — Monte-Carlo
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
      ) : s.cyclic ? (
        <p className="py-8 text-center text-sm text-red-600 dark:text-red-300">A dependency cycle was detected — resolve it in the Gantt to simulate the schedule.</p>
      ) : s.activityCount === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">Add scheduled tasks to simulate the project finish.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {!s.hasNetwork && (
            <p className="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              No task dependencies — activities are simulated independently (finish = latest task). Link tasks in the Gantt for a true critical-path analysis and a criticality index.
            </p>
          )}

          {/* Headline: finish at the chosen confidence vs the deterministic plan. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-brand-50 dark:bg-brand-900/20 p-3">
              <div className="text-xs text-brand-600 dark:text-brand-300">Finish at P{Math.round(confidence * 100)}</div>
              <div className="text-lg font-bold text-brand-700 dark:text-brand-200">{formatDate(s.recommendedFinish)}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{Math.round(confidence * 100)}% confident to finish by this date · {Math.round(s.recommendedDays)}d</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Plan finish (deterministic)</div>
              <div className="text-lg font-bold text-slate-700 dark:text-slate-200">{formatDate(s.deterministicFinish)}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{Math.round(s.deterministicDays)}d · only {Math.round(s.probabilityOnOrBeforePlan * 100)}% chance of hitting it</div>
            </div>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3">
              <div className="text-xs text-amber-600 dark:text-amber-300">Buffer over plan</div>
              <div className="text-lg font-bold text-amber-700 dark:text-amber-200">+{Math.max(0, Math.round(s.recommendedDays - s.deterministicDays))}d</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">schedule contingency at P{Math.round(confidence * 100)}</div>
            </div>
          </div>

          <Histogram s={s} confidence={confidence} />

          {/* Percentile ladder — finish dates. */}
          <div className="grid grid-cols-5 gap-2 text-center">
            {([['P10', s.finishDates.p10], ['P50', s.finishDates.p50], ['P80', s.finishDates.p80], ['P90', s.finishDates.p90], ['P95', s.finishDates.p95]] as const).map(([label, v]) => (
              <div key={label} className="rounded-lg border border-slate-100 dark:border-slate-800 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                <div className="text-[11px] font-medium text-slate-700 dark:text-slate-200">{formatDate(v)}</div>
              </div>
            ))}
          </div>

          {/* Criticality index — which tasks most often drive the finish. */}
          {s.criticality.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Criticality index <span className="font-normal text-slate-400">— how often each task is on the critical path</span></div>
              <ul className="space-y-1">
                {s.criticality.slice(0, 8).map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    <span className="w-10 shrink-0 font-mono text-[11px] text-slate-400">{c.wbsCode}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{c.name}</span>
                    <div className="hidden h-2 w-28 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 sm:block">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round(c.index * 100)}%` }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300">{Math.round(c.index * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-slate-400">
            {s.activityCount} activities · {s.iterations.toLocaleString()} trials · {s.distribution.toUpperCase()} bands
            −{Math.round(s.optimisticPct * 100)}% / +{Math.round(s.pessimisticPct * 100)}% around each planned duration.
          </p>
        </div>
      )}
    </Card>
  );
}

// SVG histogram of the finish-day distribution with plan + recommended markers.
function Histogram({ s, confidence }: { s: ScheduleSimulation; confidence: number }) {
  const W = 520, H = 170, padL = 8, padR = 8, padB = 24, padT = 10;
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
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Finish-date distribution histogram">
      {bins.map((b, i) => {
        const h = (b.count / maxCount) * plotH;
        const late = b.from >= s.recommendedDays;
        return (
          <rect key={i} x={padL + i * barW + 0.5} y={padT + plotH - h} width={Math.max(0.5, barW - 1)} height={h}
            className={late ? 'fill-amber-400/70' : 'fill-brand-400/70'}>
            <title>{`${Math.round(b.from)}–${Math.round(b.to)}d: ${b.count} trials`}</title>
          </rect>
        );
      })}
      <Marker x={xAt(s.deterministicDays)} plotH={plotH} padT={padT} color="#64748b" label={`Plan ${Math.round(s.deterministicDays)}d`} anchor="start" />
      <Marker x={xAt(s.recommendedDays)} plotH={plotH} padT={padT} color="#d97706" label={`P${Math.round(confidence * 100)} ${Math.round(s.recommendedDays)}d`} anchor="end" />
      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="#cbd5e1" strokeWidth="1" />
      <text x={padL} y={H - 8} fontSize="9" fill="#94a3b8">{Math.round(lo)}d</text>
      <text x={W - padR} y={H - 8} fontSize="9" fill="#94a3b8" textAnchor="end">{Math.round(hi)}d</text>
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
