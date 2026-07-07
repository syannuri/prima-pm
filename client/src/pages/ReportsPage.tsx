import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project, ProjectReportData } from '../api/types';
import { Badge, Button, Card, EmptyState, Select, Spinner } from '../components/ui';
import { formatIdrShort, formatDate } from '../lib/format';
import DonutChart from '../components/DonutChart';
import ForecastChart from '../components/ForecastChart';

type Period = 'weekly' | 'monthly';
const HEALTH: Record<string, { color: string; label: string }> = {
  GREEN: { color: 'green', label: 'On track' },
  AMBER: { color: 'amber', label: 'At risk' },
  RED: { color: 'red', label: 'Behind' },
  NO_DATA: { color: 'slate', label: 'No data' },
};

export default function ReportsPage() {
  const [projectId, setProjectId] = useState('');
  const [period, setPeriod] = useState<Period>('weekly');

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ projects: Project[] }>('/projects') });
  // Only reportable projects (a report needs a committed charter / real state); exclude drafts.
  const projects = useMemo(() => (projectsQ.data?.projects ?? []).filter((p) => p.status !== 'DRAFT'), [projectsQ.data]);
  const selected = projectId || projects[0]?.id || '';

  const reportQ = useQuery({
    queryKey: ['report', selected, period],
    queryFn: () => api.get<ProjectReportData>(`/projects/${selected}/report?period=${period}`),
    enabled: !!selected,
  });
  const r = reportQ.data;

  const download = () =>
    api.download(`/projects/${selected}/report/pdf?period=${period}`, `${r?.project.code ?? 'project'}_${period}_report.pdf`);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Reports</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Professional project status report — schedule, cost, task completion and forecast, as a weekly or monthly view.
        </p>
      </div>

      {/* Controls */}
      <Card className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Project</span>
            <Select value={selected} onChange={(e) => setProjectId(e.target.value)} className="min-w-[16rem]">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </Select>
          </label>
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Period</span>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
              {(['weekly', 'monthly'] as Period[]).map((pd) => (
                <button key={pd} onClick={() => setPeriod(pd)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${period === pd ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>
                  {pd === 'weekly' ? 'Weekly' : 'Monthly'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Button variant="secondary" disabled={!selected || !r} onClick={download}>⬇ Download PDF</Button>
      </Card>

      {!projects.length && !projectsQ.isLoading && (
        <EmptyState title="No projects to report on" hint="Commit a project charter first — reports need a project past the draft stage." />
      )}
      {reportQ.isLoading && <div className="flex justify-center py-16"><Spinner /></div>}

      {r && <ReportBody r={r} />}
    </div>
  );
}

function ReportBody({ r }: { r: ProjectReportData }) {
  const h = HEALTH[r.health] ?? HEALTH.NO_DATA;
  const e = r.evm;
  const f = r.forecast;
  const byCount = r.tasks.total ? Math.round((r.tasks.completed / r.tasks.total) * 100) : 0;

  const slices = [
    { label: 'Completed', value: r.tasks.completed, color: '#16a34a', items: [] as string[] },
    { label: 'In progress', value: r.tasks.inProgress, color: '#f59e0b', items: [] },
    { label: 'Not started', value: r.tasks.notStarted, color: '#94a3b8', items: [] },
  ].filter((s) => s.value > 0);

  return (
    <div className="space-y-5">
      {/* Report header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Project Status Report · {r.period === 'weekly' ? 'Weekly' : 'Monthly'}</div>
            <h2 className="mt-0.5 text-xl font-bold text-slate-800 dark:text-slate-100">{r.project.code} — {r.project.name}</h2>
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              PM {r.project.pmName} · {r.periodLabel} · as of {formatDate(r.asOf)}
            </div>
          </div>
          <div className="text-right">
            <Badge color={h.color}>● {h.label}</Badge>
            <div className="mt-1 text-3xl font-extrabold tabular-nums text-slate-800 dark:text-white">{r.tasks.weightedPct}%</div>
            <div className="text-[11px] uppercase tracking-wide text-slate-400">complete</div>
          </div>
        </div>
        {/* KPI strip */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Tasks done" value={`${r.tasks.completed}/${r.tasks.total}`} sub={`${byCount}% by count`} />
          <Kpi label="SPI" value={e.pv > 0 ? e.spi.toFixed(2) : '—'} warn={e.pv > 0 && e.spi < 1} good={e.pv > 0 && e.spi >= 1} sub="schedule" />
          <Kpi label="CPI" value={e.ac > 0 ? e.cpi.toFixed(2) : '—'} warn={e.ac > 0 && e.cpi < 1} good={e.ac > 0 && e.cpi >= 1} sub="cost" />
          <Kpi label="BAC" value={formatIdrShort(e.bac)} sub="budget" />
          <Kpi label="EAC (likely)" value={formatIdrShort(f.eac.likely)} sub="forecast cost" warn={f.eac.likely > e.bac} />
          <Kpi label="Forecast finish" value={f.schedule.forecastFinish ? formatDate(f.schedule.forecastFinish) : '—'}
            sub={f.schedule.varianceDays != null ? `${f.schedule.varianceDays > 0 ? '+' : ''}${f.schedule.varianceDays}d vs plan` : 'schedule'}
            warn={(f.schedule.varianceDays ?? 0) > 0} good={(f.schedule.varianceDays ?? 0) < 0} />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Task completion */}
        <Card>
          <SectionHead title="Task completion" sub="Completed vs uncompleted work packages" />
          <div className="flex flex-wrap items-center gap-4">
            {slices.length > 0 ? <DonutChart title="" slices={slices} unit="tasks" /> : <p className="text-sm text-slate-500">No work packages.</p>}
            <div className="space-y-1.5 text-sm">
              <Legend color="#16a34a" label="Completed" value={r.tasks.completed} />
              <Legend color="#f59e0b" label="In progress" value={r.tasks.inProgress} />
              <Legend color="#94a3b8" label="Not started" value={r.tasks.notStarted} />
              <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                <div className="text-xs text-slate-500 dark:text-slate-400">By task count: <span className="font-semibold text-slate-700 dark:text-slate-200">{byCount}%</span></div>
                <div className="text-xs text-slate-500 dark:text-slate-400">By weighted value: <span className="font-semibold text-slate-700 dark:text-slate-200">{r.tasks.weightedPct}%</span></div>
              </div>
            </div>
          </div>
          {r.tasks.remaining.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Remaining / uncompleted ({r.tasks.remaining.length})</div>
              <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
                {r.tasks.remaining.map((t, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{t.isMilestone && <span className="text-brand-600">◆ </span>}{t.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {t.overdue && <Badge color="red">Overdue</Badge>}
                      <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{t.pct}% · {formatDate(t.planEnd)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* EVM S-curve chart */}
        <Card>
          <SectionHead title="Project chart — EVM S-curve" sub={`Planned value, actual cost & forecast (${r.period})`} />
          {f.sCurve.length ? <ForecastChart data={f} /> : <p className="py-8 text-center text-sm text-slate-500">Not enough schedule/cost data to chart yet.</p>}
        </Card>
      </div>

      {/* Forecast */}
      <Card>
        <SectionHead title="Forecast" sub="Estimate at completion, schedule projection & margin" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="EAC — optimistic" value={formatIdrShort(f.eac.optimistic)} sub="remaining to plan" />
          <Kpi label="EAC — likely" value={formatIdrShort(f.eac.likely)} sub="BAC ÷ CPI" warn={f.eac.likely > e.bac} />
          <Kpi label="EAC — pessimistic" value={formatIdrShort(f.eac.pessimistic)} sub="cost + schedule drag" />
          <Kpi label="ETC" value={formatIdrShort(f.etc)} sub="est. to complete" />
          <Kpi label="VAC" value={formatIdrShort(f.vac)} sub="variance at completion" warn={f.vac < 0} good={f.vac > 0} />
          <Kpi label="TCPI" value={f.bac > f.ac ? f.tcpi.toFixed(2) : '—'} sub="to-complete index" warn={f.bac > f.ac && f.tcpi > 1} />
          <Kpi label="Planned finish" value={f.schedule.plannedFinish ? formatDate(f.schedule.plannedFinish) : '—'} sub="baseline" />
          <Kpi label="Projected margin" value={f.margin.revenue > 0 ? formatIdrShort(f.margin.projected) : '—'} sub="at likely EAC" warn={f.margin.projected < 0} good={f.margin.revenue > 0 && f.margin.projected >= 0} />
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          “% complete (weighted)” is the EVM roll-up — it reflects budget &amp; effort, so it can differ from a simple task count when work packages carry uneven cost.
        </p>
      </Card>
    </div>
  );
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

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span className="ml-auto font-semibold tabular-nums text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>
    </div>
  );
}
