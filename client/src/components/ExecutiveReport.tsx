import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PortfolioSummary, PortfolioRow, PortfolioHealth } from '../api/types';
import { Card, EmptyState, Spinner } from './ui';
import { formatIdrShort, formatDate } from '../lib/format';

// One-screen portfolio health for leadership: a KPI band, a RAG distribution bar, and a
// heatmap of every active project sorted worst-first. Read-only; reuses GET /portfolio/summary
// (the same aggregate the dashboard EVM view uses) so there's no new endpoint or health rule.
const RAG: Record<PortfolioHealth, { c: string; label: string }> = {
  GREEN: { c: '#16a34a', label: 'On track' },
  AMBER: { c: '#f59e0b', label: 'At risk' },
  RED: { c: '#dc2626', label: 'Off track' },
  NO_DATA: { c: '#94a3b8', label: 'No data' },
};
const RANK: Record<PortfolioHealth, number> = { RED: 0, AMBER: 1, GREEN: 2, NO_DATA: 3 };

export default function ExecutiveReport() {
  const q = useQuery({ queryKey: ['portfolio-summary'], queryFn: () => api.get<PortfolioSummary>('/portfolio/summary') });

  if (q.isLoading) return <div className="flex justify-center py-16"><Spinner /></div>;
  const s = q.data;
  if (!s || s.projects.length === 0)
    return <EmptyState title="No active projects" hint="The executive view rolls up every project past the draft stage — commit a charter to see it here." />;

  const t = s.totals;
  const rows = [...s.projects].sort((a, b) => RANK[a.health] - RANK[b.health] || a.spi - b.spi);
  const spiOff = t.pv > 0 && t.spi < 1;
  const cpiOff = t.ac > 0 && t.cpi < 1;

  return (
    <div className="space-y-5">
      {/* Report header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Executive Report · Portfolio Health</div>
            <h2 className="mt-0.5 text-xl font-bold text-slate-800 dark:text-slate-100">All active projects</h2>
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t.count} project{t.count === 1 ? '' : 's'} · as of {formatDate(s.statusDate)}</div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-extrabold tabular-nums text-slate-800 dark:text-white">{Math.round(t.percentComplete * 100)}%</div>
            <div className="text-[11px] uppercase tracking-wide text-slate-400">weighted complete</div>
          </div>
        </div>

        {/* KPI band */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Active projects" value={String(t.count)} sub={`${s.byHealth.RED} off track`} warn={s.byHealth.RED > 0} />
          <Kpi label="Portfolio SPI" value={t.pv > 0 ? t.spi.toFixed(2) : '—'} sub="schedule" warn={spiOff} good={t.pv > 0 && t.spi >= 1} />
          <Kpi label="Portfolio CPI" value={t.ac > 0 ? t.cpi.toFixed(2) : '—'} sub="cost" warn={cpiOff} good={t.ac > 0 && t.cpi >= 1} />
          <Kpi label="Total BAC" value={formatIdrShort(t.bac)} sub="budget (PMB)" />
          <Kpi label="Earned value" value={formatIdrShort(t.ev)} sub={`of ${formatIdrShort(t.bac)}`} />
          <Kpi label="Slipped" value={`${t.slippedCount}/${t.baselinedCount}`} sub={t.worstSlipDays > 0 ? `worst +${t.worstSlipDays}d` : 'on schedule'} warn={t.slippedCount > 0} />
        </div>

        {/* RAG distribution */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-wide">Schedule health (RAG)</span>
            <span className="flex gap-3">
              {(['GREEN', 'AMBER', 'RED', 'NO_DATA'] as PortfolioHealth[]).map((h) => (
                <span key={h} className="inline-flex items-center gap-1"><Dot h={h} />{RAG[h].label} {s.byHealth[h] ?? 0}</span>
              ))}
            </span>
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            {(['GREEN', 'AMBER', 'RED', 'NO_DATA'] as PortfolioHealth[]).map((h) =>
              (s.byHealth[h] ?? 0) > 0 ? <div key={h} style={{ width: `${((s.byHealth[h] ?? 0) / t.count) * 100}%`, backgroundColor: RAG[h].c }} /> : null,
            )}
          </div>
        </div>
      </Card>

      {/* Heatmap — worst-first */}
      <Card>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Project heatmap</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Sorted by schedule health, most at-risk first.</p>
        </div>
        {/* Desktop: table. Mobile (< sm): card list below. */}
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <th className="py-2 pr-3 font-semibold">Project</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Sched</th>
                <th className="px-3 py-2 font-semibold">Cost</th>
                <th className="px-3 py-2 text-right font-semibold">SPI</th>
                <th className="px-3 py-2 text-right font-semibold">CPI</th>
                <th className="px-3 py-2 font-semibold">Complete</th>
                <th className="px-3 py-2 text-right font-semibold">Finish</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <Row key={r.id} r={r} />)}
            </tbody>
          </table>
        </div>

        {/* Mobile card list — table hidden < sm. */}
        <div className="space-y-2 sm:hidden">
          {rows.map((r) => {
            const pct = Math.round(r.percentComplete * 100);
            const v = r.finishVarianceDays;
            return (
              <div key={r.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800 dark:text-slate-100">{r.name}</div>
                    <div className="text-[11px] text-slate-400">{r.code}{r.pm ? ` · ${r.pm}` : ''} · {r.status.replace('_', ' ').toLowerCase()}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400">
                    <span className="flex items-center gap-1">Sched <Dot h={r.health} /></span>
                    <span className="flex items-center gap-1">Cost <Dot h={r.costHealth} /></span>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-xs tabular-nums">
                  <div><div className="text-slate-400">SPI</div><div className={r.pv > 0 && r.spi < 0.95 ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}>{r.pv > 0 ? r.spi.toFixed(2) : '—'}</div></div>
                  <div><div className="text-slate-400">CPI</div><div className={r.ac > 0 && r.cpi < 0.95 ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}>{r.ac > 0 ? r.cpi.toFixed(2) : '—'}</div></div>
                  <div><div className="text-slate-400">Done</div><div className="text-slate-600 dark:text-slate-300">{pct}%</div></div>
                  <div><div className="text-slate-400">Finish</div><div className={v != null && v > 0 ? 'text-red-600 dark:text-red-400' : v != null && v < 0 ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}>{v == null ? '—' : v === 0 ? 'on plan' : `${v > 0 ? '+' : ''}${v}d`}</div></div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Row({ r }: { r: PortfolioRow }) {
  const pct = Math.round(r.percentComplete * 100);
  const v = r.finishVarianceDays;
  return (
    <tr className="border-b border-slate-100 last:border-0 dark:border-slate-800">
      <td className="min-w-0 py-2 pr-3">
        <div className="truncate font-medium text-slate-800 dark:text-slate-100">{r.name}</div>
        <div className="text-[11px] text-slate-400">{r.code}{r.pm ? ` · ${r.pm}` : ''}</div>
      </td>
      <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{r.status.replace('_', ' ').toLowerCase()}</td>
      <td className="px-3 py-2"><Dot h={r.health} /></td>
      <td className="px-3 py-2"><Dot h={r.costHealth} /></td>
      <td className={`px-3 py-2 text-right tabular-nums ${r.pv > 0 && r.spi < 0.95 ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}`}>{r.pv > 0 ? r.spi.toFixed(2) : '—'}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${r.ac > 0 && r.cpi < 0.95 ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}`}>{r.ac > 0 ? r.cpi.toFixed(2) : '—'}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} /></div>
          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{pct}%</span>
        </div>
      </td>
      <td className={`px-3 py-2 text-right text-xs tabular-nums ${v != null && v > 0 ? 'text-red-600 dark:text-red-400' : v != null && v < 0 ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}`}>
        {v == null ? '—' : v === 0 ? 'on plan' : `${v > 0 ? '+' : ''}${v}d`}
      </td>
    </tr>
  );
}

function Dot({ h }: { h: PortfolioHealth }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: RAG[h].c }} title={RAG[h].label} />;
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
