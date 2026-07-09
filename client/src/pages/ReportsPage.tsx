import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project, ProjectReportData } from '../api/types';
import { Badge, Button, Card, EmptyState, Select, Spinner } from '../components/ui';
import { formatIdrShort, formatDate } from '../lib/format';
import DonutChart from '../components/DonutChart';
import ForecastChart from '../components/ForecastChart';
import ExecutiveReport from '../components/ExecutiveReport';
import EvmTrendPanel from './panels/EvmTrendPanel';
import ForecastPanel from './panels/ForecastPanel';

// The Reporting Hub's two-axis model. All four cadences are now wired to the report engine
// (they drive the S-curve granularity + the period label). View = the centralized sub-nav.
type Cadence = 'daily' | 'weekly' | 'monthly' | 'yearly';
type Period = Cadence;
type View = 'executive' | 'project' | 'portfolio' | 'analytics';

const CADENCES: { key: Cadence; label: string; ready: boolean }[] = [
  { key: 'daily', label: 'Daily', ready: true },
  { key: 'weekly', label: 'Weekly', ready: true },
  { key: 'monthly', label: 'Monthly', ready: true },
  { key: 'yearly', label: 'Yearly', ready: true },
];
const NAV: { key: View; label: string; scope: string; desc: string; ready: boolean }[] = [
  { key: 'executive', label: 'Executive', scope: 'Portfolio', desc: 'One-screen portfolio health — RAG heatmap across every active project, delivered value and budget performance.', ready: true },
  { key: 'project', label: 'Project Report', scope: 'Single project', desc: 'Formal status report for one project — schedule, cost, task completion & forecast.', ready: true },
  { key: 'portfolio', label: 'Portfolio', scope: 'Portfolio', desc: 'Roll-up across all projects — aggregate SPI/CPI, budget vs actual, and per-project status table.', ready: false },
  { key: 'analytics', label: 'Analytics', scope: 'Single project', desc: 'Deep analytics surfaced centrally — EVM trend and forecast for any project, without leaving the reporting hub.', ready: true },
];

const HEALTH: Record<string, { color: string; label: string }> = {
  GREEN: { color: 'green', label: 'On track' },
  AMBER: { color: 'amber', label: 'At risk' },
  RED: { color: 'red', label: 'Behind' },
  NO_DATA: { color: 'slate', label: 'No data' },
};

