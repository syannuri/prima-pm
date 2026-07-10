import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PortfolioSummary, PortfolioRow, PortfolioHealth } from '../api/types';
import { EmptyState, Spinner } from './ui';
import { formatIdrShort, formatDate } from '../lib/format';

// Portfolio Report — the FINANCIAL roll-up (budget vs actual), the cost-side complement to the
// Executive view (schedule-health RAG). Reuses GET /portfolio/summary, so no new endpoint or rule.
// Focus: BAC vs Earned vs Actual, cost variance and CPI per project, sorted worst cost-health first.
const RAG: Record<PortfolioHealth, { c: string; label: string }> = {
  GREEN: { c: '#16a34a', label: 'On budget' },
  AMBER: { c: '#f59e0b', label: 'Watch' },
  RED: { c: '#dc2626', label: 'Over budget' },
  NO_DATA: { c: '#94a3b8', label: 'No cost data' },
};
const RANK: Record<PortfolioHealth, number> = { RED: 0, AMBER: 1, GREEN: 2, NO_DATA: 3 };

export default function PortfolioReport() {
  const q = useQuery({ queryKey: ['portfolio-summary'], queryFn: () => api.get<PortfolioSummary>('/portfolio/summary') });

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner /></div>;
  const s = q.data;
  if (!s || s.projects.length === 0)
    return <EmptyState title="No active projects" hint="The portfolio roll-up covers every project past the draft stage — commit a charter to see it here." />;

  const t = s.totals;
  const cv = t.ev - t.ac; // cost variance (EV − AC); >0 = under budget for work done
  const spentPct = t.bac > 0 ? Math.round((t.ac / t.bac) * 100) : 0;
  // Worst cost-health first, then by CPI ascending (biggest overrun first).
  const rows = [...s.projects].sort((a, b) => RANK[a.costHealth] - RANK[b.costHealth] || a.cpi - b.cpi);
  const byCostHealth = rows.reduce((m, r) => { m[r.costHealth] = (m[r.costHealth] ?? 0) + 1; return m; }, {} as Record<string, number>);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Portfolio Report · Budget vs Actual</div>
            <h2 className="mt-0.5 text-xl font-bold text-slate-800 dark:text-slate-100">All projects</h2>
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t.count} project{t.count === 1 ? '' : 's'} · as of {formatDate(s.statusDate)}</div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-extrabold tabular-nums text-slate-800 dark:text-white">{spentPct}%</div>
            <div className="text-[11px] uppercase tracking-wide text-slate-400">of budget spent</div>
          </div>
        </div>

        {/* KPI band — financial */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Total budget" value={formatIdrShort(t.bac)} sub="BAC (PMB)" />
          <Kpi label="Earned value" value={formatIdrShort(t.ev)} sub={`${Math.round(t.percentComplete * 100)}% delivered`} />
          <Kpi label="Actual cost" value={formatIdrShort(t.ac)} sub={`${spentPct}% of budget`} />
          <Kpi label="Cost variance" value={formatIdrShort(cv)} sub={cv < 0 ? 'over budget' : 'under budget'} warn={cv < 0} good={t.ac > 0 && cv >= 0} />
          <Kpi label="Portfolio CPI" value={t.ac > 0 ? t.cpi.toFixed(2) : '—'} sub="cost efficiency" warn={t.ac > 0 && t.cpi < 1} good={t.ac > 0 && t.cpi >= 1} />
          <Kpi label="Contingency" value={formatIdrShort(t.contingencyReserve)} sub="reserve held" />
        </div>

        {/* Cost-health distribution */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wide">Cost health</span>
            <span className="flex flex-wrap gap-3">
              {(['GREEN', 'AMBER', 'RED', 'NO_DATA'] as PortfolioHealth[]).map((h) => (
                <span key={h} className="inline-flex items-center gap-1"><Dot h={h} />{RAG[h].label} {byCostHealth[h] ?? 0}</span>
              ))}
            </span>
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            {(['GREEN', 'AMBER', 'RED', 'NO_DATA'] as PortfolioHealth[]).map((h) =>
              (byCostHealth[h] ?? 0) > 0 ? <div key={h} style={{ width: `${((byCostHealth[h] ?? 0) / t.count) * 100}%`, backgroundColor: RAG[h].c }} /> : null,
            )}
          </div>
        </div>
      </div>

      {/* Budget-vs-actual table — worst cost-health first */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Budget vs actual</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Per-project spend against budget, sorted by cost health (biggest overrun first). The bar shows actual cost against budget, with a tick at earned value.</p>
        </div>
        {/* Desktop: table. Mobile (< sm): card list below. */}
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <th className="py-2 pr-3 font-semibold">Project</th>
                <th className="px-3 py-2 text-right font-semibold">Budget (BAC)</th>
                <th className="px-3 py-2 text-right font-semibold">Earned</th>
                <th className="px-3 py-2 text-right font-semibold">Actual</th>
                <th className="px-3 py-2 text-right font-semibold">Variance</th>
                <th className="px-3 py-2 text-right font-semibold">CPI</th>
                <th className="px-3 py-2 font-semibold">Spend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <Row key={r.id} r={r} />)}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-semibold dark:border-slate-700">
                <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">Portfolio total</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{formatIdrShort(t.bac)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatIdrShort(t.ev)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatIdrShort(t.ac)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${cv < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{formatIdrShort(cv)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${t.ac > 0 && t.cpi < 1 ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}`}>{t.ac > 0 ? t.cpi.toFixed(2) : '—'}</td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile card list — table hidden < sm. */}
        <div className="space-y-2 sm:hidden">
          {rows.map((r) => {
            const rcv = r.ev - r.ac;
            const acPct = r.bac > 0 ? Math.min(100, (r.ac / r.bac) * 100) : 0;
            const evPct = r.bac > 0 ? Math.min(100, (r.ev / r.bac) * 100) : 0;
            const over = r.ac > 0 && r.cpi < 1;
            return (
              <div key={r.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Dot h={r.costHealth} />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800 dark:text-slate-100">{r.name}</div>
                    <div className="text-[11px] text-slate-400">{r.code}{r.pm ? ` · ${r.pm}` : ''}</div>
                  </div>
                  <span className={`ml-auto shrink-0 text-sm tabular-nums ${over ? 'text-red-600 dark:text-red-400' : r.ac > 0 ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}`}>CPI {r.ac > 0 ? r.cpi.toFixed(2) : '—'}</span>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-xs tabular-nums">
                  <div><div className="text-slate-400">Budget</div><div className="text-slate-800 dark:text-slate-100">{formatIdrShort(r.bac)}</div></div>
                  <div><div className="text-slate-400">Earned</div><div className="text-slate-600 dark:text-slate-300">{formatIdrShort(r.ev)}</div></div>
                  <div><div className="text-slate-400">Actual</div><div className="text-slate-600 dark:text-slate-300">{r.ac > 0 ? formatIdrShort(r.ac) : '—'}</div></div>
                  <div><div className="text-slate-400">Variance</div><div className={r.ac > 0 ? (rcv < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400') : 'text-slate-400'}>{r.ac > 0 ? formatIdrShort(rcv) : '—'}</div></div>
                </div>
                <div className="relative mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" title={`Spent ${formatIdrShort(r.ac)} of ${formatIdrShort(r.bac)} · earned ${formatIdrShort(r.ev)}`}>
                  <div className="h-full rounded-full" style={{ width: `${acPct}%`, backgroundColor: over ? RAG.RED.c : RAG.GREEN.c }} />
                  {r.ev > 0 && <div className="absolute top-0 h-full w-0.5 bg-slate-500 dark:bg-slate-300" style={{ left: `calc(${evPct}% - 1px)` }} />}
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between rounded-lg border-2 border-slate-200 p-3 text-sm font-semibold dark:border-slate-700">
            <span className="text-slate-700 dark:text-slate-200">Portfolio total</span>
            <span className="flex flex-wrap justify-end gap-x-3 gap-y-0.5 tabular-nums">
              <span className="text-slate-600 dark:text-slate-300">BAC {formatIdrShort(t.bac)}</span>
              <span className="text-slate-600 dark:text-slate-300">AC {formatIdrShort(t.ac)}</span>
              <span className={cv < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>CV {formatIdrShort(cv)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ r }: { r: PortfolioRow }) {
  const cv = r.ev - r.ac;
  const acPct = r.bac > 0 ? Math.min(100, (r.ac / r.bac) * 100) : 0;
  const evPct = r.bac > 0 ? Math.min(100, (r.ev / r.bac) * 100) : 0;
  const over = r.ac > 0 && r.cpi < 1;
  return (
    <tr className="border-b border-slate-100 last:border-0 dark:border-slate-800">
      <td className="min-w-0 py-2 pr-3">
        <div className="flex items-center gap-2">
          <Dot h={r.costHealth} />
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-800 dark:text-slate-100">{r.name}</div>
            <div className="text-[11px] text-slate-400">{r.code}{r.pm ? ` · ${r.pm}` : ''}</div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-slate-100">{formatIdrShort(r.bac)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{formatIdrShort(r.ev)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{r.ac > 0 ? formatIdrShort(r.ac) : '—'}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${r.ac > 0 ? (cv < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400') : 'text-slate-400'}`}>{r.ac > 0 ? formatIdrShort(cv) : '—'}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${over ? 'text-red-600 dark:text-red-400' : r.ac > 0 ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}`}>{r.ac > 0 ? r.cpi.toFixed(2) : '—'}</td>
      <td className="px-3 py-2">
        {/* Spend bar: track = BAC, fill = actual cost, tick = earned value. */}
        <div className="relative h-2.5 w-28 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" title={`Spent ${formatIdrShort(r.ac)} of ${formatIdrShort(r.bac)} · earned ${formatIdrShort(r.ev)}`}>
          <div className="h-full rounded-full" style={{ width: `${acPct}%`, backgroundColor: over ? RAG.RED.c : RAG.GREEN.c }} />
          {r.ev > 0 && <div className="absolute top-0 h-full w-0.5 bg-slate-500 dark:bg-slate-300" style={{ left: `calc(${evPct}% - 1px)` }} />}
        </div>
      </td>
    </tr>
  );
}

function Dot({ h }: { h: PortfolioHealth }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: RAG[h].c }} title={RAG[h].label} />;
}

function Kpi({ label, value, sub, warn, good }: { label: string; value: string; sub?: string; warn?: boolean; good?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${warn ? 'text-red-600 dark:text-red-400' : good ? 'text-green-600 dark:text-green-400' : 'text-slate-800 dark:text-slate-100'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}
