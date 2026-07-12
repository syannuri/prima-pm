import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PortfolioSummary as Summary } from '../api/types';
import { Badge, Card, Field, Input, Skeleton } from './ui';
import { formatDateInput, formatIdr, formatIdrShort, formatNum } from '../lib/format';
import { PROJECT_STATUS_BADGE } from '../lib/labels';
import { useAuth } from '../context/AuthContext';
import { useBookmarks } from '../hooks/useBookmarks';
import PieChart, { type Slice } from './PieChart';
import ProgressChart from './ProgressChart';
import DonutChart, { type DonutSlice } from './DonutChart';

const PIE = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444', slate: '#94a3b8', coral: '#f4675f' };

// Mono line-icons (feather-style) for the KPI cards — purely for scannability.
const KPI_ICON = {
  projects: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  bac: 'M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4z',
  ev: 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
  ac: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  cpi: 'M22 12h-4l-3 9L9 3l-3 9H2',
  spi: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  percent: 'M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z',
  schedule: 'M3 4h18v18H3zM3 10h18M8 2v4M16 2v4',
};

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
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio', statusDate],
    queryFn: () => api.get<Summary>(`/portfolio/summary?statusDate=${statusDate}`),
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
  const spiBehind = t.spi > 0 && t.spi < 1;

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
  const finTotals = data.projects.reduce(
    (a, p) => ({ cost: a.cost + p.plannedCost, revenue: a.revenue + p.revenue }),
    { cost: 0, revenue: 0 },
  );
  const finMargin = finTotals.revenue - finTotals.cost;
  const hasFinancials = finTotals.cost > 0 || finTotals.revenue > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-end">
        {/* Compact date field, right-aligned (the native picker shouldn't span the row). */}
        <div className="w-40 sm:w-44">
          <Field label="Status date (EVM)">
            <Input type="date" value={statusDate} onChange={(e) => setStatusDate(e.target.value)} />
          </Field>
        </div>
      </div>

      {/* KPI stat strip — one cohesive card with divided cells. All 8 sit on a single
          row on wide screens; on narrow ones the strip scrolls horizontally. */}
      <Card className="overflow-hidden !p-0">
        {/* Mobile: 2-col grid so all KPIs are visible (thin dividers via gap-px). sm+: one scrollable strip. */}
        <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-800 sm:flex sm:gap-0 sm:divide-x sm:divide-slate-200 sm:overflow-x-auto sm:bg-transparent sm:dark:divide-slate-800">
          {([
            { label: 'Projects', value: String(t.count), icon: KPI_ICON.projects },
            { label: 'Total BAC', value: formatIdrShort(t.bac), title: formatIdr(t.bac), strong: true, icon: KPI_ICON.bac },
            { label: 'Earned Value', value: formatIdrShort(t.ev), title: formatIdr(t.ev), icon: KPI_ICON.ev },
            { label: 'Actual Cost', value: formatIdrShort(t.ac), title: formatIdr(t.ac), icon: KPI_ICON.ac },
            { label: showPies ? 'Portfolio CPI' : 'CPI', value: t.cpi ? formatNum(t.cpi, 2) : '—', warn: t.cpi > 0 && t.cpi < 1, icon: KPI_ICON.cpi },
            { label: showPies ? 'Portfolio SPI' : 'SPI', value: t.spi ? formatNum(t.spi, 2) : '—', warn: spiBehind, icon: KPI_ICON.spi },
            { label: '% Complete', value: `${formatNum(t.scheduleProgress * 100, 1)}%`, icon: KPI_ICON.percent },
            { label: 'Schedule slip', value: t.baselinedCount === 0 ? '—' : t.slippedCount > 0 ? `${t.slippedCount} late · ${t.worstSlipDays}d` : 'On schedule', warn: t.slippedCount > 0, icon: KPI_ICON.schedule },
          ] as Array<{ label: string; value: string; icon: string; title?: string; strong?: boolean; warn?: boolean }>).map((s) => (
            <div key={s.label} className="min-w-[7.25rem] flex-1 bg-white px-3.5 py-2.5 dark:bg-slate-900 sm:bg-transparent sm:dark:bg-transparent">
              <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={s.icon} /></svg>
                <span className="truncate text-[10px] font-medium uppercase tracking-wide" title={s.label}>{s.label}</span>
              </div>
              <div
                title={s.title}
                className={`mt-0.5 truncate text-base leading-tight tabular-nums ${
                  s.warn ? 'font-semibold text-red-600 dark:text-red-400' : s.strong ? 'font-bold text-slate-900 dark:text-white' : 'font-semibold text-slate-800 dark:text-slate-100'
                }`}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Health distribution */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Schedule health:</span>
          {(['GREEN', 'AMBER', 'RED', 'NO_DATA'] as const).map((h) => (
            <Badge key={h} color={HEALTH_COLOR[h]}>{HEALTH_LABEL[h]}: {data.byHealth[h] ?? 0}</Badge>
          ))}
          <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            Contingency held: {formatIdr(t.contingencyReserve)}
          </span>
        </div>
        {(data.byHealth.NO_DATA ?? 0) > 0 && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            “No data” means the project hasn’t started by the status date (or has no recorded actual cost). Pick a later status date above to see progress.
          </p>
        )}
      </Card>

      {/* PMO dashboard — portfolio pie charts */}
      {showPies && (
        <div className="grid gap-3 sm:grid-cols-2">
          <PieChart title="Project Financial Status (by CPI)" data={financialSlices} />
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

      {/* PMO dashboard — resource / manpower summary per project */}
      {showPies && (
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
      {showFinancials && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Cost &amp; revenue by project</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Cost {formatIdr(finTotals.cost)} · Revenue {formatIdr(finTotals.revenue)} · Profit{' '}
              <span className={finMargin < 0 ? 'text-red-500' : 'text-green-600 dark:text-green-400'}>
                {formatIdr(finMargin)}{finTotals.revenue > 0 ? ` (${formatNum((finMargin / finTotals.revenue) * 100, 1)}%)` : ''}
              </span>
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
                    <th className="text-right">Cost</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right" title="Profit = Revenue − Cost">Profit</th>
                    <th className="text-right" title="Profit margin = Profit ÷ Revenue">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {finRows.map((p) => {
                    const margin = p.revenue - p.plannedCost;
                    return (
                      <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800">
                        <td className="py-2">
                          <Link to={`/projects/${p.id}`} className="block">
                            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{p.code}</span>{' '}
                            <span className="font-medium text-brand-600 hover:underline">{p.name}</span>
                          </Link>
                        </td>
                        <td className="text-right whitespace-nowrap" title={p.plannedCost ? formatIdr(p.plannedCost) : undefined}>{p.plannedCost ? formatIdrShort(p.plannedCost) : '—'}</td>
                        <td className="text-right whitespace-nowrap" title={p.revenue ? formatIdr(p.revenue) : undefined}>{p.revenue ? formatIdrShort(p.revenue) : '—'}</td>
                        <td className={`text-right whitespace-nowrap ${p.revenue || p.plannedCost ? (margin < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400') : ''}`} title={p.revenue || p.plannedCost ? formatIdr(margin) : undefined}>
                          {p.revenue || p.plannedCost ? formatIdrShort(margin) : '—'}
                        </td>
                        <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{p.revenue > 0 ? `${formatNum((margin / p.revenue) * 100, 1)}%` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <td className="py-2">Total</td>
                    <td className="text-right whitespace-nowrap" title={formatIdr(finTotals.cost)}>{formatIdrShort(finTotals.cost)}</td>
                    <td className="text-right whitespace-nowrap" title={formatIdr(finTotals.revenue)}>{formatIdrShort(finTotals.revenue)}</td>
                    <td className={`text-right whitespace-nowrap ${finMargin < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`} title={formatIdr(finMargin)}>{formatIdrShort(finMargin)}</td>
                    <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{finTotals.revenue > 0 ? `${formatNum((finMargin / finTotals.revenue) * 100, 1)}%` : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {/* Mobile card list — table hidden < sm. */}
            <div className="space-y-2 sm:hidden">
              {finRows.map((p) => {
                const margin = p.revenue - p.plannedCost;
                const has = p.revenue > 0 || p.plannedCost > 0;
                return (
                  <div key={p.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                    <Link to={`/projects/${p.id}`} className="block">
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{p.code}</span>{' '}
                      <span className="font-medium text-brand-600 hover:underline">{p.name}</span>
                    </Link>
                    <div className="mt-2 grid grid-cols-4 gap-2 text-xs tabular-nums">
                      <div><div className="text-slate-400">Cost</div><div className="text-slate-700 dark:text-slate-200">{p.plannedCost ? formatIdrShort(p.plannedCost) : '—'}</div></div>
                      <div><div className="text-slate-400">Revenue</div><div className="text-slate-700 dark:text-slate-200">{p.revenue ? formatIdrShort(p.revenue) : '—'}</div></div>
                      <div><div className="text-slate-400">Profit</div><div className={has ? (margin < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400') : 'text-slate-400'}>{has ? formatIdrShort(margin) : '—'}</div></div>
                      <div><div className="text-slate-400">Margin</div><div className="text-slate-500 dark:text-slate-400">{p.revenue > 0 ? `${formatNum((margin / p.revenue) * 100, 1)}%` : '—'}</div></div>
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between rounded-lg border-2 border-slate-200 p-3 text-sm font-semibold dark:border-slate-700">
                <span className="text-slate-600 dark:text-slate-300">Total</span>
                <span className="flex flex-wrap justify-end gap-x-3 gap-y-0.5 tabular-nums text-slate-600 dark:text-slate-300">
                  <span>Cost {formatIdrShort(finTotals.cost)}</span>
                  <span>Rev {formatIdrShort(finTotals.revenue)}</span>
                  <span className={finMargin < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>Profit {formatIdrShort(finMargin)}</span>
                </span>
              </div>
            </div>
            </>
          )}
        </Card>
      )}

      {/* Per-project EVM table (desktop) / card list (mobile) */}
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
    </div>
  );
}

// Amber bookmark star toggle. Sits outside the project Link, so a tap only pins/unpins.
function BookmarkStar({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={on ? 'Hapus bookmark' : 'Bookmark proyek'}
      title={on ? 'Hapus bookmark' : 'Bookmark'}
      className={`shrink-0 rounded p-0.5 transition ${on ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500 dark:text-slate-600 dark:hover:text-amber-400'}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
      </svg>
    </button>
  );
}

