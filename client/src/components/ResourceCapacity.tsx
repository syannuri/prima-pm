import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Card, Spinner, Badge, SectionTitle } from './ui';
import { formatNum } from '../lib/format';

type Granularity = 'month' | 'week';

interface PeriodCell {
  period: string;
  allocated: number;
  capacity: number;
  utilization: number;
  over: boolean;
}
interface ResourceRow {
  key: string;
  name: string;
  personnelRole: string | null;
  totalPlanMandays: number;
  scheduledMandays: number;
  unscheduledMandays: number;
  projects: { code: string; name: string; mandays: number }[];
  cells: PeriodCell[];
  peakUtilization: number;
  overAllocated: boolean;
}
interface CapacityReport {
  granularity: Granularity;
  periods: string[];
  resources: ResourceRow[];
  summary: { resourceCount: number; overAllocatedCount: number; totalPlanMandays: number };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function periodLabel(p: string, g: Granularity): string {
  const [y, m, d] = p.split('-');
  const mon = MONTHS[Number(m) - 1] ?? m;
  return g === 'month' ? `${mon} ${y}` : `${mon} ${Number(d)}`;
}

// Utilization → cell colour. Empty stays neutral; over-allocation is red.
function cellStyle(c: PeriodCell): string {
  if (c.over) return 'bg-red-500 text-white';
  if (c.allocated <= 0) return 'bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-600';
  if (c.utilization > 0.85) return 'bg-amber-400 text-amber-950';
  if (c.utilization > 0.5) return 'bg-emerald-300 text-emerald-950';
  return 'bg-emerald-100 text-emerald-800';
}

function Kpi({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <Card className={warn ? 'border-red-200 bg-red-50' : ''}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${warn ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{value}</div>
    </Card>
  );
}

export default function ResourceCapacity() {
  const [granularity, setGranularity] = useState<Granularity>('month');

  const { data, isLoading } = useQuery({
    queryKey: ['resource-capacity', granularity],
    queryFn: () => api.get<CapacityReport>(`/resources/capacity?granularity=${granularity}`),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (!data) return <Card>Could not load resource capacity.</Card>;

  const { summary, periods, resources } = data;

  return (
    <div className="space-y-4">
      <SectionTitle sub="Cross-project resource allocation & over-allocation over time (from manpower linked to tasks)">Resource Utilization</SectionTitle>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid flex-1 grid-cols-3 gap-3">
          <Kpi label="Resources" value={String(summary.resourceCount)} />
          <Kpi label="Over-allocated" value={String(summary.overAllocatedCount)} warn={summary.overAllocatedCount > 0} />
          <Kpi label="Planned man-days" value={formatNum(summary.totalPlanMandays, 0)} />
        </div>
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5 text-sm">
          {(['month', 'week'] as Granularity[]).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`rounded-md px-3 py-1 capitalize ${
                granularity === g ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {g}ly
            </button>
          ))}
        </div>
      </div>

      <Card>
        {resources.length === 0 ? (
          <p className="py-6 text-center text-slate-500 dark:text-slate-400">
            No scheduled manpower yet. Assign man-days to schedule tasks in the Cost &amp; Schedule tabs to see capacity.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                  <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 py-2 pr-3">Resource</th>
                  <th className="px-2 text-right">Peak</th>
                  {periods.map((p) => (
                    <th key={p} className="px-1 pb-2 text-center font-medium">
                      {periodLabel(p, granularity)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resources.map((r) => (
                  <tr key={r.key} className="align-top">
                    <td className="sticky left-0 z-10 max-w-[16rem] bg-white dark:bg-slate-900 py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-700 dark:text-slate-200">{r.name}</span>
                        {r.overAllocated && <Badge color="red">over</Badge>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {r.projects.map((p) => (
                          <span key={p.code} className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                            {p.code} · {formatNum(p.mandays, 0)}md
                          </span>
                        ))}
                        {r.unscheduledMandays > 0 && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">
                            {formatNum(r.unscheduledMandays, 0)}md unscheduled
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 text-right">
                      <span className={`font-semibold ${r.overAllocated ? 'text-red-600' : 'text-slate-600 dark:text-slate-300'}`}>
                        {formatNum(r.peakUtilization * 100, 0)}%
                      </span>
                    </td>
                    {r.cells.map((c) => (
                      <td key={c.period} className="px-0.5 py-0.5">
                        <div
                          className={`grid h-9 place-items-center rounded text-[11px] font-medium ${cellStyle(c)}`}
                          title={`${periodLabel(c.period, granularity)} — ${formatNum(c.allocated, 1)} / ${c.capacity} md (${formatNum(
                            c.utilization * 100,
                            0,
                          )}%)`}
                        >
                          {c.allocated > 0 ? `${formatNum(c.utilization * 100, 0)}%` : ''}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium">Utilization:</span>
          <Legend className="bg-emerald-100" label="light" />
          <Legend className="bg-emerald-300" label="moderate" />
          <Legend className="bg-amber-400" label="high (>85%)" />
          <Legend className="bg-red-500" label="over-allocated (>100%)" />
          <span className="ml-auto text-slate-500 dark:text-slate-400">% = allocated man-days ÷ available business days in the period</span>
        </div>
      </Card>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-3 w-3 rounded ${className}`} />
      {label}
    </span>
  );
}
