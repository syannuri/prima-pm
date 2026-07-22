import { type ReactNode, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Evm, EvmTrend, Forecast, GanttNode } from '../api/types';
import { Card, Spinner } from './ui';
import { formatIdr, formatIdrShort } from '../lib/format';
import { formatNum } from '../lib/format';
import { computeMargin } from '../lib/margin';
import HealthGauge from './HealthGauge';
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
        <span className="mt-0.5 text-[9px] font-medium tabular-nums tracking-wide text-slate-400 dark:text-slate-500">{total} {label}</span>
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

// Linear-interpolate a step-series value at time t (plan value "as of now" for the delta).
function valAt(series: { t: number; v: number }[], t: number): number | null {
  if (!series.length) return null;
  if (t <= series[0].t) return series[0].v;
  for (let i = 1; i < series.length; i++) {
    if (t <= series[i].t) {
      const a = series[i - 1], b = series[i];
      return a.v + (b.v - a.v) * ((t - a.t) / ((b.t - a.t) || 1));
    }
  }
  return series[series.length - 1].v;
}

// Compact S-curve: a dashed slate "plan" line + a solid coloured "actual" line with a
// value label on the latest actual point, so the current figure reads without hovering.
// Shorter than before (H 92) to keep the Overview tight.
function MiniSCurve({ planned, actual, actualColor, unitMax, fmt }: {
  planned: { t: number; v: number }[];
  actual: { t: number; v: number }[];
  actualColor: string; // e.g. 'stroke-emerald-500'
  unitMax?: number; // fixed Y max (100 for %)
  fmt: (v: number) => string; // label formatter for the latest-actual callout
}) {
  const pts = [...planned, ...actual];
  if (!pts.length) return null;
  const W = 320, H = 92, padL = 4, padR = 8, padT = 12, padB = 4;
  const t0 = Math.min(...pts.map((p) => p.t)), t1 = Math.max(...pts.map((p) => p.t));
  const maxV = unitMax ?? Math.max(1, ...pts.map((p) => p.v)) * 1.12;
  const X = (t: number) => padL + (t1 > t0 ? (t - t0) / (t1 - t0) : 0) * (W - padL - padR);
  const Y = (v: number) => padT + (1 - Math.min(v, maxV) / maxV) * (H - padT - padB);
  const d = (a: { t: number; v: number }[]) => a.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
  const fillClass = actualColor.replace('stroke-', 'fill-');
  const last = actual[actual.length - 1];
  const lx = last ? X(last.t) : 0, ly = last ? Y(last.v) : 0;
  const labelLeft = lx > W * 0.7; // flip the callout inward near the right edge
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="S-curve plan vs actual">
      {[0, 0.5, 1].map((fr) => <line key={fr} x1={padL} x2={W - padR} y1={Y(maxV * fr)} y2={Y(maxV * fr)} className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="1" />)}
      {planned.length >= 2 && <path d={d(planned)} fill="none" className="stroke-slate-400 dark:stroke-slate-500" strokeWidth="1.5" strokeDasharray="4 3" />}
      {actual.length >= 2 && <path d={d(actual)} fill="none" className={actualColor} strokeWidth="2" />}
      {actual.map((p, i) => <circle key={i} cx={X(p.t)} cy={Y(p.v)} r="2.4" className={fillClass} />)}
      {/* Latest-actual value callout — the one number that matters, on the chart. */}
      {last && (
        <>
          <circle cx={lx} cy={ly} r="3.4" className={fillClass} stroke="#fff" strokeWidth="1.2" />
          <text x={labelLeft ? lx - 6 : lx + 6} y={Math.max(9, ly - 5)} textAnchor={labelLeft ? 'end' : 'start'} className={`${fillClass} text-[10px] font-bold`} style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 2.6 } as React.CSSProperties}>{fmt(last.v)}</text>
        </>
      )}
    </svg>
  );
}

