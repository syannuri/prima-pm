import { type ReactNode, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Evm, EvmTrend, Forecast, GanttNode } from '../api/types';
import { Card, Spinner } from './ui';
import { formatIdr, formatIdrShort } from '../lib/format';
import { formatNum } from '../lib/format';
import { computeMargin } from '../lib/margin';
import HealthBulletGauge from './HealthBulletGauge';
import EvmTrendChart from './EvmTrendChart';
import ExtractFromNotes from './ExtractFromNotes';
import InfoTip from './InfoTip';
import { useLang } from '../context/LanguageContext';

// Graphic-first, mobile-friendly project summary — the default landing on phones.
// Reuses the existing SVG charts (HealthBulletGauge SPI/CPI + EvmTrendChart S-curve) and
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

const DAY = 86_400_000;
// The "Upcoming deadlines" agenda: leaf tasks/milestones (not complete) that are due within the next
// window OR already overdue — the deadlines a PM must not miss. Mirrors the server DUE_SOON_TASK rule
// (whole-day floor). `daysLate` > 0 = overdue; ≤ 0 = due in −daysLate days. Sorted most-urgent first.
interface Upcoming { id: string; name: string; isMilestone: boolean; owner: string | null; daysLate: number }
function collectUpcoming(nodes: GanttNode[], now: number, windowDays = 7): Upcoming[] {
  const today = Math.floor(now / DAY);
  const out: Upcoming[] = [];
  const walk = (n: GanttNode) => {
    if (n.children && n.children.length) { n.children.forEach(walk); return; }
    if ((n.progressPct ?? 0) >= 100 || !n.planEnd) return;
    const daysLate = today - Math.floor(new Date(n.planEnd).getTime() / DAY);
    if (daysLate < -windowDays) return; // due further out than the window
    out.push({ id: n.id, name: n.name, isMilestone: n.isMilestone, owner: n.picResource?.name ?? n.owners?.[0]?.name ?? null, daysLate });
  };
  nodes.forEach(walk);
  return out.sort((a, b) => b.daysLate - a.daysLate);
}
// A due-status chip (text + tone) for one upcoming row.
function dueChip(daysLate: number, id: boolean): { text: string; tone: string } {
  if (daysLate >= 1) return { text: id ? `${daysLate}h lewat` : `${daysLate}d overdue`, tone: 'text-red-600 dark:text-red-400' };
  const du = -daysLate;
  if (du === 0) return { text: id ? 'hari ini' : 'due today', tone: 'text-amber-600 dark:text-amber-400' };
  if (du === 1) return { text: id ? 'besok' : 'tomorrow', tone: 'text-amber-600 dark:text-amber-400' };
  return { text: id ? `${du} hari lagi` : `in ${du}d`, tone: 'text-slate-500 dark:text-slate-400' };
}
const dueDot = (daysLate: number) => (daysLate >= 1 ? 'bg-red-500' : daysLate >= -1 ? 'bg-amber-400' : 'bg-slate-300 dark:bg-slate-600');

