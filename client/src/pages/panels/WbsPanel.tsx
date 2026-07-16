import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { GanttNode, ResourceItem, TaskDependency, WbsTemplateInfo } from '../../api/types';
import { Badge, Button, Card, Field, Input, Modal, Select, Textarea, SectionTitle, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { formatDate, formatDateInput, formatIdrShort } from '../../lib/format';
import { useProjectWrite } from '../../lib/useProjectWrite';

interface Row {
  node: GanttNode;
  depth: number;
  wbs: string; // outline number, e.g. 1.2.1
}

// Earliest planned start anywhere in a node's subtree (a parent sorts by its first task).
function subtreeStart(node: GanttNode): number {
  let min = +new Date(node.planStart);
  (node.children ?? []).forEach((c) => { min = Math.min(min, subtreeStart(c)); });
  return min;
}

// Flatten the tree into ordered rows and assign hierarchical WBS outline numbers.
// Siblings are ordered chronologically (earliest start first, tie-break on end) so the
// WBS reads top-to-bottom by date — the kick-off / earliest task is #1.
function flatten(nodes: GanttNode[], depth = 0, prefix = '', acc: Row[] = []): Row[] {
  const ordered = [...nodes].sort((a, b) => subtreeStart(a) - subtreeStart(b) || +new Date(a.planEnd) - +new Date(b.planEnd));
  ordered.forEach((node, i) => {
    const wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
    acc.push({ node, depth, wbs });
    if (node.children?.length) flatten(node.children, depth + 1, wbs, acc);
  });
  return acc;
}

function statusOf(pct: number): { label: string; color: string } {
  if (pct >= 100) return { label: 'Completed', color: 'green' };
  if (pct > 0) return { label: 'In progress', color: 'amber' };
  return { label: 'Not started', color: 'slate' };
}

const day = 86_400_000;
type Scale = 'day' | 'week' | 'month';
const PX_PER_DAY: Record<Scale, number> = { day: 22, week: 7, month: 2.4 };

// Summary-task roll-up (MS-Project / WBS 100% rule): a parent's dates span its
// descendants and its % is the duration-weighted average of theirs. Leaves keep
// their own stored values. Returns a map of taskId → rolled metrics.
interface Roll { start: number; end: number; dur: number; pct: number; budget: number; isParent: boolean; baseStart: number | null; baseEnd: number | null }
const ts = (s: string | null) => (s ? +new Date(s) : null);
function rollup(node: GanttNode, out: Map<string, Roll>): Roll {
  if (!node.children?.length) {
    const r: Roll = { start: +new Date(node.planStart), end: +new Date(node.planEnd), dur: node.durationDays, pct: node.progressPct, budget: node.budgetCost, isParent: false, baseStart: ts(node.baselineStart), baseEnd: ts(node.baselineFinish) };
    out.set(node.id, r);
    return r;
  }
  const kids = node.children.map((c) => rollup(c, out));
  const start = Math.min(...kids.map((k) => k.start));
  const end = Math.max(...kids.map((k) => k.end));
  const totalDur = kids.reduce((s, k) => s + k.dur, 0) || 1;
  const pct = Math.round(kids.reduce((s, k) => s + k.pct * k.dur, 0) / totalDur);
  const budget = kids.reduce((s, k) => s + k.budget, 0); // summary budget = Σ children
  const bs = kids.map((k) => k.baseStart).filter((x): x is number => x != null);
  const be = kids.map((k) => k.baseEnd).filter((x): x is number => x != null);
  const r: Roll = { start, end, dur: Math.round((end - start) / day) + 1, pct, budget, isParent: true, baseStart: bs.length ? Math.min(...bs) : null, baseEnd: be.length ? Math.max(...be) : null };
  out.set(node.id, r);
  return r;
}

// A round "done" toggle — the PM's one-click way to mark a task/subtask 100%.
function CircleCheck({ pct, readOnly, busy, onSet }: { pct: number; readOnly?: boolean; busy?: boolean; onSet?: (v: number) => void }) {
  const complete = pct >= 100;
  const inProgress = pct > 0 && pct < 100;
  const ring = complete
    ? 'border-green-500 bg-green-500 text-white shadow-sm shadow-green-500/30'
    : inProgress
    ? 'border-amber-400 text-amber-500'
    : 'border-slate-300 text-transparent dark:border-slate-600';
  const cls = `grid h-5 w-5 place-items-center rounded-full border-2 transition ${ring} ${busy ? 'animate-pulse' : ''}`;
  const dot = complete ? <CheckIcon /> : inProgress ? <span className="h-[7px] w-[7px] rounded-full bg-amber-400" /> : null;
  const title = readOnly
    ? `${pct}% — rolls up from subtasks`
    : complete
    ? 'Completed — click to reopen'
    : `Mark complete (currently ${pct}%)`;
  if (readOnly) return <span className={`${cls} opacity-70`} title={title}>{dot}</span>;
  return (
    <button type="button" onClick={() => !busy && onSet?.(complete ? 0 : 100)} aria-pressed={complete} aria-label={title} title={title}
      className={`${cls} ${complete ? '' : 'hover:border-brand-500 hover:text-brand-500/40'}`}>
      {dot}
    </button>
  );
}
const CheckIcon = () => (
  <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 10.5l3.2 3.5L15 6.5" />
  </svg>
);

// Overall project % complete as a circular gauge for the WBS/Gantt header — the accumulated,
// weighted roll-up straight from the EVM engine (identical to the dashboard's per-project
// %complete). The arc is a soft gradient whose HUE tracks schedule health (SPI): green on
// track, amber at risk, red behind, neutral before a baseline exists — so the colour is
// meaningful, not decorative. Thin (3px), rounded, on a faint track; full at 100%.
const RING_GRADIENT: Record<string, [string, string]> = {
  GREEN: ['#34d399', '#16a34a'], // emerald → green
  AMBER: ['#fbbf24', '#d97706'], // amber → amber-600
  RED: ['#fb7185', '#e11d48'], // rose → rose-600
  NO_DATA: ['#cbd5e1', '#94a3b8'], // slate (neutral)
};
const HEALTH_WORD: Record<string, string> = { GREEN: 'on track', AMBER: 'at risk', RED: 'behind schedule', NO_DATA: 'no schedule baseline yet' };

function ProgressRing({ pct, health = 'NO_DATA', loading }: { pct: number; health?: string; loading?: boolean }) {
  const gid = useId();
  const R = 15.5;
  const C = 2 * Math.PI * R;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * C;
  const [from, to] = RING_GRADIENT[health] ?? RING_GRADIENT.NO_DATA;
  return (
    <div
      className="flex shrink-0 items-center gap-2"
      title={`Overall project progress: ${clamped.toFixed(1)}% complete — schedule ${HEALTH_WORD[health] ?? ''}. Weighted roll-up (same figure as the dashboard).`}
    >
      <div className="relative h-11 w-11">
        <svg viewBox="0 0 40 40" className="h-11 w-11 -rotate-90">
          <defs>
            <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={from} />
              <stop offset="100%" stopColor={to} />
            </linearGradient>
          </defs>
          <circle cx="20" cy="20" r={R} fill="none" strokeWidth="3" className="stroke-slate-100 dark:stroke-slate-800" />
          {!loading && (
            <circle
              cx="20" cy="20" r={R} fill="none" strokeWidth="3" strokeLinecap="round"
              stroke={`url(#${gid})`}
              className="transition-[stroke-dasharray] duration-500"
              strokeDasharray={`${dash} ${C}`}
            />
          )}
        </svg>
        <span className="absolute inset-0 grid place-items-center text-[11px] font-bold tabular-nums text-slate-700 dark:text-slate-100">
          {loading ? '…' : `${Math.round(clamped)}%`}
        </span>
      </div>
      <span className="hidden text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500 dark:text-slate-400 sm:block">
        Overall<br />progress
      </span>
    </div>
  );
}
const ExpandIcon = () => (
  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 3H3v4M13 3h4v4M7 17H3v-4M13 17h4v-4" />
  </svg>
);
const CollapseIcon = () => (
  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7h4V3M17 7h-4V3M3 13h4v4M17 13h-4v4" />
  </svg>
);
const initialsOf = (name: string) =>
  name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

// The Owner (PIC) responsible for a task/subtask — an initials avatar + name.
function OwnerCell({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-xs text-slate-300 dark:text-slate-600">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5" title={`Owner (PIC): ${name}`}>
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-[9px] font-semibold text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">{initialsOf(name)}</span>
      <span className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{name}</span>
    </span>
  );
}

// The date a new task should default to starting: the latest planEnd among its would-be
// siblings (same parent), else the latest planEnd across the whole WBS, else null (today).
// Keeps newly added tasks running sequentially instead of all starting on the same day.
function nextTaskStart(rows: Row[], parentId: string | null): Date | null {
  const siblings = rows.filter((r) => r.node.parentTaskId === parentId);
  const pool = siblings.length ? siblings : rows;
  if (!pool.length) return null;
  const maxEnd = Math.max(...pool.map((r) => +new Date(r.node.planEnd)));
  return Number.isFinite(maxEnd) ? new Date(maxEnd) : null;
}

export default function WbsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/schedule`;
  const canEdit = useProjectWrite(projectId);

  const ganttQ = useQuery({
    queryKey: ['gantt', projectId],
    queryFn: () => api.get<{ tree: GanttNode[]; dependencies: TaskDependency[]; baselinedAt: string | null }>(`${base}/gantt`),
  });
  const baselinedAt = ganttQ.data?.baselinedAt ?? null;

  // Overall project % complete — read from the EVM engine (the SAME weighted roll-up the
  // dashboard shows) so the Gantt's headline figure always matches it exactly. statusDate
  // doesn't affect physical %complete, so today's is fine. Shares the 'evm' key prefix so
  // it refreshes together with the Project Health panel on any progress edit.
  const evmQ = useQuery({
    queryKey: ['evm', base, 'overall'],
    queryFn: () => api.get<{ scheduleProgress: number; health: 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA' }>(`${base}/evm?statusDate=${formatDateInput(new Date())}`),
  });
  const overallPct = (evmQ.data?.scheduleProgress ?? 0) * 100;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['gantt', projectId] });
    qc.invalidateQueries({ queryKey: ['mp-sync', projectId] });
    // Refresh the overall-progress ring + the Project Health (EVM) panel after a progress edit.
    qc.invalidateQueries({ queryKey: ['evm', base] });
    // Baseline capture + progress edits change the guided next-step cues.
    qc.invalidateQueries({ queryKey: ['next-steps', projectId] });
  };

  const rows = useMemo(() => (ganttQ.data ? flatten(ganttQ.data.tree) : []), [ganttQ.data]);
  const rolled = useMemo(() => {
    const m = new Map<string, Roll>();
    (ganttQ.data?.tree ?? []).forEach((n) => rollup(n, m));
    return m;
  }, [ganttQ.data]);

  const [scale, setScale] = useState<Scale>('month');

  // Timeline axis: span of all (rolled) plan dates → a pixel width + ticks for the
  // chosen scale, plus a "today" marker. Bars are positioned by % of the span, so
  // changing the scale only restyles the axis and grows/shrinks the timeline width.
  const axis = useMemo(() => {
    if (!rows.length) return null;
    const starts = rows.map((r) => { const x = rolled.get(r.node.id); return Math.min(x?.start ?? +new Date(r.node.planStart), x?.baseStart ?? Infinity); });
    const ends = rows.map((r) => { const x = rolled.get(r.node.id); return Math.max(x?.end ?? +new Date(r.node.planEnd), x?.baseEnd ?? -Infinity); });
    const min = Math.min(...starts);
    const max = Math.max(...ends);
    const span = Math.max(max - min, day);
    const spanDays = span / day;
    const width = Math.round(Math.min(11000, Math.max(300, spanDays * PX_PER_DAY[scale])));
    const pct = (t: number) => Math.max(0, ((t - min) / span) * 100);

    const ticks: { key: string; label: string; leftPct: number; major: boolean }[] = [];
    if (scale === 'month') {
      const d = new Date(min); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
      while (+d <= max) { ticks.push({ key: `${+d}`, label: d.toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }), leftPct: pct(+d), major: true }); d.setUTCMonth(d.getUTCMonth() + 1); }
    } else if (scale === 'week') {
      const d = new Date(min); d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
      while (+d <= max) { ticks.push({ key: `${+d}`, label: d.toLocaleString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }), leftPct: pct(+d), major: d.getUTCDate() <= 7 }); d.setUTCDate(d.getUTCDate() + 7); }
    } else {
      const d = new Date(min); d.setUTCHours(0, 0, 0, 0);
      while (+d <= max) { const first = d.getUTCDate() === 1; ticks.push({ key: `${+d}`, label: first ? d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }) : String(d.getUTCDate()), leftPct: pct(+d), major: first }); d.setUTCDate(d.getUTCDate() + 1); }
    }
    const now = Date.now();
    const todayPct = now >= min && now <= max ? pct(now) : null;
    const minBarPct = (6 / width) * 100; // keep tiny tasks/milestones visible at any scale
    return { min, span, width, ticks, todayPct, minBarPct };
  }, [rows, rolled, scale]);

  const [form, setForm] = useState<{ parentId: string | null; edit?: GanttNode } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [fullscreen, setFullscreen] = useState(false);
  const colCount = 12 + (canEdit ? 1 : 0);

  // Esc exits full screen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const toast = useToast();
  const confirm = useConfirm();

  const progress = useMutation({
    mutationFn: ({ id, pct }: { id: string; pct: number }) => api.patch(`${base}/tasks/${id}/progress`, { progressPct: pct }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update progress'),
  });
  const baseline = useMutation({
    mutationFn: () => api.post(`${base}/baseline`),
    // First capture → tell the PM the remaining baseline (lock cost). Re-capture → plain confirm.
    onSuccess: () => {
      const first = !baselinedAt;
      invalidate();
      toast.success(first
        ? 'Schedule baseline set ✓ (1 of 2) — next: lock the cost baseline on the Cost tab to finish.'
        : 'Schedule baseline re-captured ✓');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to set baseline'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`${base}/tasks/${id}`),
    onSuccess: () => { invalidate(); toast.success('Task deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete task'),
  });

  if (ganttQ.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 overflow-auto bg-slate-50 p-3 dark:bg-slate-950 sm:p-5' : ''}>
    <Card className={fullscreen ? 'min-h-full' : ''}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <SectionTitle sub="Deliverable-oriented breakdown of work — tasks, subtasks, dates, % complete">
          Work Breakdown Structure
        </SectionTitle>
        <div className="flex items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 0 && (
            <button onClick={() => setFullscreen((f) => !f)} title={fullscreen ? 'Exit full screen (Esc)' : 'View full screen'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
              {fullscreen ? <><CollapseIcon /> Exit full screen</> : <><ExpandIcon /> Full screen</>}
            </button>
          )}
          {rows.length > 0 && (
            <div className="inline-flex items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Timeline</span>
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                {(['day', 'week', 'month'] as Scale[]).map((s) => (
                  <button key={s} onClick={() => setScale(s)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${scale === s ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {baselinedAt ? `Baselined ${formatDate(baselinedAt)}` : 'No baseline set'}
          </span>
          {canEdit && rows.length > 0 && (
            <Button variant="secondary" disabled={baseline.isPending} onClick={async () => { if (await confirm({ title: baselinedAt ? 'Re-capture baseline?' : 'Set schedule baseline?', message: baselinedAt ? 'Re-capture the schedule baseline from the current plan dates? This overwrites the existing baseline used for variance.' : 'Capture the current plan dates as the schedule baseline?', confirmLabel: baselinedAt ? 'Re-baseline' : 'Set baseline' })) baseline.mutate(); }}>
              {baseline.isPending ? 'Saving…' : baselinedAt ? 'Re-baseline' : 'Set Baseline'}
            </Button>
          )}
          {canEdit && <Button onClick={() => setForm({ parentId: null })}>+ Add Task</Button>}
        </div>
        {rows.length > 0 && <ProgressRing pct={overallPct} health={evmQ.data?.health} loading={evmQ.isLoading} />}
        </div>
      </div>

      {!rows.length ? (
        <div className="py-6">
          <p className="text-center text-slate-500 dark:text-slate-400">
            No work packages yet.{canEdit ? ' Start from a template below, or click “+ Add Task”.' : ''}
          </p>
          {canEdit && <TemplateStarter base={base} onApplied={invalidate} />}
        </div>
      ) : (
        <div className="overflow-x-auto">
          {/* One scrollable table for every viewport — on phones swipe left/right to reach the
              Start/Finish/Budget/Var/Actions columns and the Gantt timeline (WBS renders as the
              Gantt/table view on mobile, not cards). */}
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400 [&>th]:border-b [&>th]:border-slate-200 [&>th]:dark:border-slate-800 [&>th]:py-2 [&>th]:pr-3">
                <th className="w-8 text-center" title="Mark task / subtask complete"><span className="text-slate-300 dark:text-slate-600">✓</span></th>
                <th className="w-12">WBS</th>
                <th className="min-w-[14rem]">Task</th>
                <th title="Owner (PIC) responsible for the task">Owner</th>
                <th className="text-right">Start</th>
                <th className="text-right">Finish</th>
                <th className="text-right">Dur</th>
                <th className="text-right" title="Linked Direct Cost (manpower + material) for this work package — the EVM budget weight">Budget</th>
                <th className="text-right">% </th>
                <th>Status</th>
                <th className="text-right" title="Finish variance vs baseline (days)">Var</th>
                {canEdit && <th className="text-right">Actions</th>}
                {/* Timeline header — dynamic ticks for the chosen scale + a Today marker */}
                <th>
                  <div className="relative h-4" style={{ width: axis?.width }}>
                    {axis?.ticks.map((t) => (
                      <span key={t.key} className={`absolute -top-0.5 normal-case ${t.major ? 'text-[10px] font-medium text-slate-500 dark:text-slate-400' : 'text-[9px] font-normal text-slate-300 dark:text-slate-600'}`} style={{ left: `${t.leftPct}%` }}>{t.label}</span>
                    ))}
                    {axis?.todayPct != null && (
                      <span className="absolute -top-0.5 z-10 -translate-x-1/2 rounded bg-brand-600 px-1 text-[9px] font-semibold normal-case text-white" style={{ left: `${axis.todayPct}%` }}>Today</span>
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ node, depth, wbs }) => {
                const r = rolled.get(node.id) ?? { start: +new Date(node.planStart), end: +new Date(node.planEnd), dur: node.durationDays, pct: node.progressPct, budget: node.budgetCost, isParent: false, baseStart: null, baseEnd: null };
                const st = statusOf(r.pct);
                const leftPct = axis ? ((r.start - axis.min) / axis.span) * 100 : 0;
                const widthPct = axis ? Math.max(axis.minBarPct, ((r.end - r.start) / axis.span) * 100) : 0;
                const varDays = r.baseEnd != null ? Math.round((r.end - r.baseEnd) / day) : null;
                const baseLeft = axis && r.baseStart != null ? ((r.baseStart - axis.min) / axis.span) * 100 : null;
                const baseWidth = axis && r.baseStart != null && r.baseEnd != null ? Math.max(axis.minBarPct, ((r.baseEnd - r.baseStart) / axis.span) * 100) : null;
                const hasDict = !!(node.description || node.deliverable || node.acceptanceCriteria || node.picResource || node.pic);
                const isOpen = expanded.has(node.id);
                const togglingId = progress.isPending && progress.variables?.id === node.id;
                return (
                  <Fragment key={node.id}>
                  <tr className="[&>td]:border-b [&>td]:border-slate-100 [&>td]:dark:border-slate-800 [&>td]:py-1.5 [&>td]:pr-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="text-center">
                      <div className="flex justify-center">
                        <CircleCheck pct={r.pct} readOnly={!canEdit || r.isParent} busy={togglingId} onSet={(v) => progress.mutate({ id: node.id, pct: v })} />
                      </div>
                    </td>
                    <td className="font-mono text-xs text-slate-500 dark:text-slate-400">{wbs}</td>
                    <td>
                      <span style={{ paddingLeft: `${depth * 18}px` }} className="flex items-center gap-1">
                        <button onClick={() => toggle(node.id)} title="WBS dictionary" className={`grid h-4 w-4 shrink-0 place-items-center rounded text-[10px] ${hasDict ? 'text-brand-600' : 'text-slate-300 dark:text-slate-600'} hover:bg-slate-200 dark:hover:bg-slate-700`}>
                          {isOpen ? '▾' : 'ⓘ'}
                        </button>
                        {node.isMilestone && <span className="text-brand-600" title="Milestone">◆</span>}
                        <span className={`${depth === 0 ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'} ${r.pct >= 100 ? 'text-slate-400 line-through decoration-slate-300 dark:text-slate-500' : ''}`}>{node.name}</span>
                      </span>
                    </td>
                    <td><OwnerCell name={node.picResource?.name ?? node.pic?.name} /></td>
                    <td className="whitespace-nowrap text-right text-xs text-slate-500 dark:text-slate-400">{formatDate(new Date(r.start))}</td>
                    <td className="whitespace-nowrap text-right text-xs text-slate-500 dark:text-slate-400">{formatDate(new Date(r.end))}</td>
                    <td className="text-right tabular-nums text-xs text-slate-500 dark:text-slate-400">{r.dur}d</td>
                    <td className={`text-right tabular-nums text-xs ${r.isParent ? 'font-medium text-slate-600 dark:text-slate-300' : 'text-slate-600 dark:text-slate-300'}`} title={r.isParent ? 'Rolled up from subtasks' : 'Linked Direct Cost'}>
                      {r.budget > 0 ? formatIdrShort(r.budget) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                    </td>
                    <td className="text-right">
                      {canEdit && !r.isParent ? (
                        <input
                          type="number" min={0} max={100} defaultValue={node.progressPct} key={node.progressPct}
                          aria-label={`Percent complete for ${node.name}`}
                          onBlur={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value))); if (v !== node.progressPct) progress.mutate({ id: node.id, pct: v }); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className="w-14 rounded border border-slate-300 bg-white px-1 py-0.5 text-right text-xs tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      ) : (
                        <span className={`tabular-nums text-xs ${r.isParent ? 'text-slate-500 dark:text-slate-400' : ''}`} title={r.isParent ? 'Rolled up from subtasks' : undefined}>
                          {r.pct}%{r.isParent && ' ∑'}
                        </span>
                      )}
                    </td>
                    <td><Badge color={st.color}>{st.label}</Badge></td>
                    <td className="text-right tabular-nums text-xs">
                      {varDays == null ? (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      ) : (
                        <span title={`Baseline finish ${formatDate(new Date(r.baseEnd!))}`} className={varDays > 0 ? 'font-medium text-red-600 dark:text-red-400' : varDays < 0 ? 'font-medium text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}>
                          {varDays > 0 ? `+${varDays}d` : varDays < 0 ? `${varDays}d` : '0'}
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="whitespace-nowrap text-right text-xs">
                        <button onClick={() => setForm({ parentId: node.id })} className="text-brand-600 hover:underline" title="Add subtask">+ Sub</button>
                        <button onClick={() => setForm({ parentId: node.parentTaskId, edit: node })} className="ml-2 text-slate-500 hover:underline dark:text-slate-400">Edit</button>
                        <button onClick={async () => { if (await confirm({ title: 'Delete task?', message: <>Delete <strong>{node.name}</strong> and all of its subtasks? This cannot be undone.</>, confirmLabel: 'Delete', danger: true })) del.mutate(node.id); }} className="ml-2 text-red-500 hover:underline">Del</button>
                      </td>
                    )}
                    <td>
                      <div className="relative h-6" style={{ width: axis?.width }}>
                        {/* month/period gridlines + today marker for orientation */}
                        {axis?.ticks.filter((t) => t.major).map((t) => (
                          <div key={t.key} className="absolute inset-y-0 w-px bg-slate-100 dark:bg-slate-800/80" style={{ left: `${t.leftPct}%` }} />
                        ))}
                        {axis?.todayPct != null && (
                          <div className="absolute inset-y-0 z-10 w-px bg-brand-500/50" style={{ left: `${axis.todayPct}%` }} />
                        )}
                        {/* baseline (ghost) bar */}
                        {baseLeft != null && baseWidth != null && (
                          <div className="absolute top-0 h-2 rounded bg-slate-300 dark:bg-slate-600" style={{ left: `${baseLeft}%`, width: `${baseWidth}%` }} title={`Baseline: ${formatDate(new Date(r.baseStart!))} → ${formatDate(new Date(r.baseEnd!))}`} />
                        )}
                        {/* current bar with progress fill */}
                        <div
                          className={`absolute ${baseLeft != null ? 'top-2.5' : 'top-1.5'} h-3 rounded ${st.color === 'green' ? 'bg-green-400' : st.color === 'amber' ? 'bg-amber-400' : 'bg-brand-400'}`}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          title={`${formatDate(new Date(r.start))} → ${formatDate(new Date(r.end))} · ${r.pct}%`}
                        >
                          <div className="h-3 rounded bg-black/25" style={{ width: `${r.pct}%` }} />
                        </div>
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={colCount} className="border-b border-slate-100 bg-slate-50/60 px-3 py-3 dark:border-slate-800 dark:bg-slate-800/30">
                        <DictionaryView node={node} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {del.isError && <p className="mt-2 text-sm text-red-600">{(del.error as Error).message}</p>}

      {form && (
        <TaskForm
          base={base}
          parentId={form.parentId}
          edit={form.edit}
          siblingCount={rows.filter((r) => r.node.parentTaskId === form.parentId).length}
          defaultStart={nextTaskStart(rows, form.parentId)}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); invalidate(); }}
        />
      )}
    </Card>
    </div>
  );
}

