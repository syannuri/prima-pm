import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PortfolioSummary as Summary, PortfolioHealth } from '../api/types';
import HealthGauge from './HealthGauge';
import { Badge, Card, Skeleton } from './ui';
import { formatDateInput, formatIdr, formatIdrShort, formatNum } from '../lib/format';
import { computeMargin, likelyEac } from '../lib/margin';
import { PROJECT_STATUS_BADGE } from '../lib/labels';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { useBookmarks } from '../hooks/useBookmarks';
import PieChart, { type Slice } from './PieChart';
import ProgressChart from './ProgressChart';
import DonutChart, { type DonutSlice } from './DonutChart';

const PIE = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444', slate: '#94a3b8', coral: '#f4675f' };

// Mono line-icons (feather-style) for the KPI cards — purely for scannability.

const HEALTH_COLOR: Record<string, string> = { GREEN: 'green', AMBER: 'amber', RED: 'red', NO_DATA: 'slate' };
// Human-friendly labels instead of the raw enum (GREEN/NO_DATA/…).
const HEALTH_LABEL: Record<string, string> = { GREEN: 'On track', AMBER: 'At risk', RED: 'Behind', NO_DATA: 'No data' };
const NODATA_HINT = {
  cost: 'No actual cost recorded yet, so CPI cannot be computed',
  sched: 'Project has not started as of the status date',
};

