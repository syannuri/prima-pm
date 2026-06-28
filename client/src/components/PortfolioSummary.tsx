import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PortfolioSummary as Summary } from '../api/types';
import { Badge, Card, Field, Input, Spinner } from './ui';
import { formatDateInput, formatIdr, formatNum } from '../lib/format';

const HEALTH_COLOR: Record<string, string> = { GREEN: 'green', AMBER: 'amber', RED: 'red', NO_DATA: 'slate' };
// Human-friendly labels instead of the raw enum (GREEN/NO_DATA/…).
const HEALTH_LABEL: Record<string, string> = { GREEN: 'On track', AMBER: 'At risk', RED: 'Behind', NO_DATA: 'No data' };
const NODATA_HINT = {
  cost: 'No actual cost recorded yet, so CPI cannot be computed',
  sched: 'Project has not started as of the status date',
};

export default function PortfolioSummary() {
  const [statusDate, setStatusDate] = useState(formatDateInput(new Date()));
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio', statusDate],
    queryFn: () => api.get<Summary>(`/portfolio/summary?statusDate=${statusDate}`),
  });

  if (isLoading) {
    return (
      <Card>
        <div className="flex justify-center py-6"><Spinner /></div>
      </Card>
    );
  }
  if (!data || data.totals.count === 0) return null;
  const t = data.totals;
  const spiBehind = t.spi > 0 && t.spi < 1;

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
        <Kpi label="Projects" value={String(t.count)} />
        <Kpi label="Total BAC" value={formatIdr(t.bac)} strong />
        <Kpi label="Earned Value" value={formatIdr(t.ev)} />
        <Kpi label="Actual Cost" value={formatIdr(t.ac)} />
        <Kpi label="Portfolio CPI" value={t.cpi ? formatNum(t.cpi, 2) : '—'} warn={t.cpi > 0 && t.cpi < 1} />
        <Kpi label="Portfolio SPI" value={t.spi ? formatNum(t.spi, 2) : '—'} warn={spiBehind} />
        <Kpi label="% Complete" value={`${formatNum(t.percentComplete * 100, 1)}%`} />
        <Kpi
          label="Schedule slip"
          value={t.baselinedCount === 0 ? '—' : t.slippedCount > 0 ? `${t.slippedCount} late · ${t.worstSlipDays}d` : 'On schedule'}
          warn={t.slippedCount > 0}
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

      {/* Per-project EVM table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-400 dark:text-slate-500">
                <th className="py-2">Project</th><th>Status</th>
                <th className="text-right">BAC</th><th className="text-right">EV</th><th className="text-right">AC</th>
                <th className="text-right">CPI</th><th className="text-right">SPI</th>
                <th className="text-right">% Done</th><th className="text-right" title="Finish variance vs schedule baseline">Var</th><th className="text-right">Cost</th><th className="text-right">Sched.</th>
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
                  <td><Badge color="slate">{p.status}</Badge></td>
                  <td className="text-right">{formatIdr(p.bac)}</td>
                  <td className="text-right">{formatIdr(p.ev)}</td>
                  <td className="text-right">{formatIdr(p.ac)}</td>
                  <td className={`text-right ${p.cpi > 0 && p.cpi < 1 ? 'text-red-600' : ''}`}>{p.cpi ? formatNum(p.cpi, 2) : '—'}</td>
                  <td className={`text-right ${p.spi > 0 && p.spi < 1 ? 'text-red-600' : ''}`}>{p.spi ? formatNum(p.spi, 2) : '—'}</td>
                  <td className="text-right">{formatNum(p.percentComplete * 100, 0)}%</td>
                  <td className="text-right tabular-nums">
                    {p.finishVarianceDays == null ? (
                      <span className="text-slate-300 dark:text-slate-600" title="No baseline">—</span>
                    ) : (
                      <span className={p.finishVarianceDays > 0 ? 'font-medium text-red-600 dark:text-red-400' : p.finishVarianceDays < 0 ? 'font-medium text-green-600 dark:text-green-400' : 'text-slate-400 dark:text-slate-500'}>
                        {p.finishVarianceDays > 0 ? `+${p.finishVarianceDays}d` : p.finishVarianceDays < 0 ? `${p.finishVarianceDays}d` : '0'}
                      </span>
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

function Kpi({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  // Uniform size for every KPI so the longest currency value (Total BAC) can't overflow
  // its narrow card. tabular-nums keeps digits aligned; break-words is overflow insurance.
  const tone = strong
    ? 'font-bold text-brand-700 dark:text-brand-400'
    : warn
      ? 'font-semibold text-red-600 dark:text-red-400'
      : 'font-semibold text-slate-800 dark:text-slate-100';
  return (
    <Card className="!p-3">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-lg leading-tight tabular-nums ${tone}`}>{value}</div>
    </Card>
  );
}
