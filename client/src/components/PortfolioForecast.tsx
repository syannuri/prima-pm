import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PortfolioSummary } from '../api/types';
import { Card, Input, SectionTitle, Spinner } from './ui';
import { formatIdr, formatIdrShort, formatDateInput, formatNum } from '../lib/format';

// Portfolio-level forecast: roll up each project's likely EAC (BAC ÷ CPI) into a
// projected total cost, variance and final margin — computed from the same
// /portfolio/summary the EVM view uses, so no extra endpoint is needed.
export default function PortfolioForecast() {
  const [statusDate, setStatusDate] = useState(formatDateInput(new Date()));
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio', statusDate],
    queryFn: () => api.get<PortfolioSummary>(`/portfolio/summary?statusDate=${statusDate}`),
  });
  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  const rows = data?.projects ?? [];

  const fc = rows.map((p) => {
    const hasData = p.ac > 0 || p.ev > 0;
    const hasRevenue = p.revenue > 0; // no contract value entered → excluded from margin roll-up
    // EAC band mirrors the single-project forecast (eacScenarios): likely = BAC ÷ CPI, worst =
    // cost & schedule drag both continue. Keeps portfolio margin consistent with the project tab.
    const { likely: eac, worst: eacWorst } = eacBand(p.bac, p.ev, p.ac, p.cpi, p.spi);
    return { ...p, hasData, hasRevenue, eac, eacWorst, over: eac - p.bac, projMargin: p.revenue - eac, worstMargin: p.revenue - eacWorst, plannedMargin: p.revenue - p.bac };
  });
  const sum = (f: (x: (typeof fc)[number]) => number) => fc.reduce((s, x) => s + f(x), 0);
  // Operational cost totals span every project…
  const totBac = sum((x) => x.bac);
  const totEac = sum((x) => x.eac);
  const overBudget = totEac > totBac + 0.5;
  // …but margins only aggregate projects that HAVE a contract value — otherwise a project with
  // cost and no revenue set drags the whole portfolio into a phantom loss (the same false-loss
  // guard as the project forecast, applied to the roll-up).
  const rev = fc.filter((x) => x.hasRevenue);
  const hasAnyRevenue = rev.length > 0;
  const totRev = rev.reduce((s, x) => s + x.revenue, 0);
  const plannedMargin = totRev - rev.reduce((s, x) => s + x.bac, 0);
  const projMargin = totRev - rev.reduce((s, x) => s + x.eac, 0);
  const worstMargin = totRev - rev.reduce((s, x) => s + x.eacWorst, 0);
  const pctOf = (m: number) => (totRev > 0 ? `${m > 0 ? '+' : ''}${formatNum((m / totRev) * 100, 1)}%` : null);
  const overruns = fc.filter((x) => x.hasData && (x.over > 0.5 || (x.spi > 0 && x.spi < 0.98))).sort((a, b) => b.over - a.over);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle sub="Projected outcome of the whole portfolio from current cost & schedule performance (likely EAC = BAC ÷ CPI).">Portfolio forecast</SectionTitle>
        <label className="text-xs text-slate-500 dark:text-slate-400">
          <span className="mr-2 uppercase tracking-wide">Status date</span>
          <Input type="date" value={statusDate} onChange={(e) => setStatusDate(e.target.value)} className="!w-40 !py-1.5" />
        </label>
      </div>

      {/* Headline strip */}
      <Card className="overflow-hidden !p-0">
        <div className="flex divide-x divide-slate-200 overflow-x-auto dark:divide-slate-800">
          <Cell label="Total BAC" value={formatIdrShort(totBac)} title={formatIdr(totBac)} />
          <Cell label="Forecast EAC" value={formatIdrShort(totEac)} title={formatIdr(totEac)} warn={overBudget} />
          <Cell label="Variance (VAC)" value={formatIdrShort(totBac - totEac)} title={formatIdr(totBac - totEac)} warn={overBudget} />
          <Cell label="Planned margin" value={hasAnyRevenue ? formatIdrShort(plannedMargin) : '—'} sub={hasAnyRevenue ? pctOf(plannedMargin) : undefined} title={hasAnyRevenue ? formatIdr(plannedMargin) : 'No contract value set'} />
          <Cell label="Projected margin" value={hasAnyRevenue ? formatIdrShort(projMargin) : '—'} sub={hasAnyRevenue ? pctOf(projMargin) : undefined} title={hasAnyRevenue ? formatIdr(projMargin) : 'No contract value set'} warn={hasAnyRevenue && projMargin < plannedMargin - 0.5} strong />
          <Cell label="Worst case" value={hasAnyRevenue ? formatIdrShort(worstMargin) : '—'} sub={hasAnyRevenue ? pctOf(worstMargin) : undefined} title={hasAnyRevenue ? formatIdr(worstMargin) : 'No contract value set'} warn={hasAnyRevenue && worstMargin < 0} />
        </div>
      </Card>
      {hasAnyRevenue && rev.length < fc.length && (
        <p className="-mt-2 px-1 text-[11px] text-slate-400 dark:text-slate-500">
          Margins cover the {rev.length} of {fc.length} project{fc.length === 1 ? '' : 's'} with a contract value set; BAC/EAC totals span all.
        </p>
      )}

      {/* Projects forecast to overrun */}
      <Card>
        <SectionTitle sub="Projects trending over budget or behind schedule at this status date.">Forecast to overrun</SectionTitle>
        {overruns.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">No projects are forecast to overrun. 🎉</p>
        ) : (
          <ul className="space-y-2">
            {overruns.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-100 p-2.5 dark:border-slate-800">
                <Link to={`/projects/${p.id}`} className="min-w-0 flex-1">
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{p.code}</span>{' '}
                  <span className="text-sm text-brand-600 hover:underline">{p.name}</span>
                </Link>
                {p.over > 0.5 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/20 dark:text-red-400" title={formatIdr(p.over)}>▲ {formatIdrShort(p.over)} over</span>}
                {p.spi > 0 && p.spi < 0.98 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">behind · SPI {formatNum(p.spi, 2)}</span>}
                {p.hasRevenue && <span className="text-xs text-slate-500 dark:text-slate-400">margin {formatIdrShort(p.projMargin)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Full forecast table */}
      <Card>
        <SectionTitle sub="Likely estimate at completion and projected margin per project.">All projects</SectionTitle>
        <div className="overflow-x-auto">
          <table className="prima-rows w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <th className="py-2">Project</th><th className="text-right">BAC</th><th className="text-right">Forecast EAC</th>
                <th className="text-right">VAC</th><th className="text-right">Proj. margin</th><th className="text-right">CPI · SPI</th>
              </tr>
            </thead>
            <tbody>
              {fc.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2">
                    <Link to={`/projects/${p.id}`} className="font-mono text-xs text-brand-600 hover:underline">{p.code}</Link>
                    <div className="max-w-[12rem] truncate text-xs text-slate-500 dark:text-slate-400">{p.name}</div>
                  </td>
                  <td className="py-2 text-right tabular-nums">{p.hasData ? formatIdrShort(p.bac) : '—'}</td>
                  <td className={`py-2 text-right tabular-nums font-medium ${p.over > 0.5 ? 'text-red-600 dark:text-red-400' : ''}`}>{p.hasData ? formatIdrShort(p.eac) : '—'}</td>
                  <td className={`py-2 text-right tabular-nums ${p.over > 0.5 ? 'text-red-600 dark:text-red-400' : p.over < -0.5 ? 'text-green-600 dark:text-green-400' : ''}`}>{p.hasData ? formatIdrShort(-p.over) : '—'}</td>
                  <td className="py-2 text-right tabular-nums">{p.revenue ? formatIdrShort(p.projMargin) : '—'}</td>
                  <td className="py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{p.hasData ? `${formatNum(p.cpi, 2)} · ${formatNum(p.spi, 2)}` : '—'}</td>
                </tr>
              ))}
              {!fc.length && <tr><td colSpan={6} className="py-4 text-center text-slate-400 dark:text-slate-500">No projects.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Cell({ label, value, sub, title, warn, strong }: { label: string; value: string; sub?: string | null; title?: string; warn?: boolean; strong?: boolean }) {
  return (
    <div className="min-w-[8rem] flex-1 px-3.5 py-2.5">
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div title={title} className={`mt-0.5 truncate text-base tabular-nums ${warn ? 'font-semibold text-red-600 dark:text-red-400' : strong ? 'font-bold text-slate-900 dark:text-white' : 'font-semibold text-slate-800 dark:text-slate-100'}`}>
        {value}{sub && <span className="ml-1 text-[11px] font-normal text-slate-400 dark:text-slate-500">{sub}</span>}
      </div>
    </div>
  );
}

// Per-project EAC band, identical maths to the server's eacScenarios (forecast.service.ts):
// likely = current cost trend (BAC ÷ CPI); worst = cost & schedule drag both continue.
function eacBand(bac: number, ev: number, ac: number, cpi: number, spi: number) {
  const planRest = ac + (bac - ev);
  const trend = cpi > 0 ? bac / cpi : bac;
  const scpi = cpi * spi;
  const both = scpi > 0 ? ac + (bac - ev) / scpi : trend;
  return { likely: trend, worst: Math.max(planRest, trend, both) };
}