// Empty-WBS starter: pick a curated template + a start date to seed a standard schedule.
function TemplateStarter({ base, onApplied }: { base: string; onApplied: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [templateId, setTemplateId] = useState('');
  const [startDate, setStartDate] = useState(formatDateInput(new Date()));

  const q = useQuery({ queryKey: ['wbs-templates', base], queryFn: () => api.get<{ templates: WbsTemplateInfo[] }>(`${base}/templates`) });
  const templates = q.data?.templates ?? [];
  const selected = templates.find((t) => t.id === templateId);

  const apply = useMutation({
    mutationFn: () => api.post(`${base}/apply-template`, { templateId, startDate }),
    onSuccess: () => { toast.success('WBS seeded from template'); onApplied(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to apply template'),
  });

  if (!templates.length) return null;
  return (
    <div className="mx-auto mt-4 max-w-xl rounded-xl border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-900/50 dark:bg-brand-900/15">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-800 dark:text-brand-200"><span>🧱</span> Start from a template</div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Template">
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="min-w-[15rem]">
            <option value="">— choose a template —</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.taskCount} tasks)</option>)}
          </Select>
        </Field>
        <div className="w-40"><Field label="Start date"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field></div>
        <Button
          variant="secondary"
          disabled={!templateId || apply.isPending}
          onClick={async () => {
            if (await confirm({ title: 'Apply template?', message: <>Seed the WBS with <strong>{selected?.taskCount}</strong> tasks from “{selected?.name}”, starting {startDate}? You can edit everything after.</>, confirmLabel: 'Apply' })) apply.mutate();
          }}
        >
          {apply.isPending ? 'Applying…' : 'Apply'}
        </Button>
      </div>
      {selected && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{selected.description}</p>}
    </div>
  );
}

