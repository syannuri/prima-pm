import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Button, Card, Spinner, Badge, SectionTitle } from './ui';
import { useToast } from './Toast';
import { formatNum } from '../lib/format';
import GuestAiNote, { useIsGuest } from './GuestAiNote';

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
  earnedMandays: number;
  consumedMandays: number;
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
  summary: { resourceCount: number; overAllocatedCount: number; totalPlanMandays: number; totalEarnedMandays: number; totalConsumedMandays: number };
}

// earned ÷ planned as a whole-number %, guarding divide-by-zero.
function earnedPct(earned: number, planned: number): number {
  return planned > 0 ? Math.round((earned / planned) * 100) : 0;
}

// Labour efficiency = earned ÷ consumed (a "CPI" for effort). Null when no timesheet.
function efficiency(earned: number, consumed: number): number | null {
  return consumed > 0 ? Math.round((earned / consumed) * 100) / 100 : null;
}
function effClass(e: number | null): string {
  if (e == null) return 'text-slate-400';
  return e >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400';
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
  const [roleF, setRoleF] = useState('');
  const [projF, setProjF] = useState('');
  const [onlyOver, setOnlyOver] = useState(false);

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
  const roles = Array.from(new Set(resources.map((r) => r.personnelRole).filter(Boolean))).sort() as string[];
  const projectCodes = Array.from(new Set(resources.flatMap((r) => r.projects.map((p) => p.code)))).sort();
  const filtered = resources.filter((r) =>
    (!roleF || r.personnelRole === roleF) &&
    (!projF || r.projects.some((p) => p.code === projF)) &&
    (!onlyOver || r.overAllocated));

  return (
    <div className="space-y-4">
      <SectionTitle sub="Cross-project resource allocation & over-allocation over time (from manpower linked to tasks)">Resource Utilization</SectionTitle>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Resources" value={String(summary.resourceCount)} />
          <Kpi label="Over-allocated" value={String(summary.overAllocatedCount)} warn={summary.overAllocatedCount > 0} />
          <Kpi label="Planned m-d" value={formatNum(summary.totalPlanMandays, 0)} />
          <Kpi label="Earned m-d" value={`${formatNum(summary.totalEarnedMandays, 0)} · ${earnedPct(summary.totalEarnedMandays, summary.totalPlanMandays)}%`} />
          <Kpi label="Consumed m-d" value={formatNum(summary.totalConsumedMandays, 0)} />
          <Kpi label="Efficiency" value={efficiency(summary.totalEarnedMandays, summary.totalConsumedMandays)?.toFixed(2) ?? '—'} />
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

      {/* Filters — role · project · only over-allocated (client-side over the fetched report). */}
      {resources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={roleF} onChange={(e) => setRoleF(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
            <option value="">All roles</option>
            {roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={projF} onChange={(e) => setProjF(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
            <option value="">All projects</option>
            {projectCodes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={onlyOver} onChange={(e) => setOnlyOver(e.target.checked)} className="h-3.5 w-3.5 accent-brand-600" />Only over-allocated
          </label>
          {(roleF || projF || onlyOver) && <button onClick={() => { setRoleF(''); setProjF(''); setOnlyOver(false); }} className="text-xs text-brand-600 hover:underline dark:text-brand-400">Clear</button>}
          <span className="ml-auto text-xs text-slate-400">{filtered.length} of {resources.length} resources</span>
        </div>
      )}

      {/* Availability finder — who has free capacity in a chosen period (respects role/project filters). */}
      {resources.length > 0 && <AvailabilityFinder resources={filtered} periods={periods} granularity={granularity} />}

      <Card>
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-slate-500 dark:text-slate-400">
            {resources.length === 0
              ? 'No scheduled manpower yet. Assign man-days to schedule tasks in the Cost & Schedule tabs to see capacity.'
              : 'No resources match the current filters.'}
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
                {filtered.map((r) => (
                  <tr key={r.key} className="align-top">
                    <td className="sticky left-0 z-10 max-w-[16rem] bg-white dark:bg-slate-900 py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-700 dark:text-slate-200">{r.name}</span>
                        {r.overAllocated && <Badge color="red">over</Badge>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        Earned <span className="font-semibold text-slate-700 dark:text-slate-200">{formatNum(r.earnedMandays, 1)}</span> / {formatNum(r.totalPlanMandays, 0)} md
                        <span className="text-brand-600 dark:text-brand-400"> ({earnedPct(r.earnedMandays, r.totalPlanMandays)}%)</span>
                        {r.consumedMandays > 0 && (
                          <>
                            {' · '}Consumed <span className="font-semibold text-slate-700 dark:text-slate-200">{formatNum(r.consumedMandays, 1)}</span> md
                            {' · '}Eff <span className={`font-semibold ${effClass(efficiency(r.earnedMandays, r.consumedMandays))}`}>{efficiency(r.earnedMandays, r.consumedMandays)?.toFixed(2)}</span>
                          </>
                        )}
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

      <ResourceConflicts granularity={granularity} />
    </div>
  );
}

// ---- Availability finder — who has spare capacity in a chosen period ----------------------------
function AvailabilityFinder({ resources, periods, granularity }: { resources: ResourceRow[]; periods: string[]; granularity: Granularity }) {
  const nowKey = new Date().toISOString().slice(0, 7);
  const defP = periods.find((p) => p.startsWith(nowKey)) ?? periods.find((p) => p >= nowKey) ?? periods[0] ?? '';
  const [period, setPeriod] = useState('');
  if (periods.length === 0) return null;
  const sel = periods.includes(period) ? period : defP;
  const free = resources
    .map((r) => { const c = r.cells.find((x) => x.period === sel); const cap = c?.capacity ?? 0; return { r, free: cap - (c?.allocated ?? 0), cap, util: c?.utilization ?? 0 }; })
    .filter((x) => x.cap > 0 && x.free > 0.01)
    .sort((a, b) => b.free - a.free);
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Who&apos;s available?</h3>
          <p className="text-[11px] text-slate-400">Spare capacity in the selected period (respects the filters above).</p>
        </div>
        <select value={sel} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
          {periods.map((p) => <option key={p} value={p}>{periodLabel(p, granularity)}</option>)}
        </select>
      </div>
      {free.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">No spare capacity in {periodLabel(sel, granularity)} for the current filters.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {free.slice(0, 10).map(({ r, free: f, util }) => (
            <li key={r.key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-sm dark:border-slate-800">
              <span className="min-w-0 truncate"><span className="font-medium text-slate-700 dark:text-slate-200">{r.name}</span>{r.personnelRole && <span className="ml-1 text-[11px] text-slate-400">{r.personnelRole}</span>}</span>
              <span className="shrink-0 text-xs"><b className="text-emerald-600 dark:text-emerald-400">{formatNum(f, 1)} md free</b> <span className="text-slate-400">({formatNum(util * 100, 0)}% used)</span></span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---- Over-allocation conflicts + AI reallocation ------------------------------------------------
interface Contribution { costItemId: string; taskName: string; projectId: string; projectCode: string; planMandaysInPeriod: number }
interface Conflict {
  resourceKey: string; resourceName: string; personnelRole: string | null; period: string;
  allocated: number; capacity: number; utilization: number; overBy: number;
  contributions: Contribution[]; candidates: { resourceId: string; name: string }[];
}
interface Move { costItemId: string; toResourceId: string; toResourceName: string; taskName: string; fromResourceName: string; projectId: string; rationale: string }
interface ReallocDraft { summary: string; moves: Move[]; confidence?: string }

const conflictId = (c: Conflict) => `${c.resourceKey}|${c.period}`;

// Deterministic over-allocation list + an AI-drafted reallocation per conflict; each suggested move
// can be PROPOSED (Stage C → approval → REASSIGN_MANPOWER). Nothing changes without approval.
function ResourceConflicts({ granularity }: { granularity: Granularity }) {
  const toast = useToast();
  const isGuest = useIsGuest();
  const [drafts, setDrafts] = useState<Record<string, ReallocDraft>>({});

  const { data } = useQuery({
    queryKey: ['resource-conflicts', granularity],
    queryFn: () => api.get<{ conflicts: Conflict[]; aiAvailable: boolean }>(`/resources/conflicts?granularity=${granularity}`),
  });
  const draft = useMutation({
    mutationFn: (c: Conflict) => api.post<ReallocDraft>('/resources/conflicts/ai-draft', c),
    onSuccess: (d, c) => setDrafts((p) => ({ ...p, [conflictId(c)]: d })),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'AI could not draft a reallocation.'),
  });
  const propose = useMutation({
    mutationFn: (m: Move) => api.post(`/projects/${m.projectId}/ai-actions/propose`, {
      actionType: 'REASSIGN_MANPOWER', params: { costItemId: m.costItemId, toResourceId: m.toResourceId }, rationale: m.rationale,
    }),
    onSuccess: () => toast.success('Reallocation proposed — runs only after approval.'),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to propose the reallocation.'),
  });

  if (!data || data.conflicts.length === 0) return null;

  return (
    <Card className="border-red-200 dark:border-red-900/40">
      <SectionTitle sub="A resource booked beyond capacity in a period. Reassign work to a lighter-loaded peer — proposals need approval before anything changes.">Over-allocation conflicts</SectionTitle>
      {!data.aiAvailable && isGuest && <GuestAiNote className="mt-1" />}
      <div className="mt-3 space-y-3">
        {data.conflicts.map((c) => {
          const id = conflictId(c);
          const d = drafts[id];
          return (
            <div key={id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{c.resourceName}</span>
                  <span className="text-slate-500 dark:text-slate-400"> · {periodLabel(c.period, granularity)} · </span>
                  <span className="font-medium text-red-600">{formatNum(c.allocated, 1)}/{c.capacity} md ({formatNum(c.utilization * 100, 0)}%)</span>
                </div>
                {data.aiAvailable && (
                  <Button variant="secondary" className="!py-1 text-xs" disabled={draft.isPending && draft.variables === c} onClick={() => draft.mutate(c)}>
                    {draft.isPending && draft.variables === c ? 'Drafting…' : '✨ Suggest fix with AI'}
                  </Button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {c.contributions.map((x) => (
                  <span key={x.costItemId} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {x.projectCode} · {x.taskName} · {formatNum(x.planMandaysInPeriod, 1)}md
                  </span>
                ))}
              </div>
              {d && (
                <div className="mt-2 rounded-md bg-violet-50 p-2 dark:bg-violet-900/20">
                  <p className="text-xs text-slate-600 dark:text-slate-300">{d.summary}</p>
                  {d.moves.length === 0 ? (
                    <p className="mt-1 text-[11px] text-slate-400">No safe reassignment found — consider shifting dates or adding capacity.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {d.moves.map((m, i) => (
                        <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0 text-xs text-slate-700 dark:text-slate-200">
                            Move <span className="font-medium">{m.taskName}</span> → <span className="font-medium">{m.toResourceName}</span>
                            <span className="text-slate-400"> — {m.rationale}</span>
                          </span>
                          <Button variant="secondary" className="!px-2 !py-0.5 !text-xs shrink-0" disabled={propose.isPending} onClick={() => propose.mutate(m)}>Propose</Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1.5 text-[10px] text-slate-400">Proposals run only after approval.</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
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