export default function PortfolioSummary() {
  const { user } = useAuth();
  const showPies = !!user && ['ADMIN', 'PMO'].includes(user.role);
  // PM & Finance get a CPI donut + a per-project progress chart on their dashboard.
  const showPmCharts = !!user && ['PROJECT_MANAGER', 'FINANCE'].includes(user.role);
  // Who can open a project detail: ADMIN/PMO (any) or PM (their list is owned-only).
  // FINANCE sees the portfolio for oversight but can't drill in, so names aren't links.
  const canOpen = !!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER'].includes(user.role);
  const isPM = user?.role === 'PROJECT_MANAGER';
  // Cost & revenue table: ADMIN/PMO (whole portfolio) + PM (their OWN assigned projects —
  // data.projects is already scoped to owned projects by the API for a PM).
  const showFinancials = showPies || isPM;
  const [statusDate, setStatusDate] = useState(formatDateInput(new Date()));
  // Per-project detail tables are tabbed (EVM default) to cut scroll. EVM is always
  // available; Resource load is PMO-only, Cost & revenue is PMO+PM.
  const [tableTab, setTableTab] = useState<'evm' | 'resource' | 'cost'>('evm');
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio', statusDate],
    queryFn: () => api.get<Summary>(`/portfolio/summary?statusDate=${statusDate}`),
  });
  // Rolled-up EVM history for the hero sparkline (shares the key with PortfolioEvmTrend → one fetch).
  const { data: trend } = useQuery({
    queryKey: ['portfolio-evm-trend'],
    queryFn: () => api.get<{ series: { statusDate: string; spi: number; cpi: number }[] }>('/portfolio/evm/trend'),
  });
  const { pinned, toggle: togglePin } = useBookmarks();

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="!p-3 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-28" />
          </Card>
        ))}
      </div>
    );
  }
  if (!data || data.totals.count === 0) return null;
  const t = data.totals;
  // SPI trend for the hero sparkline (drop no-data 0s).
  const spiSeries = (trend?.series ?? []).map((s) => s.spi).filter((v) => v > 0);
  const spiLast = spiSeries.length ? spiSeries[spiSeries.length - 1] : null;
  const spiDelta = spiSeries.length > 1 ? spiSeries[spiSeries.length - 1] - spiSeries[spiSeries.length - 2] : null;
  // Portfolio schedule-health status for the speedometer (same thresholds as the mobile hero).
  const gaugeStatus: PortfolioHealth = t.pv <= 0 ? 'NO_DATA' : t.spi >= 0.95 ? 'GREEN' : t.spi >= 0.85 ? 'AMBER' : 'RED';
  const HEALTH_META: Record<PortfolioHealth, { dot: string; label: string }> = {
    GREEN: { dot: '#22c55e', label: 'On track' }, AMBER: { dot: '#f59e0b', label: 'At risk' },
    RED: { dot: '#ef4444', label: 'Behind' }, NO_DATA: { dot: '#94a3b8', label: 'No data' },
  };

  // Pie 1 — Project Financial Status (by cost health / CPI).
  const finCount = { GREEN: 0, AMBER: 0, RED: 0, NO_DATA: 0 } as Record<string, number>;
  // Pie 2 — Project Status (completed / on progress / delayed).
  let completed = 0, delayed = 0, onProgress = 0;
  for (const p of data.projects) {
    finCount[p.costHealth] = (finCount[p.costHealth] ?? 0) + 1;
    if (p.scheduleProgress >= 1 || p.status === 'CLOSED') completed += 1;
    else if (p.health === 'RED' || (p.finishVarianceDays ?? 0) > 0) delayed += 1;
    else onProgress += 1;
  }
  const financialSlices: Slice[] = [
    { label: 'On budget', value: finCount.GREEN, color: PIE.green },
    { label: 'At risk', value: finCount.AMBER, color: PIE.amber },
    { label: 'Over budget', value: finCount.RED, color: PIE.red },
    { label: 'Not tracked', value: finCount.NO_DATA, color: PIE.slate },
  ];
  const statusSlices: Slice[] = [
    { label: 'Completed', value: completed, color: PIE.green },
    { label: 'On Progress', value: onProgress, color: PIE.amber },
    { label: 'Delay', value: delayed, color: PIE.red },
  ];
  // Pie 3 — Schedule Status (by SPI health), the complement to the CPI pie.
  const scheduleSlices: Slice[] = [
    { label: 'On track', value: data.byHealth.GREEN ?? 0, color: PIE.green },
    { label: 'At risk', value: data.byHealth.AMBER ?? 0, color: PIE.amber },
    { label: 'Behind', value: data.byHealth.RED ?? 0, color: PIE.red },
    { label: 'No data', value: data.byHealth.NO_DATA ?? 0, color: PIE.slate },
  ];

  // PM/Finance donuts (with hover project lists), grouped by cost-health (CPI) and
  // schedule-health (SPI). Scoped to the caller's projects by the API already.
  const groupSlices = (field: 'costHealth' | 'health', labels: Record<string, string>): DonutSlice[] =>
    (['GREEN', 'AMBER', 'RED', 'NO_DATA'] as const).map((key) => {
      const items = data.projects.filter((p) => p[field] === key).map((p) => p.name);
      return { label: labels[key], value: items.length, color: PIE[key === 'GREEN' ? 'green' : key === 'AMBER' ? 'amber' : key === 'RED' ? 'red' : 'slate'], items };
    });
  const cpiSlices = groupSlices('costHealth', { GREEN: 'On budget', AMBER: 'At risk', RED: 'Over budget', NO_DATA: 'Not tracked' });
  const spiSlices = groupSlices('health', { GREEN: 'On track', AMBER: 'At risk', RED: 'Behind', NO_DATA: 'No data' });

  // Changes breakdown (PMO dashboard) — most-changed projects first.
  const changeRows = [...data.projects].sort((a, b) => b.changeCount - a.changeCount);
  const totalChanges = data.projects.reduce((s, p) => s + p.changeCount, 0);
  const maxChanges = Math.max(1, ...data.projects.map((p) => p.changeCount));

  // Resource summary per project (PMO dashboard) — most manpower-heavy first.
  const resourceRows = [...data.projects].sort((a, b) => b.manpowerCost - a.manpowerCost);
  const resTotals = data.projects.reduce(
    (a, p) => ({ resources: a.resources + p.resourceCount, mandays: a.mandays + p.planMandays, cost: a.cost + p.manpowerCost }),
    { resources: 0, mandays: 0, cost: 0 },
  );
  const hasResources = resTotals.resources > 0 || resTotals.cost > 0;

  // Per-project EVM table order: bookmarked first, then active (in-progress), else the API
  // order (stable sort preserves it).
  const evmProjects = [...data.projects].sort((a, b) =>
    (Number(pinned.has(b.id)) - Number(pinned.has(a.id)))
    || (Number(a.status === 'IN_PROGRESS' ? 0 : 1) - Number(b.status === 'IN_PROGRESS' ? 0 : 1)),
  );

  // Cost & revenue per project (PMO dashboard) — highest revenue first.
  const finRows = [...data.projects].sort((a, b) => b.revenue - a.revenue);
  // Plan cost = BAC (the cost-baseline PMB), forecast cost = likely EAC (BAC÷CPI). Profit uses the
  // shared computeMargin helper so the dashboard, Overview, forecast and PDF never diverge.
  const finTotals = data.projects.reduce(
    (a, p) => ({ bac: a.bac + p.bac, actualCost: a.actualCost + p.ac, eac: a.eac + likelyEac(p.bac, p.cpi), revenue: a.revenue + p.revenue }),
    { bac: 0, actualCost: 0, eac: 0, revenue: 0 },
  );
  const finPlan = computeMargin(finTotals.revenue, finTotals.bac); // profit at the cost baseline
  const finProjected = computeMargin(finTotals.revenue, finTotals.eac); // forecast profit at completion (EAC)
  const hasFinancials = finTotals.bac > 0 || finTotals.revenue > 0;

  return (
    <div className="space-y-3">
      {/* Command bar — the gauge (health), the money/scope KPIs (filling what used to be
          empty space) and the status date, consolidated into one tight hero. SPI/CPI/%
          complete/projects live in the gauge + header, so they're not repeated here. */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 p-4 text-white shadow-lg ring-1 ring-white/10 sm:p-5">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full blur-3xl" style={{ backgroundColor: HEALTH_META[gaugeStatus].dot, opacity: 0.18 }} />
        <div className="relative mb-3 flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Portfolio health · <span className="text-white/45">{t.count} projects</span></div>
          <div className="flex flex-col items-end">
            <label className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/40">Status date (EVM)</label>
            <input aria-label="Status date (EVM)" type="date" value={statusDate} onChange={(e) => setStatusDate(e.target.value)} className="w-40 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-sm text-white [color-scheme:dark] focus:border-white/30 focus:outline-none" />
          </div>
        </div>
        <div className="relative flex flex-col items-center gap-5 lg:flex-row lg:items-center lg:gap-8">
          <div className="w-full max-w-[280px] shrink-0">
            <HealthGauge spi={t.spi} cpi={t.cpi} pct={Math.round(t.scheduleProgress * 100)} status={gaugeStatus} statusLabel={HEALTH_META[gaugeStatus].label} />
          </div>
          <div className="w-full flex-1">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {([
                { label: 'Total BAC', value: formatIdrShort(t.bac), title: formatIdr(t.bac) },
                { label: 'Earned Value', value: formatIdrShort(t.ev), title: formatIdr(t.ev) },
                { label: 'Actual Cost', value: formatIdrShort(t.ac), title: formatIdr(t.ac) },
                { label: 'Schedule slip', value: t.baselinedCount === 0 ? '—' : t.slippedCount > 0 ? `${t.slippedCount} late · ${t.worstSlipDays}d` : 'On schedule', warn: t.slippedCount > 0 },
                { label: 'Changes', value: String(totalChanges) },
                { label: 'Contingency', value: formatIdrShort(t.contingencyReserve), title: formatIdr(t.contingencyReserve) },
              ] as Array<{ label: string; value: string; title?: string; warn?: boolean }>).map((s) => (
                <div key={s.label} className="rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/10">
                  <div className="truncate text-[10px] font-medium uppercase tracking-wide text-white/50">{s.label}</div>
                  <div title={s.title} className={`mt-0.5 truncate text-lg font-bold leading-tight tabular-nums ${s.warn ? 'text-red-300' : 'text-white'}`}>{s.value}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(['GREEN', 'AMBER', 'RED', 'NO_DATA'] as PortfolioHealth[]).map((h) => (data.byHealth[h] ?? 0) > 0 && (
                <span key={h} className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs ring-1 ring-white/10">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: HEALTH_META[h].dot }} />
                  <span className="text-white/80">{HEALTH_META[h].label}</span>
                  <span className="font-bold tabular-nums">{data.byHealth[h]}</span>
                </span>
              ))}
              {(data.byHealth.NO_DATA ?? 0) > 0 && <span className="text-[11px] text-white/40">“No data” = not started by this date — pick a later one.</span>}
            </div>
          </div>
        </div>
        {/* SPI trend sparkline — the one thing the static gauge can't show. */}
        {spiSeries.length >= 2 && spiLast !== null && (
          <div className="relative mt-4 flex items-center gap-4 rounded-xl bg-white/5 px-4 py-2.5 ring-1 ring-white/10">
            <div className="shrink-0">
              <div className="text-[10px] font-medium uppercase tracking-wide text-white/50">SPI trend</div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold tabular-nums text-white">{spiLast.toFixed(2)}</span>
                {spiDelta !== null && <span className={`text-xs font-semibold ${spiDelta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{spiDelta >= 0 ? '▲' : '▼'} {Math.abs(spiDelta).toFixed(2)} vs last</span>}
              </div>
            </div>
            <Sparkline values={spiSeries} up={(spiDelta ?? 0) >= 0} className="h-9 flex-1" />
            <span className="shrink-0 text-[10px] text-white/40">{spiSeries.length} status points</span>
          </div>
        )}
      </div>

      {/* PMO dashboard — portfolio pie charts */}
      {showPies && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PieChart title="Cost Status (by CPI)" data={financialSlices} />
          <PieChart title="Schedule Status (by SPI)" data={scheduleSlices} />
          <PieChart title="Project Status" data={statusSlices} />
        </div>
      )}

      {/* PM & Finance — CPI (and SPI for PM) for THEIR assigned projects + progress.
          Donuts hover to reveal which projects fall in each slice. */}
      {showPmCharts && (
        <div className={`grid gap-3 sm:grid-cols-2 ${isPM ? 'lg:grid-cols-3' : ''}`}>
          <DonutChart title="Cost performance (by CPI)" slices={cpiSlices} />
          {isPM && <DonutChart title="Schedule performance (by SPI)" slices={spiSlices} />}
          <ProgressChart title="Progress per project" data={data.projects.map((p) => ({ name: p.name, actual: p.scheduleProgress, baseline: p.bac > 0 ? p.pv / p.bac : 0 }))} />
        </div>
      )}

      {/* PMO dashboard — change activity per project */}
      {showPies && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Changes by project</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{totalChanges} total changes (WBS · Cost · Risk · …)</span>
          </div>
          {totalChanges === 0 ? (
            <p className="py-3 text-center text-sm text-slate-500 dark:text-slate-400">No changes recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {changeRows.map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <Link to={`/projects/${p.id}`} className="w-44 shrink-0 truncate text-sm hover:underline" title={p.name}>
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{p.code}</span>{' '}
                    <span className="text-brand-600">{p.name}</span>
                  </Link>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-sky-500/80" style={{ width: `${(p.changeCount / maxChanges) * 100}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums text-slate-700 dark:text-slate-200">{p.changeCount}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Per-project detail — tabbed (EVM · Resource load · Cost & revenue) to cut scroll. */}
      {(() => {
        const tabs = ([
          { key: 'evm', label: 'EVM detail', show: true },
          { key: 'resource', label: 'Resource load', show: showPies },
          { key: 'cost', label: 'Cost & revenue', show: showFinancials },
        ] as const).filter((tb) => tb.show);
        if (tabs.length < 2) return null;
        return (
          <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
            {tabs.map((tb) => (
              <button key={tb.key} onClick={() => setTableTab(tb.key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${tableTab === tb.key ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>
                {tb.label}
              </button>
            ))}
          </div>
        );
      })()}

      {/* PMO dashboard — resource / manpower summary per project */}
      {showPies && tableTab === 'resource' && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Resource load by project</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{resTotals.resources} resources · {formatNum(resTotals.mandays, 0)} mandays · {formatIdr(resTotals.cost)}</span>
          </div>
          {!hasResources ? (
            <p className="py-3 text-center text-sm text-slate-500 dark:text-slate-400">No manpower loaded yet. Add manpower lines (from the resource pool) in each project's Cost tab.</p>
          ) : (
            <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="prima-rows w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                    <th className="py-2">Project</th>
                    <th className="text-right">Resources</th>
                    <th className="text-right">Mandays</th>
                    <th className="text-right">Manpower cost</th>
                    <th className="text-right" title="Manpower cost ÷ project BAC (PMB)">% of BAC</th>
                  </tr>
                </thead>
                <tbody>
                  {resourceRows.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="py-2">
                        <Link to={`/projects/${p.id}`} className="block">
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{p.code}</span>{' '}
                          <span className="font-medium text-brand-600 hover:underline">{p.name}</span>
                        </Link>
                      </td>
                      <td className="text-right tabular-nums">{p.resourceCount || <span className="text-slate-300 dark:text-slate-600">0</span>}</td>
                      <td className="text-right tabular-nums">{formatNum(p.planMandays, 0)}</td>
                      <td className="text-right tabular-nums">{formatIdr(p.manpowerCost)}</td>
                      <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{p.bac > 0 ? `${formatNum((p.manpowerCost / p.bac) * 100, 0)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <td className="py-2">Total</td>
                    <td className="text-right tabular-nums">{resTotals.resources}</td>
                    <td className="text-right tabular-nums">{formatNum(resTotals.mandays, 0)}</td>
                    <td className="text-right tabular-nums">{formatIdr(resTotals.cost)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {/* Mobile card list — table hidden < sm. */}
            <div className="space-y-2 sm:hidden">
              {resourceRows.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <Link to={`/projects/${p.id}`} className="block">
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{p.code}</span>{' '}
                    <span className="font-medium text-brand-600 hover:underline">{p.name}</span>
                  </Link>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-xs tabular-nums">
                    <div><div className="text-slate-400">Resources</div><div className="text-slate-700 dark:text-slate-200">{p.resourceCount || 0}</div></div>
                    <div><div className="text-slate-400">Mandays</div><div className="text-slate-700 dark:text-slate-200">{formatNum(p.planMandays, 0)}</div></div>
                    <div><div className="text-slate-400">Cost</div><div className="text-slate-700 dark:text-slate-200">{formatIdrShort(p.manpowerCost)}</div></div>
                    <div><div className="text-slate-400">% BAC</div><div className="text-slate-500 dark:text-slate-400">{p.bac > 0 ? `${formatNum((p.manpowerCost / p.bac) * 100, 0)}%` : '—'}</div></div>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-lg border-2 border-slate-200 p-3 text-sm font-semibold dark:border-slate-700">
                <span className="text-slate-600 dark:text-slate-300">Total</span>
                <span className="flex gap-3 tabular-nums text-slate-600 dark:text-slate-300">
                  <span>{resTotals.resources} res</span>
                  <span>{formatNum(resTotals.mandays, 0)} md</span>
                  <span>{formatIdrShort(resTotals.cost)}</span>
                </span>
              </div>
            </div>
            </>
          )}
        </Card>
      )}

      {/* Cost & revenue per project — PMO (portfolio) + PM (their own assigned projects) */}
      {showFinancials && tableTab === 'cost' && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Cost &amp; revenue by project</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Revenue {formatIdr(finTotals.revenue)} · Plan profit{' '}
              <span className={finPlan.profit < 0 ? 'text-red-500' : 'text-green-600 dark:text-green-400'}>
                {formatIdr(finPlan.profit)}{finPlan.marginPct != null ? ` (${finPlan.marginPct.toFixed(1)}%)` : ''}
              </span>
              {finTotals.actualCost > 0 && <> · Projected profit{' '}
                <span className={finProjected.profit < 0 ? 'text-red-500' : 'text-green-600 dark:text-green-400'}>
                  {formatIdr(finProjected.profit)}{finProjected.marginPct != null ? ` (${finProjected.marginPct.toFixed(1)}%)` : ''}
                </span>
              </>}
            </span>
          </div>
          {!hasFinancials ? (
            <p className="py-3 text-center text-sm text-slate-500 dark:text-slate-400">No cost/revenue captured yet. Set them per project under “Edit details”.</p>
          ) : (
            <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="prima-rows w-full text-sm tabular-nums [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                    <th className="py-2">Project</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right" title="Cost baseline / PMB (BAC = direct + indirect + contingency)">Plan cost</th>
                    <th className="text-right" title="Actual cost incurred to date (EVM AC)">Actual cost</th>
                    <th className="text-right" title="Plan profit = Revenue − BAC">Plan profit</th>
                    <th className="text-right" title="Projected profit at completion = Revenue − EAC (forecast cost)">Projected profit</th>
                    <th className="text-right" title="Plan margin = Plan profit ÷ Revenue">Plan margin</th>
                    <th className="text-right" title="Projected margin = Projected profit ÷ Revenue">Projected margin</th>
                  </tr>
                </thead>
                <tbody>
                  {finRows.map((p) => {
                    const plan = computeMargin(p.revenue, p.bac);
                    const projected = computeMargin(p.revenue, likelyEac(p.bac, p.cpi));
                    const hasPlan = p.revenue > 0 || p.bac > 0;
                    const hasActual = p.ac > 0;
                    const money = (v: number, tone: boolean, on: boolean) => (
                      <td className={`text-right whitespace-nowrap ${on && tone ? (v < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400') : ''}`} title={on ? formatIdr(v) : undefined}>{on ? formatIdrShort(v) : '—'}</td>
                    );
                    return (
                      <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800">
                        <td className="py-2">
                          <Link to={`/projects/${p.id}`} className="block">
                            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{p.code}</span>{' '}
                            <span className="font-medium text-brand-600 hover:underline">{p.name}</span>
                          </Link>
                        </td>
                        {money(p.revenue, false, !!p.revenue)}
                        {money(p.bac, false, !!p.bac)}
                        {money(p.ac, false, hasActual)}
                        {money(plan.profit, true, hasPlan)}
                        {money(projected.profit, true, hasPlan)}
                        <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{plan.marginPct != null ? `${plan.marginPct.toFixed(1)}%` : '—'}</td>
                        <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{projected.marginPct != null ? `${projected.marginPct.toFixed(1)}%` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <td className="py-2">Total</td>
                    <td className="text-right whitespace-nowrap" title={formatIdr(finTotals.revenue)}>{formatIdrShort(finTotals.revenue)}</td>
                    <td className="text-right whitespace-nowrap" title={formatIdr(finTotals.bac)}>{formatIdrShort(finTotals.bac)}</td>
                    <td className="text-right whitespace-nowrap" title={formatIdr(finTotals.actualCost)}>{finTotals.actualCost > 0 ? formatIdrShort(finTotals.actualCost) : '—'}</td>
                    <td className={`text-right whitespace-nowrap ${finPlan.profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`} title={formatIdr(finPlan.profit)}>{formatIdrShort(finPlan.profit)}</td>
                    <td className={`text-right whitespace-nowrap ${finProjected.profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`} title={formatIdr(finProjected.profit)}>{formatIdrShort(finProjected.profit)}</td>
                    <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{finPlan.marginPct != null ? `${finPlan.marginPct.toFixed(1)}%` : '—'}</td>
                    <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{finProjected.marginPct != null ? `${finProjected.marginPct.toFixed(1)}%` : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {/* Mobile card list — table hidden < sm. */}
            <div className="space-y-2 sm:hidden">
              {finRows.map((p) => {
                const plan = computeMargin(p.revenue, p.bac);
                const projected = computeMargin(p.revenue, likelyEac(p.bac, p.cpi));
                const hasPlan = p.revenue > 0 || p.bac > 0;
                const hasActual = p.ac > 0;
                const tone = (v: number) => (v < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400');
                return (
                  <div key={p.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                    <Link to={`/projects/${p.id}`} className="block">
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{p.code}</span>{' '}
                      <span className="font-medium text-brand-600 hover:underline">{p.name}</span>
                    </Link>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs tabular-nums">
                      <div><div className="text-slate-400">Revenue</div><div className="text-slate-700 dark:text-slate-200">{p.revenue ? formatIdrShort(p.revenue) : '—'}</div></div>
                      <div><div className="text-slate-400">Plan cost</div><div className="text-slate-700 dark:text-slate-200">{p.bac ? formatIdrShort(p.bac) : '—'}</div></div>
                      <div><div className="text-slate-400">Actual cost</div><div className="text-slate-700 dark:text-slate-200">{hasActual ? formatIdrShort(p.ac) : '—'}</div></div>
                      <div><div className="text-slate-400">Plan profit</div><div className={hasPlan ? tone(plan.profit) : 'text-slate-400'}>{hasPlan ? formatIdrShort(plan.profit) : '—'}</div></div>
                      <div><div className="text-slate-400">Projected profit</div><div className={hasPlan ? tone(projected.profit) : 'text-slate-400'}>{hasPlan ? formatIdrShort(projected.profit) : '—'}</div></div>
                      <div />
                      <div><div className="text-slate-400">Plan margin</div><div className="text-slate-500 dark:text-slate-400">{plan.marginPct != null ? `${plan.marginPct.toFixed(1)}%` : '—'}</div></div>
                      <div><div className="text-slate-400">Projected margin</div><div className="text-slate-500 dark:text-slate-400">{projected.marginPct != null ? `${projected.marginPct.toFixed(1)}%` : '—'}</div></div>
                    </div>
                  </div>
                );
              })}
              <div className="rounded-lg border-2 border-slate-200 p-3 text-sm font-semibold dark:border-slate-700">
                <div className="mb-1 text-slate-600 dark:text-slate-300">Total</div>
                <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                  <span>Rev {formatIdrShort(finTotals.revenue)}</span>
                  <span className={finPlan.profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>Plan profit {formatIdrShort(finPlan.profit)}</span>
                  <span className={finProjected.profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>Projected profit {formatIdrShort(finProjected.profit)}</span>
                </div>
              </div>
            </div>
            </>
          )}
        </Card>
      )}

      {/* Per-project EVM table (desktop) / card list (mobile) — the default tab. */}
      {tableTab === 'evm' && (
      <Card>
        <div className="hidden overflow-x-auto sm:block">
          <table className="prima-rows w-full text-sm tabular-nums [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <th className="py-2">Project</th><th>Status</th>
                <th className="text-right">BAC</th><th className="text-right">EV</th><th className="text-right">AC</th>
                <th className="text-right">CPI</th><th className="text-right">SPI</th>
                <th className="text-right">% Done</th><th className="text-right" title="Finish variance vs schedule baseline">Var</th><th className="text-right" title="Total recorded changes (WBS · Cost · Risk · etc.)">Changes</th><th className="text-right">Cost</th><th className="text-right">Sched.</th>
              </tr>
            </thead>
            <tbody>
              {evmProjects.map((p) => (
                <tr key={p.id} className={`border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 ${pinned.has(p.id) ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}>
                  <td className="py-2">
                    <div className="flex items-start gap-2">
                      <BookmarkStar on={pinned.has(p.id)} onToggle={() => togglePin(p.id)} />
                      <div className="min-w-0">
                        {canOpen ? (
                          <Link to={`/projects/${p.id}`} className="block">
                            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{p.code}</span>
                            <div className="font-medium text-brand-600 hover:underline">{p.name}</div>
                          </Link>
                        ) : (
                          <div>
                            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{p.code}</span>
                            <div className="font-medium text-slate-700 dark:text-slate-200">{p.name}</div>
                          </div>
                        )}
                        {p.clientName && <div className="text-xs text-slate-500 dark:text-slate-400">Client: {p.clientName}</div>}
                      </div>
                    </div>
                  </td>
                  <td><Badge color={PROJECT_STATUS_BADGE[p.status] ?? 'slate'}>{p.status}</Badge></td>
                  <td className="text-right whitespace-nowrap" title={formatIdr(p.bac)}>{formatIdrShort(p.bac)}</td>
                  <td className="text-right whitespace-nowrap" title={formatIdr(p.ev)}>{formatIdrShort(p.ev)}</td>
                  <td className="text-right whitespace-nowrap" title={formatIdr(p.ac)}>{formatIdrShort(p.ac)}</td>
                  <td className={`text-right ${p.cpi > 0 && p.cpi < 1 ? 'text-red-600' : ''}`}>{p.cpi ? formatNum(p.cpi, 2) : '—'}</td>
                  <td className={`text-right ${p.spi > 0 && p.spi < 1 ? 'text-red-600' : ''}`}>{p.spi ? formatNum(p.spi, 2) : '—'}</td>
                  <td className="text-right" title="Physical % complete — duration-weighted WBS roll-up (Schedule tab)">{formatNum(p.scheduleProgress * 100, 0)}%</td>
                  <td className="text-right tabular-nums">
                    {p.finishVarianceDays == null ? (
                      <span className="text-slate-300 dark:text-slate-600" title="No baseline">—</span>
                    ) : (
                      <span className={p.finishVarianceDays > 0 ? 'font-medium text-red-600 dark:text-red-400' : p.finishVarianceDays < 0 ? 'font-medium text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}>
                        {p.finishVarianceDays > 0 ? `+${p.finishVarianceDays}d` : p.finishVarianceDays < 0 ? `${p.finishVarianceDays}d` : '0'}
                      </span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {p.changeCount > 0 ? (
                      <Link to={`/projects/${p.id}`} className="inline-grid h-5 min-w-[24px] place-items-center rounded-full bg-slate-100 px-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700" title="View audit trail">
                        {p.changeCount}
                      </Link>
                    ) : (
                      <span className="text-slate-300 dark:text-slate-600">0</span>
                    )}
                  </td>
                  <td className="text-right">
                    {p.costHealth === 'NO_DATA'
                      ? <span className="text-slate-500 dark:text-slate-400" title={NODATA_HINT.cost}>—</span>
                      : <Badge color={HEALTH_COLOR[p.costHealth]}>{HEALTH_LABEL[p.costHealth]}</Badge>}
                  </td>
                  <td className="text-right">
                    {p.health === 'NO_DATA'
                      ? <span className="text-slate-500 dark:text-slate-400" title={NODATA_HINT.sched}>—</span>
                      : <Badge color={HEALTH_COLOR[p.health]}>{HEALTH_LABEL[p.health]}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile card list — table hidden < sm. */}
        <div className="space-y-2 sm:hidden">
          {evmProjects.map((p) => {
            const varText = p.finishVarianceDays == null ? '—' : p.finishVarianceDays > 0 ? `+${p.finishVarianceDays}d` : p.finishVarianceDays < 0 ? `${p.finishVarianceDays}d` : '0';
            const varClass = p.finishVarianceDays == null ? 'text-slate-400' : p.finishVarianceDays > 0 ? 'text-red-600 dark:text-red-400' : p.finishVarianceDays < 0 ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400';
            return (
              <div key={p.id} className={`rounded-lg border p-3 ${pinned.has(p.id) ? 'border-amber-300 bg-amber-50/40 dark:border-amber-500/40 dark:bg-amber-900/10' : 'border-slate-200 dark:border-slate-800'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{p.code}</span>
                    {canOpen ? (
                      <Link to={`/projects/${p.id}`} className="block font-medium text-brand-600 hover:underline">{p.name}</Link>
                    ) : (
                      <div className="font-medium text-slate-700 dark:text-slate-200">{p.name}</div>
                    )}
                    {p.clientName && <div className="text-xs text-slate-500 dark:text-slate-400">Client: {p.clientName}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge color={PROJECT_STATUS_BADGE[p.status] ?? 'slate'}>{p.status}</Badge>
                    <BookmarkStar on={pinned.has(p.id)} onToggle={() => togglePin(p.id)} />
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5 text-xs tabular-nums">
                  <div><div className="text-slate-400">BAC</div><div className="text-slate-700 dark:text-slate-200">{formatIdrShort(p.bac)}</div></div>
                  <div><div className="text-slate-400">EV</div><div className="text-slate-700 dark:text-slate-200">{formatIdrShort(p.ev)}</div></div>
                  <div><div className="text-slate-400">AC</div><div className="text-slate-700 dark:text-slate-200">{formatIdrShort(p.ac)}</div></div>
                  <div><div className="text-slate-400">CPI</div><div className={p.cpi > 0 && p.cpi < 1 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}>{p.cpi ? formatNum(p.cpi, 2) : '—'}</div></div>
                  <div><div className="text-slate-400">SPI</div><div className={p.spi > 0 && p.spi < 1 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}>{p.spi ? formatNum(p.spi, 2) : '—'}</div></div>
                  <div><div className="text-slate-400">% Done</div><div className="text-slate-700 dark:text-slate-200">{formatNum(p.scheduleProgress * 100, 0)}%</div></div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-xs dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Var <span className={varClass}>{varText}</span></span>
                  <span className="text-slate-500 dark:text-slate-400">Changes {p.changeCount}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <span className="text-slate-400">Cost</span>
                    {p.costHealth === 'NO_DATA' ? <span className="text-slate-400" title={NODATA_HINT.cost}>—</span> : <Badge color={HEALTH_COLOR[p.costHealth]}>{HEALTH_LABEL[p.costHealth]}</Badge>}
                    <span className="ml-1 text-slate-400">Sched</span>
                    {p.health === 'NO_DATA' ? <span className="text-slate-400" title={NODATA_HINT.sched}>—</span> : <Badge color={HEALTH_COLOR[p.health]}>{HEALTH_LABEL[p.health]}</Badge>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      )}
    </div>
  );
}

// Amber bookmark star toggle. Sits outside the project Link, so a tap only pins/unpins.
function BookmarkStar({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { lang } = useLang();
  const label = on
    ? (lang === 'id' ? 'Hapus bookmark' : 'Remove bookmark')
    : (lang === 'id' ? 'Bookmark proyek' : 'Bookmark project');
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={`shrink-0 rounded p-0.5 transition ${on ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500 dark:text-slate-600 dark:hover:text-amber-400'}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
      </svg>
    </button>
  );
}


// Compact SPI trend line for the hero. Stretches to its container (non-scaling stroke),
// green when improving / red when declining, with a soft area fill and a last-point dot.
function Sparkline({ values, up, className }: { values: number[]; up: boolean; className?: string }) {
  const W = 200, H = 36, pad = 3;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (values.length === 1 ? 0 : (i / (values.length - 1)) * (W - 2 * pad));
    const y = H - pad - ((v - min) / span) * (H - 2 * pad);
    return [x, y] as const;
  });
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
  const color = up ? '#6ee7b7' : '#fca5a5';
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className}>
      <defs>
        <linearGradient id="spkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spkFill)" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}