// Informative caption under an S-curve: plan vs actual "as of now" + the signed delta,
// coloured by whether the actual is favourable (progress ahead = good; cost over = bad).
function SCurveCaption({ planLabel, actualLabel, actualSwatch, planNow, actualNow, fmt, higherIsGood }: {
  planLabel: string; actualLabel: string; actualSwatch: string;
  planNow: number | null; actualNow: number | null;
  fmt: (v: number) => string; higherIsGood: boolean;
}) {
  const delta = planNow != null && actualNow != null ? actualNow - planNow : null;
  const good = delta == null ? true : higherIsGood ? delta >= 0 : delta <= 0;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
      <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t-[1.5px] border-dashed border-slate-400 dark:border-slate-500" />{planLabel} {planNow != null ? <b className="font-semibold tabular-nums text-slate-600 dark:text-slate-300">{fmt(planNow)}</b> : null}</span>
      <span className="flex items-center gap-1.5"><span className={`inline-block h-0.5 w-4 rounded ${actualSwatch}`} />{actualLabel} {actualNow != null ? <b className="font-semibold tabular-nums text-slate-600 dark:text-slate-300">{fmt(actualNow)}</b> : null}</span>
      {delta != null && Math.abs(delta) > 0.5 && (
        <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${good ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
          {delta > 0 ? '+' : '−'}{fmt(Math.abs(delta))}
        </span>
      )}
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
  const ragLabel = health === 'NO_DATA' ? (id ? 'Tanpa data' : 'No data') : health.charAt(0) + health.slice(1).toLowerCase();
  const costMax = Math.max(e.bac, e.ac, e.ev, e.pv, 1);
  const overBudget = e.ac > 0 && e.cpi < 1;

  // Projected margin (updated for current performance) + its % of revenue, shown inside the gauge.
  const m = fcQ.data?.margin;
  const marginLine = m && m.revenue > 0
    ? { text: `Margin ${formatIdrShort(m.projected)} · ${((m.projected / m.revenue) * 100).toFixed(0)}%`, warn: m.projected < 0 }
    : null;

  // S-curve series: plan = the schedule-baseline PV backdrop (continuous), actual = captured
  // snapshots. Progress curves are PV/EV as a % of BAC; cost curves are the raw PV/AC money.
  const trend = trendQ.data;
  const bac = e.bac || trend?.bac || 0;
  const planCurve = (trend?.plannedCurve ?? []).map((p) => ({ t: +new Date(p.t), v: p.pv }));
  const snaps = trend?.snapshots ?? [];
  const actCost = snaps.map((s) => ({ t: +new Date(s.statusDate), v: s.ac }));
  const planProg = bac > 0 ? planCurve.map((p) => ({ t: p.t, v: (p.v / bac) * 100 })) : [];
  const actProg = bac > 0 ? snaps.map((s) => ({ t: +new Date(s.statusDate), v: (s.ev / bac) * 100 })) : [];
  const hasCost = planCurve.length >= 2 || actCost.length > 0;
  const hasProg = bac > 0 && (planProg.length >= 2 || actProg.length > 0);
  // Plan vs actual "as of the latest snapshot" — feeds the on-chart callout + delta badge.
  const progNow = actProg[actProg.length - 1]?.v ?? null;
  const progPlanNow = progNow != null ? valAt(planProg, actProg[actProg.length - 1].t) : null;
  const costNow = actCost[actCost.length - 1]?.v ?? null;
  const costPlanNow = costNow != null ? valAt(planCurve, actCost[actCost.length - 1].t) : null;
  const pctFmt = (v: number) => `${Math.round(v)}%`;

  // Plan vs projected margin & profit. Plan = Revenue − BAC (the cost baseline); projected =
  // Revenue − EAC (forecast cost at completion) — the honest "where margin will land". We do NOT
  // use Revenue − AC as a profit (cost-to-date looks inflated mid-project).
  const rev = m?.revenue ?? 0;
  const plan = computeMargin(rev, bac);
  const projected = computeMargin(rev, e.eac);
  const profitTone = (v: number) => (v < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400');

  const tasks = ganttQ.data ? countTasks(ganttQ.data.tree) : null;
  const taskTotal = tasks ? tasks.completed + tasks.remaining : 0;

  return (
    <div className="space-y-3">
      {/* Health gauge — compact on mobile (side-by-side: gauge left, quick KPIs right).
          On sm+ the gauge is centred and larger with progress bar below. */}
      <Panel onClick={onJump ? () => onJump('Cost') : undefined}>
        {/* Mobile: gauge (small, left) + progress bar + SPI/CPI mini tiles (right) */}
        <div className="flex items-start gap-4 sm:hidden">
          <HealthGauge spi={e.spi} cpi={e.cpi} pct={pct} status={health} statusLabel={ragLabel} margin={null} compact className="max-w-[128px] shrink-0" />
          <div className="min-w-0 flex-1 space-y-2.5 pt-1">
            <div>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-300">{id ? 'Progres' : 'Progress'}</span>
                <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{pct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className={`h-full rounded-full ${barColor(health)} transition-[width] duration-700`} style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-1.5 dark:border-slate-800 dark:bg-slate-800/40">
                <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">SPI</div>
                <div className={`text-sm font-bold tabular-nums ${e.pv > 0 && e.spi < 1 ? 'text-red-600 dark:text-red-400' : e.pv > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-100'}`}>
                  {e.pv > 0 ? formatNum(e.spi, 2) : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-1.5 dark:border-slate-800 dark:bg-slate-800/40">
                <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">CPI</div>
                <div className={`text-sm font-bold tabular-nums ${e.ac > 0 && e.cpi < 1 ? 'text-red-600 dark:text-red-400' : e.ac > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-100'}`}>
                  {e.ac > 0 ? formatNum(e.cpi, 2) : '—'}
                </div>
              </div>
            </div>
            {marginLine && (
              <p className={`text-[11px] font-semibold ${marginLine.warn ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{marginLine.text}</p>
            )}
          </div>
        </div>

        {/* Desktop: gauge centred (compact — smaller than the old 250px centrepiece) */}
        <div className="hidden sm:flex sm:flex-col sm:items-center">
          <HealthGauge spi={e.spi} cpi={e.cpi} pct={pct} status={health} statusLabel={ragLabel} margin={marginLine} className="max-w-[200px]" />
        </div>
        <div className="mt-1 hidden sm:block">
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="font-medium text-slate-600 dark:text-slate-300">{id ? 'Progres (selesai)' : 'Progress (complete)'}</span>
            <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{pct}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className={`h-full rounded-full ${barColor(health)} transition-[width] duration-700`} style={{ width: `${pct}%` }} />
          </div>
        </div>

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

      {/* Margin & profit — plan vs actual */}
      {m && m.revenue > 0 && (
        <Panel onClick={onJump ? () => onJump('Forecast') : undefined}>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{id ? 'Margin & Laba — Rencana vs Proyeksi' : 'Margin & profit — plan vs projected'}</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{id ? 'Laba rencana' : 'Plan profit'}</div>
              <div className={`text-sm font-semibold tabular-nums ${profitTone(plan.profit)}`}>{formatIdrShort(plan.profit)}</div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500">{id ? 'Margin' : 'Margin'} {plan.marginPct != null ? `${plan.marginPct.toFixed(1)}%` : '—'}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{id ? 'Laba proyeksi' : 'Projected profit'}</div>
              <div className={`text-sm font-semibold tabular-nums ${profitTone(projected.profit)}`}>{formatIdrShort(projected.profit)}</div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500">{id ? 'Margin' : 'Margin'} {projected.marginPct != null ? `${projected.marginPct.toFixed(1)}%` : '—'}</div>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">{id ? 'Rencana = Pendapatan − BAC · Proyeksi = Pendapatan − EAC (perkiraan biaya saat selesai).' : 'Plan = Revenue − BAC · Projected = Revenue − EAC (forecast cost at completion).'}</p>
        </Panel>
      )}

      {/* Completed vs remaining tasks */}
      {tasks && taskTotal > 0 && (
        <Panel onClick={onJump ? () => onJump('Schedule') : undefined}>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{id ? 'Tugas (WBS)' : 'Tasks (WBS)'}</h3>
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

      {/* S-curve — two views (Progress % / Cost IDR) in one panel with a tab toggle.
          Saves one full card height on mobile vs the old 2-panel layout. */}
      {(hasProg || hasCost || trendQ.isLoading) && (
        <Panel onClick={onJump ? () => onJump('EVM Trend') : undefined}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {sCurveTab === 'progress'
                ? (id ? 'Kurva-S — Progres' : 'S-curve — Progress')
                : (id ? 'Kurva-S — Biaya' : 'S-curve — Cost')}
            </h3>
            {/* Tab toggle — stopPropagation so it doesn't fire the Panel's navigate-to-EVM-Trend click */}
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs dark:bg-slate-800">
              {(['progress', 'cost'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={(e) => { e.stopPropagation(); setSCurveTab(tab); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setSCurveTab(tab); } }}
                  disabled={(tab === 'progress' && !hasProg) || (tab === 'cost' && !hasCost)}
                  className={`rounded-md px-2.5 py-1 font-medium transition disabled:opacity-40 ${
                    sCurveTab === tab
                      ? 'bg-white text-slate-700 shadow dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {tab === 'progress' ? (id ? 'Progres' : 'Progress') : (id ? 'Biaya' : 'Cost')}
                </button>
              ))}
            </div>
          </div>
          {trendQ.isLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : sCurveTab === 'progress' ? (
            hasProg ? (
              <>
                <MiniSCurve planned={planProg} actual={actProg} actualColor="stroke-emerald-500" unitMax={100} fmt={pctFmt} />
                <SCurveCaption planLabel={id ? 'Rencana (PV)' : 'Plan (PV)'} actualLabel={id ? 'Aktual (EV)' : 'Actual (EV)'} actualSwatch="bg-emerald-500"
                  planNow={progPlanNow} actualNow={progNow} fmt={pctFmt} higherIsGood />
              </>
            ) : (
              <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{id ? 'Belum ada baseline/snapshot.' : 'No baseline or snapshots yet.'}</p>
            )
          ) : (
            hasCost ? (
              <>
                <MiniSCurve planned={planCurve} actual={actCost} actualColor="stroke-brand-500" fmt={formatIdrShort} />
                <SCurveCaption planLabel={id ? 'Rencana (PV)' : 'Plan (PV)'} actualLabel={id ? 'Aktual (AC)' : 'Actual (AC)'} actualSwatch="bg-brand-500"
                  planNow={costPlanNow} actualNow={costNow} fmt={formatIdrShort} higherIsGood={false} />
              </>
            ) : (
              <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{id ? 'Belum ada baseline/snapshot.' : 'No baseline or snapshots yet.'}</p>
            )
          )}
        </Panel>
      )}

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