// Compact donut of completed (emerald) vs remaining (slate). Centre reads the % complete
// (the donut's meaning) with the task total as a small sub-label.
function TaskDonut({ completed, remaining, label }: { completed: number; remaining: number; label: string }) {
  const total = completed + remaining;
  const R = 34, C = 2 * Math.PI * R;
  const frac = total > 0 ? completed / total : 0;
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
        <circle cx="40" cy="40" r={R} fill="none" strokeWidth="7" className="stroke-slate-200 dark:stroke-slate-700" />
        <circle cx="40" cy="40" r={R} fill="none" strokeWidth="7" strokeLinecap="round" className="stroke-emerald-500 transition-[stroke-dasharray] duration-700" strokeDasharray={`${frac * C} ${C}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold tabular-nums leading-none text-slate-800 dark:text-slate-100">{Math.round(frac * 100)}%</span>
        <span className="mt-0.5 text-[9px] font-medium tabular-nums tracking-wide text-slate-500 dark:text-slate-400">{total} {label}</span>
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
// `className` lands on the outer grid-item element so the caller can place it in the bento grid;
// with onClick the inner Card gets `h-full` so it fills a stretched grid cell (no click dead-zone).
function Panel({ onClick, className, children }: { onClick?: () => void; className?: string; children: ReactNode }) {
  if (!onClick) return <Card className={className}>{children}</Card>;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick(); } }}
      className={`cursor-pointer ${className ?? ''}`}
    >
      <Card className="h-full transition hover:border-brand-300 dark:hover:border-brand-700">{children}</Card>
    </div>
  );
}

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: 'good' | 'warn'; hint?: string }) {
  const c = tone === 'warn' ? 'text-red-600 dark:text-red-400' : tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-100';
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40" title={hint}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
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
  // NOTE: keep every hook ABOVE the early returns below — a hook after a conditional
  // return violates the Rules of Hooks (the count changes once data loads → React throws
  // "rendered more hooks than during the previous render" and the tab goes blank/black).
  const [sCurveTab, setSCurveTab] = useState<'progress' | 'cost'>('progress');

  if (evmQ.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  const e = evmQ.data;
  if (!e) return <Card><p className="py-6 text-center text-slate-500 dark:text-slate-400">{id ? 'Data EVM belum tersedia.' : 'No EVM data yet.'}</p></Card>;

  const health = (e.health ?? 'NO_DATA') as Health;
  const pct = Math.round((e.scheduleProgress ?? 0) * 100);
  // The gauge % and the Tasks donut % answer different questions — spell out the
  // distinction so nobody reads them as the same number (see InfoTip on each).
  const progressTip = id
    ? 'Penyelesaian fisik tertimbang: progres tiap tugas ditimbang oleh biaya/durasinya, dan progres parsial ikut dihitung. Angka EVM resmi.'
    : 'Weighted physical % complete: each task’s progress weighted by its cost/duration, and partial progress counts. The official EVM figure.';
  const taskTip = id
    ? 'Jumlah tugas yang 100% selesai dibagi total tugas — tiap tugas berbobot sama, dan progres parsial (mis. 90%) belum dihitung selesai.'
    : 'Count of 100%-done tasks ÷ total tasks — every task counts equally, and partial progress (e.g. 90%) is not yet counted as done.';
  const costMax = Math.max(e.bac, e.ac, e.ev, e.pv, 1);
  const overBudget = e.ac > 0 && e.cpi < 1;

  // Projected margin (updated for current performance) + its % of revenue, shown inside the gauge.
  const m = fcQ.data?.margin;
  const marginLine = m && m.revenue > 0
    ? { text: `Margin ${formatIdrShort(m.projected)} · ${((m.projected / m.revenue) * 100).toFixed(0)}%`, warn: m.projected < 0 }
    : null;

  // S-curve: the full EVM trend chart (PV/EV/AC + forecast + markers + hover), shared with the
  // EVM Trend tab. The tab toggle drives the value unit (physical % of BAC vs money/IDR).
  const trend = trendQ.data;
  const bac = e.bac || trend?.bac || 0;
  const hasTrend = !!trend && (trend.plannedCurve.length >= 2 || trend.snapshots.length > 0);
  const hasCost = hasTrend;
  const hasProg = hasTrend && bac > 0;

  // Plan vs projected margin & profit. Plan = Revenue − BAC (the cost baseline); projected =
  // Revenue − EAC (forecast cost at completion) — the honest "where margin will land". We do NOT
  // use Revenue − AC as a profit (cost-to-date looks inflated mid-project).
  const rev = m?.revenue ?? 0;
  const plan = computeMargin(rev, bac);
  const projected = computeMargin(rev, e.eac);
  const profitTone = (v: number) => (v < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400');

  const tasks = ganttQ.data ? countTasks(ganttQ.data.tree) : null;
  const taskTotal = tasks ? tasks.completed + tasks.remaining : 0;
  const upcoming = ganttQ.data ? collectUpcoming(ganttQ.data.tree, Date.now()) : [];

  // The three secondary cards share the 8-col region beside the gauge hero's lower half.
  // Grouping them in one flex band makes them tile evenly (1, 2 or 3 present) — no lone-card gap.
  const hasMargin = !!(m && m.revenue > 0);
  const hasTasks = !!(tasks && taskTotal > 0);
  const hasUpcoming = upcoming.length > 0;
  const hasSecondary = hasMargin || hasTasks || hasUpcoming;

  return (
    // Mobile/tablet: a single stacked column (unchanged). Desktop (lg+): a 12-col bento so the
    // charts sit tight side-by-side instead of a narrow centred column with big vertical gaps —
    // gauge is the hero (left, 2 rows tall), S-curve leads the right, Margin + Tasks pair below it,
    // key figures run full-width along the bottom. `lg:order-*` sets the desktop visual order while
    // the DOM order stays mobile-friendly (order is ignored in the mobile block-flow layout).
    <div className="space-y-3 lg:grid lg:grid-cols-12 lg:gap-3 lg:space-y-0">
      {/* Stage A — extract task-progress + issues from pasted notes (renders nothing when AI is off). */}
      <div className="lg:col-span-12 lg:order-first"><ExtractFromNotes projectId={projectId} /></div>
      {/* Performance — Schedule (SPI) & Cost (CPI) bullet gauges vs the 1.0 target, then progress. */}
      <Panel onClick={onJump ? () => onJump('Cost') : undefined} className="lg:col-span-4 lg:order-1">
        <HealthBulletGauge spi={e.spi} cpi={e.cpi} hasSchedule={e.pv > 0} hasCost={e.ac > 0} id={id} />

        {/* Weighted % complete (the official EVM progress). */}
        <div className="mt-3.5">
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="font-medium text-slate-600 dark:text-slate-300">{id ? 'Progres (selesai)' : 'Progress (complete)'}<InfoTip text={progressTip} /></span>
            <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{pct}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className={`h-full rounded-full ${barColor(health)} transition-[width] duration-700`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        {marginLine && (
          <p className={`mt-2 text-xs font-semibold ${marginLine.warn ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{marginLine.text}</p>
        )}

        {/* EVM cost bars — always shown */}
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
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

      {/* Secondary band — Margin · Tasks · Upcoming deadlines. One flex row (col-span-8) that sits
          beside the gauge hero's lower half and tiles its cards evenly however many are present, so
          a single card never spills onto its own row leaving an empty gap. */}
      {hasSecondary && (
      <div className="space-y-3 lg:col-span-12 lg:order-3 lg:flex lg:items-stretch lg:gap-3 lg:space-y-0">
      {/* Margin & profit — plan vs actual */}
      {hasMargin && (
        <Panel onClick={onJump ? () => onJump('Forecast') : undefined} className="lg:min-w-0 lg:flex-1">
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{id ? 'Margin & Laba — Rencana vs Proyeksi' : 'Margin & profit — plan vs projected'}</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{id ? 'Laba rencana' : 'Plan profit'}</div>
              <div className={`text-sm font-semibold tabular-nums ${profitTone(plan.profit)}`}>{formatIdrShort(plan.profit)}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{id ? 'Margin' : 'Margin'} {plan.marginPct != null ? `${plan.marginPct.toFixed(1)}%` : '—'}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{id ? 'Laba proyeksi' : 'Projected profit'}</div>
              <div className={`text-sm font-semibold tabular-nums ${profitTone(projected.profit)}`}>{formatIdrShort(projected.profit)}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{id ? 'Margin' : 'Margin'} {projected.marginPct != null ? `${projected.marginPct.toFixed(1)}%` : '—'}</div>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">{id ? 'Rencana = Pendapatan − BAC · Proyeksi = Pendapatan − EAC (perkiraan biaya saat selesai).' : 'Plan = Revenue − BAC · Projected = Revenue − EAC (forecast cost at completion).'}</p>
        </Panel>
      )}

      {/* Completed vs remaining tasks */}
      {hasTasks && (
        <Panel onClick={onJump ? () => onJump('Schedule') : undefined} className="lg:min-w-0 lg:flex-1">
          <h3 className="mb-2 flex items-center text-sm font-semibold text-slate-700 dark:text-slate-200">{id ? 'Tugas (WBS)' : 'Tasks (WBS)'}<InfoTip text={taskTip} /></h3>
          <div className="flex items-center gap-4">
            <TaskDonut completed={tasks.completed} remaining={tasks.remaining} label={id ? 'tugas' : 'tasks'} />
            <div className="min-w-0 flex-1 space-y-1.5 text-sm">
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
            </div>
          </div>
        </Panel>
      )}

      {/* Upcoming deadlines — leaf tasks/milestones due within 7 days or overdue, so a PM catches
          them before they slip. Derived from the already-loaded WBS tree (no extra request). */}
      {hasUpcoming && (
        <Panel onClick={onJump ? () => onJump('Schedule') : undefined} className="lg:min-w-0 lg:flex-1">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{id ? 'Tenggat terdekat' : 'Upcoming deadlines'}</h3>
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{id ? '7 hari' : 'next 7 days'}</span>
          </div>
          <ul className="space-y-1.5">
            {upcoming.slice(0, 6).map((u) => {
              const chip = dueChip(u.daysLate, id);
              return (
                <li key={u.id} className="flex items-center gap-2 text-sm">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dueDot(u.daysLate)}`} />
                  <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                    {u.isMilestone && <span className="mr-1" aria-hidden="true">🔷</span>}
                    {u.name}
                    {u.owner && <span className="ml-1.5 text-xs text-slate-400">· {u.owner}</span>}
                  </span>
                  <span className={`shrink-0 whitespace-nowrap text-xs font-medium tabular-nums ${chip.tone}`}>{chip.text}</span>
                </li>
              );
            })}
          </ul>
          {upcoming.length > 6 && (
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">+ {upcoming.length - 6} {id ? 'lagi' : 'more'}</p>
          )}
        </Panel>
      )}
      </div>
      )}

      {/* S-curve — the full interactive EVM trend chart (shared with the EVM Trend tab): PV/EV/AC +
          forecast + today/finish markers + variance shading + hover/zoom. The toggle switches the
          value unit (physical % vs money). Not a click-to-navigate Panel (that would fight the
          chart's drag-to-zoom) — an explicit "EVM Trend →" link handles the jump. */}
      {(hasTrend || trendQ.isLoading) && (
        <Panel className="lg:col-span-8 lg:order-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {sCurveTab === 'progress' ? (id ? 'Kurva-S — Progres' : 'S-curve — Progress') : (id ? 'Kurva-S — Biaya' : 'S-curve — Cost')}
            </h3>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs dark:bg-slate-800">
                {(['progress', 'cost'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setSCurveTab(tab)}
                    disabled={(tab === 'progress' && !hasProg) || (tab === 'cost' && !hasCost)}
                    className={`rounded-md px-2.5 py-1 font-medium transition disabled:opacity-40 ${
                      sCurveTab === tab ? 'bg-white text-slate-700 shadow dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {tab === 'progress' ? (id ? 'Progres' : 'Progress') : (id ? 'Biaya' : 'Cost')}
                  </button>
                ))}
              </div>
              {onJump && (
                <button onClick={() => onJump('EVM Trend')} className="whitespace-nowrap text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                  {id ? 'EVM Trend →' : 'EVM Trend →'}
                </button>
              )}
            </div>
          </div>
          {trendQ.isLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : hasTrend && trend ? (
            <EvmTrendChart data={trend} forecast={fcQ.data} mode={sCurveTab === 'progress' ? 'progress' : 'money'} bare compact title={null} />
          ) : (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{id ? 'Belum ada baseline/snapshot.' : 'No baseline or snapshots yet.'}</p>
          )}
        </Panel>
      )}

      {/* Key figures — full-width footer strip on the bento (6 tiles in one row on lg+) */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:col-span-12 lg:order-5 lg:grid-cols-6">
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