// Read-only WBS dictionary detail shown when a row is expanded.
function DictionaryView({ node }: { node: GanttNode }) {
  const Item = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{value || <span className="text-slate-500 dark:text-slate-400">—</span>}</div>
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Item label="Owner (PIC)" value={node.picResource?.name ?? node.pic?.name} />
      <Item label="Deliverable" value={node.deliverable} />
      <div className="sm:col-span-2"><Item label="Description / Scope" value={node.description} /></div>
      <div className="sm:col-span-2"><Item label="Acceptance criteria" value={node.acceptanceCriteria} /></div>
    </div>
  );
}

// Default duration (days) for a brand-new task when we auto-continue the schedule.
const DEFAULT_TASK_DAYS = 7;

function TaskForm({ base, parentId, edit, siblingCount, defaultStart, onClose, onSaved }: {
  base: string; parentId: string | null; edit?: GanttNode; siblingCount: number; defaultStart?: Date | null; onClose: () => void; onSaved: () => void;
}) {
  // New tasks default to continue from where the schedule currently ends (defaultStart =
  // the latest existing task's planEnd) so dates run sequentially instead of all starting
  // today; end = start + a default duration. Editing keeps the task's own dates.
  const newStart = defaultStart ?? new Date();
  const newEnd = new Date(newStart.getTime() + DEFAULT_TASK_DAYS * 86_400_000);
  const [name, setName] = useState(edit?.name ?? '');
  const [planStart, setStart] = useState(formatDateInput(edit?.planStart ?? newStart));
  const [planEnd, setEnd] = useState(formatDateInput(edit?.planEnd ?? newEnd));
  const [progressPct, setProgress] = useState(edit?.progressPct ?? 0);
  const [isMilestone, setMilestone] = useState(edit?.isMilestone ?? false);
  const [description, setDescription] = useState(edit?.description ?? '');
  const [deliverable, setDeliverable] = useState(edit?.deliverable ?? '');
  const [acceptanceCriteria, setAcceptance] = useState(edit?.acceptanceCriteria ?? '');
  const [picResourceId, setPic] = useState(edit?.picResourceId ?? '');
  const [err, setErr] = useState('');
  const resourcesQ = useQuery({ queryKey: ['resources'], queryFn: () => api.get<{ resources: ResourceItem[] }>('/resources') });

  const save = useMutation({
    mutationFn: () => {
      // PUT replaces the whole task, so preserve parent/order/pic/actuals.
      const body = {
        name,
        planStart,
        planEnd,
        progressPct,
        isMilestone,
        parentTaskId: edit ? edit.parentTaskId : parentId,
        sortOrder: edit ? edit.sortOrder : siblingCount,
        picUserId: edit?.picUserId ?? undefined, // preserve any legacy user-PIC
        picResourceId: picResourceId || undefined,
        description: description || null,
        deliverable: deliverable || null,
        acceptanceCriteria: acceptanceCriteria || null,
        actualStart: edit?.actualStart ?? undefined,
        actualFinish: edit?.actualFinish ?? undefined,
      };
      return edit ? api.put(`${base}/tasks/${edit.id}`, body) : api.post(`${base}/tasks`, body);
    },
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to save'),
  });

  const title = edit ? 'Edit task' : parentId ? 'Add subtask' : 'Add task';
  // A summary task's dates & % roll up from its subtasks, so they're not edited here.
  const isParent = !!edit?.children?.length;

  return (
    <Modal onClose={onClose} title={title} size="lg">
        <div className="space-y-3">
          <Field label="Task name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Requirements gathering" />
          </Field>
          {isParent ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Dates &amp; % roll up automatically from this task’s subtasks.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start"><Input type="date" value={planStart} onChange={(e) => setStart(e.target.value)} /></Field>
                <Field label="Finish"><Input type="date" value={planEnd} onChange={(e) => setEnd(e.target.value)} /></Field>
              </div>
              <Field label={`% Complete (${progressPct}%)`}>
                <input type="range" min={0} max={100} value={progressPct} onChange={(e) => setProgress(Number(e.target.value))} className="w-full accent-brand-600" />
              </Field>
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={isMilestone} onChange={(e) => setMilestone(e.target.checked)} className="accent-brand-600" />
            Milestone
          </label>

          {/* WBS dictionary */}
          <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">WBS dictionary (optional)</div>
            <div className="space-y-3">
              <Field label="Owner (PIC)">
                <Select value={picResourceId} onChange={(e) => setPic(e.target.value)}>
                  <option value="">— unassigned —</option>
                  {resourcesQ.data?.resources.map((r) => <option key={r.id} value={r.id}>{r.name}{r.roleTitle ? ` · ${r.roleTitle}` : ''}</option>)}
                </Select>
              </Field>
              <Field label="Deliverable"><Input value={deliverable} onChange={(e) => setDeliverable(e.target.value)} placeholder="e.g. Signed-off design document" /></Field>
              <Field label="Description / scope"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this work package covers" /></Field>
              <Field label="Acceptance criteria"><Textarea value={acceptanceCriteria} onChange={(e) => setAcceptance(e.target.value)} placeholder="Definition of done" /></Field>
            </div>
          </div>

          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{err}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" disabled={!name || !planStart || !planEnd || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
    </Modal>
  );
}
