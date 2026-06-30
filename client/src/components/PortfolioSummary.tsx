import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PortfolioSummary as Summary } from '../api/types';
import { Badge, Card, Field, Input, Skeleton } from './ui';
import { formatDateInput, formatIdr, formatIdrShort, formatNum } from '../lib/format';
import { PROJECT_STATUS_BADGE } from '../lib/labels';
import { useAuth } from '../context/AuthContext';
import PieChart, { type Slice } from './PieChart';

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
  const [statusDate, setStatusDate] = useState(formatDateInput(new Date()));
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio', statusDate],
    queryFn: () => api.get<Summary>(`/portfolio/summary?statusDate=${statusDate}`),
  });

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
        <div className="w-44">
          <Field label="Status date (EVM)">
            <Input type="date" value={statusDate} onChange={(e) => setStatusDate(e.target.value)} />
          </Field>
        </div>
      </div>

      {/* KPI cards — wider cards (4 cols) so full IDR values fit on one line. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Kpi label="Projects" value={String(t.count)} icon={KPI_ICON.projects} />
        <Kpi label="Total BAC" value={formatIdrShort(t.bac)} title={formatIdr(t.bac)} strong icon={KPI_ICON.bac} />
        <Kpi label="Earned Value" value={formatIdrShort(t.ev)} title={formatIdr(t.ev)} icon={KPI_ICON.ev} />
        <Kpi label="Actual Cost" value={formatIdrShort(t.ac)} title={formatIdr(t.ac)} icon={KPI_ICON.ac} />
        <Kpi label={showPies ? 'Portfolio CPI' : 'CPI'} value={t.cpi ? formatNum(t.cpi, 2) : '—'} warn={t.cpi > 0 && t.cpi < 1} icon={KPI_ICON.cpi} />
        <Kpi label={showPies ? 'Portfolio SPI' : 'SPI'} value={t.spi ? formatNum(t.spi, 2) : '—'} warn={spiBehind} icon={KPI_ICON.spi} />
        <Kpi label="% Complete" value={`${formatNum(t.scheduleProgress * 100, 1)}%`} icon={KPI_ICON.percent} />
        <Kpi
          label="Schedule slip"
          value={t.baselinedCount === 0 ? '—' : t.slippedCount > 0 ? `${t.slippedCount} late · ${t.worstSlipDays}d` : 'On schedule'}
          warn={t.slippedCount > 0}
          icon={KPI_ICON.schedule}
        />
      </div>

      {/* Health distribution */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Schedule health:</span>
          {(['GREEN', 'AMBER', 'RED', 'NO_DATA'] as const).map((h) => (
            <Badge key={h} color={HEALTH_COLOR[h]}>{HEALTH_LABEL[h]}: {data.byHealth[h] ?? 0}</Badge>
          ))}
          <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
            Contingency held: {formatIdr(t.contingencyReserve)}
          </span>
        </div>
        {(data.byHealth.NO_DATA ?? 0) > 0 && (
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
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

      {/* PMO dashboard — change activity per project */}
      {showPies && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Changes by project</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">{totalChanges} total changes (WBS · Cost · Risk · …)</span>
          </div>
          {totalChanges === 0 ? (
            <p className="py-3 text-center text-sm text-slate-400 dark:text-slate-500">No changes recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {changeRows.map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <Link to={`/projects/${p.id}`} className="w-44 shrink-0 truncate text-sm hover:underline" title={p.name}>
                    <span className="font-mono text-xs text-slate-400 dark:text-slate-500">{p.code}</span>{' '}
                    <span className="text-brand-600">{p.name}</span>
                  </Link>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${(p.changeCount / maxChanges) * 100}%` }} />
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
            <span className="text-xs text-slate-400 dark:text-slate-500">{resTotals.resources} resources · {formatNum(resTotals.mandays, 0)} mandays · {formatIdr(resTotals.cost)}</span>
          </div>
          {!hasResources ? (
            <p className="py-3 text-center text-sm text-slate-400 dark:text-slate-500">No manpower loaded yet. Add manpower lines (from the resource pool) in each project's Cost tab.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="prima-rows w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-slate-400 dark:text-slate-500">
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
                          <span className="font-mono text-xs text-slate-400 dark:text-slate-500">{p.code}</span>{' '}
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
          )}
        </Card>
      )}

      {/* PMO dashboard — cost & revenue per project */}
      {showPies && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Cost &amp; revenue by project</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              Cost {formatIdr(finTotals.cost)} · Revenue {formatIdr(finTotals.revenue)} · Profit{' '}
              <span className={finMargin < 0 ? 'text-red-500' : 'text-green-600 dark:text-green-400'}>
                {formatIdr(finMargin)}{finTotals.revenue > 0 ? ` (${formatNum((finMargin / finTotals.revenue) * 100, 1)}%)` : ''}
              </span>
            </span>
          </div>
          {!hasFinancials ? (
            <p className="py-3 text-center text-sm text-slate-400 dark:text-slate-500">No cost/revenue captured yet. Set them per project under “Edit details”.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="prima-rows w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-slate-400 dark:text-slate-500">
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
                            <span className="font-mono text-xs text-slate-400 dark:text-slate-500">{p.code}</span>{' '}
                            <span className="font-medium text-brand-600 hover:underline">{p.name}</span>
                          </Link>
                        </td>
                        <td className="text-right tabular-nums">{p.plannedCost ? formatIdr(p.plannedCost) : '—'}</td>
                        <td className="text-right tabular-nums">{p.revenue ? formatIdr(p.revenue) : '—'}</td>
                        <td className={`text-right tabular-nums ${p.revenue || p.plannedCost ? (margin < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400') : ''}`}>
                          {p.revenue || p.plannedCost ? formatIdr(margin) : '—'}
                        </td>
                        <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{p.revenue > 0 ? `${formatNum((margin / p.revenue) * 100, 1)}%` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <td className="py-2">Total</td>
                    <td className="text-right tabular-nums">{formatIdr(finTotals.cost)}</td>
                    <td className="text-right tabular-nums">{formatIdr(finTotals.revenue)}</td>
                    <td className={`text-right tabular-nums ${finMargin < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{formatIdr(finMargin)}</td>
                    <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{finTotals.revenue > 0 ? `${formatNum((finMargin / finTotals.revenue) * 100, 1)}%` : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Per-project EVM table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="prima-rows w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-400 dark:text-slate-500">
                <th className="py-2">Project</th><th>Status</th>
                <th className="text-right">BAC</th><th className="text-right">EV</th><th className="text-right">AC</th>
                <th className="text-right">CPI</th><th className="text-right">SPI</th>
                <th className="text-right">% Done</th><th className="text-right" title="Finish variance vs schedule baseline">Var</th><th className="text-right" title="Total recorded changes (WBS · Cost · Risk · etc.)">Changes</th><th className="text-right">Cost</th><th className="text-right">Sched.</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="py-2">
                    <Link to={`/projects/${p.id}`} className="block">
                      <span className="font-mono text-xs text-slate-400 dark:text-slate-500">{p.code}</span>
                      <div className="font-medium text-brand-600 hover:underline">{p.name}</div>
                    </Link>
                    {p.clientName && <div className="text-xs text-slate-400 dark:text-slate-500">Client: {p.clientName}</div>}
                  </td>
                  <td><Badge color={PROJECT_STATUS_BADGE[p.status] ?? 'slate'}>{p.status}</Badge></td>
                  <td className="text-right">{formatIdr(p.bac)}</td>
                  <td className="text-right">{formatIdr(p.ev)}</td>
                  <td className="text-right">{formatIdr(p.ac)}</td>
                  <td className={`text-right ${p.cpi > 0 && p.cpi < 1 ? 'text-red-600' : ''}`}>{p.cpi ? formatNum(p.cpi, 2) : '—'}</td>
                  <td className={`text-right ${p.spi > 0 && p.spi < 1 ? 'text-red-600' : ''}`}>{p.spi ? formatNum(p.spi, 2) : '—'}</td>
                  <td className="text-right" title="Physical % complete — duration-weighted WBS roll-up (Schedule tab)">{formatNum(p.scheduleProgress * 100, 0)}%</td>
                  <td className="text-right tabular-nums">
                    {p.finishVarianceDays == null ? (
                      <span className="text-slate-300 dark:text-slate-600" title="No baseline">—</span>
                    ) : (
                      <span className={p.finishVarianceDays > 0 ? 'font-medium text-red-600 dark:text-red-400' : p.finishVarianceDays < 0 ? 'font-medium text-green-600 dark:text-green-400' : 'text-slate-400 dark:text-slate-500'}>
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
                      ? <span className="text-slate-400 dark:text-slate-500" title={NODATA_HINT.cost}>—</span>
                      : <Badge color={HEALTH_COLOR[p.costHealth]}>{HEALTH_LABEL[p.costHealth]}</Badge>}
                  </td>
                  <td className="text-right">
                    {p.health === 'NO_DATA'
                      ? <span className="text-slate-400 dark:text-slate-500" title={NODATA_HINT.sched}>—</span>
                      : <Badge color={HEALTH_COLOR[p.health]}>{HEALTH_LABEL[p.health]}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, strong, warn, icon, title }: { label: string; value: string; strong?: boolean; warn?: boolean; icon?: string; title?: string }) {
  // Uniform size for every KPI so the longest currency value can't overflow its narrow
  // card. tabular-nums keeps digits aligned. `strong` (e.g. Total BAC) is a neutral
  // figure — emphasised by weight, not an alarm colour. Red is reserved for `warn` only.
  const tone = warn
    ? 'font-semibold text-red-600 dark:text-red-400'
    : strong
      ? 'font-bold text-slate-900 dark:text-white'
      : 'font-semibold text-slate-800 dark:text-slate-100';
  return (
    <Card className="!p-3">
      <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
        {icon && (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={icon} />
          </svg>
        )}
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div title={title} className={`mt-1 text-lg leading-tight tabular-nums ${tone}`}>{value}</div>
    </Card>
  );
}