export default function ReportsPage() {
  const [view, setView] = useState<View>('project');
  const [projectId, setProjectId] = useState('');
  const [cadence, setCadence] = useState<Cadence>('weekly');
  const period: Period = cadence; // cadence maps 1:1 to the report engine's period

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ projects: Project[] }>('/projects') });
  // Only reportable projects (a report needs a committed charter / real state); exclude drafts.
  const projects = useMemo(() => (projectsQ.data?.projects ?? []).filter((p) => p.status !== 'DRAFT'), [projectsQ.data]);
  const selected = projectId || projects[0]?.id || '';
  const activeNav = NAV.find((n) => n.key === view)!;

  const reportQ = useQuery({
    queryKey: ['report', selected, period],
    queryFn: () => api.get<ProjectReportData>(`/projects/${selected}/report?period=${period}`),
    enabled: view === 'project' && !!selected,
  });
  const r = reportQ.data;

  const download = () => {
    if (view === 'project') {
      api.download(`/projects/${selected}/report/pdf?period=${period}`, `${r?.project.code ?? 'project'}_${period}_report.pdf`);
    } else {
      api.download('/portfolio/export/pdf', 'portfolio_report.pdf'); // Executive/Portfolio share the portfolio export.
    }
  };
  const downloadExcel = () => api.download('/portfolio/export/excel', 'portfolio_report.xlsx'); // Executive portfolio export.
  const canDownload = view === 'project' ? !!selected && !!r : view === 'executive';

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Reports</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Central reporting hub — pick a scope and cadence, view on screen, then export. One place for every report.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[13rem_1fr]">
        {/* Hub sub-nav */}
        <nav aria-label="Report views" className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
          {NAV.map((n) => {
            const active = n.key === view;
            return (
              <button key={n.key} onClick={() => setView(n.key)} aria-current={active ? 'page' : undefined}
                className={`flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                  active
                    ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200 dark:bg-brand-900/30 dark:text-brand-300 dark:ring-brand-800'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}>
                <span>{n.label}</span>
                {!n.ready && <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-700 dark:text-slate-300">Soon</span>}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 space-y-5">
          {/* Control bar: Scope × Cadence × Export */}
          <Card className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Scope</span>
                {activeNav.scope === 'Single project' && projects.length > 0 ? (
                  <Select value={selected} onChange={(e) => setProjectId(e.target.value)} className="min-w-[16rem]">
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </Select>
                ) : (
                  <div className="inline-flex h-[38px] items-center rounded-lg border border-slate-200 px-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                    {activeNav.scope === 'Portfolio' ? '🏢 All projects (portfolio)' : '— no project —'}
                  </div>
                )}
              </div>
              <div>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Cadence</span>
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                  {CADENCES.map((c) => (
                    <button key={c.key} onClick={() => c.ready && setCadence(c.key)} disabled={!c.ready}
                      title={c.ready ? c.label : `${c.label} — coming soon`}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                        cadence === c.key ? 'bg-brand-600 text-white shadow-sm'
                          : c.ready ? 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                          : 'cursor-not-allowed text-slate-300 dark:text-slate-600'
                      }`}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={!canDownload} onClick={download}>⬇ PDF</Button>
              {view === 'executive' && <Button variant="secondary" disabled={!canDownload} onClick={downloadExcel}>⬇ Excel</Button>}
            </div>
          </Card>

          {/* Project Report — the built view */}
          {view === 'project' && (
            <>
              {!projects.length && !projectsQ.isLoading && (
                <EmptyState title="No projects to report on" hint="Commit a project charter first — reports need a project past the draft stage." />
              )}
              {reportQ.isLoading && <div className="flex justify-center py-16"><Spinner /></div>}
              {r && <ReportBody r={r} />}
            </>
          )}

          {/* Executive — portfolio health overview (built). */}
          {view === 'executive' && <ExecutiveReport />}

          {/* Analytics — deep per-project analytics, centralized (built). */}
          {view === 'analytics' && (
            projects.length ? <AnalyticsView projectId={selected} />
              : <EmptyState title="No projects to analyze" hint="Analytics needs a project past the draft stage." />
          )}

          {/* Not-yet-built views — describe the target so the IA is legible. */}
          {view === 'portfolio' && <ComingSoon nav={activeNav} />}
        </div>
      </div>
    </div>
  );
}

// Centralized deep analytics: the same per-project panels used inside the project workspace,
// reachable from the hub with a project picker. A sub-tab switches lens (each panel self-fetches).
function AnalyticsView({ projectId }: { projectId: string }) {
  const [lens, setLens] = useState<'evm' | 'forecast'>('evm');
  const LENSES = [{ k: 'evm', label: 'EVM Trend' }, { k: 'forecast', label: 'Forecast' }] as const;
  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
        {LENSES.map((l) => (
          <button key={l.k} onClick={() => setLens(l.k)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${lens === l.k ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>
            {l.label}
          </button>
        ))}
      </div>
      {lens === 'evm' && <EvmTrendPanel projectId={projectId} />}
      {lens === 'forecast' && <ForecastPanel projectId={projectId} />}
    </div>
  );
}

function ComingSoon({ nav }: { nav: (typeof NAV)[number] }) {
  return (
    <Card className="flex flex-col items-center gap-3 py-14 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-2xl dark:bg-brand-900/30">📊</div>
      <div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{nav.label} report</h2>
        <Badge color="slate">Coming soon</Badge>
      </div>
      <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">{nav.desc}</p>
      <p className="text-xs text-slate-400">Scope: {nav.scope} · part of the centralized Reporting Hub</p>
    </Card>
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
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Project Status Report · {r.period.charAt(0).toUpperCase() + r.period.slice(1)}</div>
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
