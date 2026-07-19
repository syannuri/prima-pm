import { type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Evm, EvmTrend, Forecast, GanttNode } from '../api/types';
import { Card, Spinner } from './ui';
import { formatIdr, formatIdrShort } from '../lib/format';
import { formatNum } from '../lib/format';
import HealthGauge from './HealthGauge';
import EvmTrendChart from './EvmTrendChart';
import { useLang } from '../context/LanguageContext';

// Graphic-first, mobile-friendly project summary — the default landing on phones.
// Reuses the existing SVG charts (HealthGauge speedometer + EvmTrendChart S-curve) and
// adds a single physical-% progress bar, an EV/AC/BAC cost-bar comparison, and
// colour-coded metric tiles, so a PM sees where the project stands at a glance.

type Health = 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA';

// Health → progress-bar fill (single source of truth for the one progress bar).
const barColor = (h: Health) =>
  h === 'RED' ? 'bg-red-500' : h === 'AMBER' ? 'bg-amber-500' : h === 'GREEN' ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-500';

// Count leaf work-packages as completed (100%) vs remaining, walking the WBS/Gantt tree.
function countTasks(nodes: GanttNode[]): { completed: number; remaining: number } {
  let completed = 0, remaining = 0;
  const walk = (n: GanttNode) => {
    if (!n.children || n.children.length === 0) {
      if ((n.progressPct ?? 0) >= 100) completed++; else remaining++;
    } else n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return { completed, remaining };
}

// Donut of completed (emerald) vs remaining (slate), total in the centre.
function TaskDonut({ completed, remaining }: { completed: number; remaining: number }) {
  const total = completed + remaining;
  const R = 34, C = 2 * Math.PI * R;
  const frac = total > 0 ? completed / total : 0;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <circle cx="40" cy="40" r={R} fill="none" strokeWidth="8" className="stroke-slate-200 dark:stroke-slate-700" />
        <circle cx="40" cy="40" r={R} fill="none" strokeWidth="8" strokeLinecap="round" className="stroke-emerald-500 transition-[stroke-dasharray] duration-700" strokeDasharray={`${frac * C} ${C}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold tabular-nums leading-none text-slate-800 dark:text-slate-100">{total}</span>
        <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">task</span>
      </div>
    </div>
  );
}

// One labelled horizontal bar scaled against a shared maximum (so EV/AC/PV are comparable).
function Bar({ label, value, max, color, sub }: { label: string; value: number; max: number; color: string; sub?: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between text-xs">
        <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
        <span className="tabular-nums text-slate-500 dark:text-slate-400">{formatIdrShort(value)}{sub && <span className="ml-1 text-[10px] text-slate-400">{sub}</span>}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full ${color} transition-[width] duration-700`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

// Card that becomes a tappable drill-down when `onClick` is set (Card itself takes no onClick).
function Panel({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  if (!onClick) return <Card>{children}</Card>;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick(); } }}
      className="cursor-pointer"
    >
      <Card className="transition hover:border-brand-300 dark:hover:border-brand-700">{children}</Card>
    </div>
  );
}

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: 'good' | 'warn'; hint?: string }) {
  const c = tone === 'warn' ? 'text-red-600 dark:text-red-400' : tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-100';
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40" title={hint}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${c}`}>{value}</div>
    </div>
  );
}

export default function ProjectOverview({ projectId, onJump }: { projectId: string; onJump?: (tab: string) => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const evmQ = useQuery({
    queryKey: ['evm', `/projects/${projectId}`, '', 'overview'],
    queryFn: () => api.get<Evm>(`/projects/${projectId}/evm`),
  });
  const trendQ = useQuery({
    queryKey: ['evm-trend', projectId, 'overview'],
    queryFn: () => api.get<EvmTrend>(`/projects/${projectId}/evm/trend`),
  });
  // Forecast carries the projected margin (revenue − likely EAC) — the "live" margin.
  const fcQ = useQuery({
    queryKey: ['forecast', projectId, 'overview'],
    queryFn: () => api.get<Forecast>(`/projects/${projectId}/forecast`),
  });
  // WBS/Gantt tree → completed-vs-remaining task counts for the task donut.
  const ganttQ = useQuery({
    queryKey: ['gantt', projectId, 'overview'],
    queryFn: () => api.get<{ tree: GanttNode[] }>(`/projects/${projectId}/schedule/gantt`),
  });

  if (evmQ.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  const e = evmQ.data;
  if (!e) return <Card><p className="py-6 text-center text-slate-500 dark:text-slate-400">{id ? 'Data EVM belum tersedia.' : 'No EVM data yet.'}</p></Card>;

  const health = (e.health ?? 'NO_DATA') as Health;
  const pct = Math.round((e.scheduleProgress ?? 0) * 100);
  const ragLabel = health === 'NO_DATA' ? (id ? 'Tanpa data' : 'No data') : health.charAt(0) + health.slice(1).toLowerCase();
  const costMax = Math.max(e.bac, e.ac, e.ev, e.pv, 1);
  const overBudget = e.ac > 0 && e.cpi < 1;

  // Projected margin (updated for current performance) + its % of revenue, shown inside the gauge.
  const m = fcQ.data?.margin;
  const marginLine = m && m.revenue > 0
    ? { text: `Margin ${formatIdrShort(m.projected)} · ${((m.projected / m.revenue) * 100).toFixed(0)}%`, warn: m.projected < 0 }
    : null;

  const tasks = ganttQ.data ? countTasks(ganttQ.data.tree) : null;
  const taskTotal = tasks ? tasks.completed + tasks.remaining : 0;

  return (
    <div className="space-y-4">
      {/* Health gauge + a SINGLE physical-% progress bar + the EVM cost bars, stacked in one
          card (the gauge shows SPI/CPI; the lone bar shows % complete; cost bars sit under it). */}
      <Panel onClick={onJump ? () => onJump('Cost') : undefined}>
        <div className="flex flex-col items-center">
          <HealthGauge spi={e.spi} cpi={e.cpi} pct={pct} status={health} statusLabel={ragLabel} margin={marginLine} />
        </div>

        {/* the one and only progress bar — physical % complete (scheduleProgress) */}
        <div className="mt-1">
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="font-medium text-slate-600 dark:text-slate-300">{id ? 'Progres (selesai)' : 'Progress (complete)'}</span>
            <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{pct}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className={`h-full rounded-full ${barColor(health)} transition-[width] duration-700`} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* EVM cost bars stacked under the gauge */}
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{id ? 'Biaya (EVM)' : 'Cost (EVM)'}</h3>
            <span className={`text-xs font-medium ${overBudget ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              CPI {e.ac > 0 ? formatNum(e.cpi, 2) : '—'}
            </span>
          </div>
          <div className="space-y-2.5">
            <Bar label={id ? 'Anggaran (BAC)' : 'Budget (BAC)'} value={e.bac} max={costMax} color="bg-slate-400 dark:bg-slate-500" />
            <Bar label={id ? 'Nilai diperoleh (EV)' : 'Earned (EV)'} value={e.ev} max={costMax} color="bg-emerald-500" />
            <Bar label={id ? 'Biaya aktual (AC)' : 'Actual (AC)'} value={e.ac} max={costMax} color={overBudget ? 'bg-red-500' : 'bg-brand-500'} />
          </div>
        </div>
      </Panel>

      {/* Completed vs remaining tasks */}
      {tasks && taskTotal > 0 && (
        <Panel onClick={onJump ? () => onJump('Schedule') : undefined}>
          <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{id ? 'Tugas (WBS)' : 'Tasks (WBS)'}</h3>
          <div className="flex items-center gap-5">
            <TaskDonut completed={tasks.completed} remaining={tasks.remaining} />
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                <span className="text-slate-600 dark:text-slate-300">{id ? 'Selesai' : 'Completed'}</span>
                <span className="ml-auto font-semibold tabular-nums text-slate-800 dark:text-slate-100">{tasks.completed}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
                <span className="text-slate-600 dark:text-slate-300">{id ? 'Tersisa' : 'Remaining'}</span>
                <span className="ml-auto font-semibold tabular-nums text-slate-800 dark:text-slate-100">{tasks.remaining}</span>
              </div>
              <div className="flex items-center gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">{id ? 'Total' : 'Total'}</span>
                <span className="ml-auto font-semibold tabular-nums text-slate-700 dark:text-slate-200">{taskTotal}</span>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* S-curve trend (PV / EV / AC over time) */}
      <Panel onClick={onJump ? () => onJump('EVM Trend') : undefined}>
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{id ? 'Kurva-S (PV · EV · AC)' : 'S-curve (PV · EV · AC)'}</h3>
        {trendQ.isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : trendQ.data ? (
          <EvmTrendChart data={trendQ.data} />
        ) : (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{id ? 'Belum ada baseline/snapshot.' : 'No baseline or snapshots yet.'}</p>
        )}
      </Panel>

      {/* Key figures */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label="EAC" value={formatIdrShort(e.eac)} tone={e.eac > e.bac ? 'warn' : undefined} hint={`Estimate at Completion — ${formatIdr(e.eac)}`} />
        <Tile label="VAC" value={formatIdrShort(e.vac)} tone={e.vac < 0 ? 'warn' : 'good'} hint={`Variance at Completion = BAC − EAC — ${formatIdr(e.vac)}`} />
        <Tile label="CV" value={formatIdrShort(e.cv)} tone={e.cv < 0 ? 'warn' : 'good'} hint={`Cost Variance = EV − AC — ${formatIdr(e.cv)}`} />
        <Tile label="SV" value={formatIdrShort(e.sv)} tone={e.sv < 0 ? 'warn' : 'good'} hint={`Schedule Variance = EV − PV — ${formatIdr(e.sv)}`} />
        <Tile label="SPI" value={e.pv > 0 ? formatNum(e.spi, 2) : '—'} tone={e.pv > 0 ? (e.spi < 1 ? 'warn' : 'good') : undefined} hint="Schedule Performance Index" />
        <Tile
          label={id ? 'Selisih selesai' : 'Finish var.'}
          value={e.finishVarianceDays == null ? '—' : `${e.finishVarianceDays > 0 ? '+' : ''}${e.finishVarianceDays}d`}
          tone={e.finishVarianceDays == null ? undefined : e.finishVarianceDays > 0 ? 'warn' : 'good'}
          hint={id ? 'Selisih tanggal selesai vs baseline (hari)' : 'Finish date variance vs baseline (days)'}
        />
      </div>
    </div>
  );
}
