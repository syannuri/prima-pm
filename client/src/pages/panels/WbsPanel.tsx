import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

// Gantt bar palette (monday.com style): a light status-tinted track with a vivid
// rounded progress fill. 'slate' (not started) reads as the brand/blue tint.
const BAR: Record<string, { track: string; fill: string }> = {
  green: { track: 'bg-emerald-400/40 dark:bg-emerald-500/30', fill: 'bg-emerald-500' },
  amber: { track: 'bg-amber-400/40 dark:bg-amber-500/30', fill: 'bg-amber-500' },
  red: { track: 'bg-red-400/40 dark:bg-red-500/30', fill: 'bg-red-500' }, // late / overdue
  slate: { track: 'bg-slate-300/70 dark:bg-slate-600/50', fill: 'bg-slate-400 dark:bg-slate-500' },
};

// Task-name cell tint by RAG status (same key as the bar) — greens on-track/done, amber in
// progress, red late/overdue, slate not started. Reinforces the Gantt health at a glance.
const NAME_TINT: Record<string, string> = {
  green: 'bg-emerald-50 dark:bg-emerald-500/10',
  amber: 'bg-amber-50 dark:bg-amber-500/10',
  red: 'bg-red-50 dark:bg-red-500/10',
  slate: 'bg-slate-50 dark:bg-slate-800/40',
};

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

// Click-to-edit date cell: shows the date; clicking (when editable) swaps to a native date
// input that commits on blur/Enter and cancels on Esc. Values move as 'YYYY-MM-DD' strings,
// matching the task form. Read-only cells just render the value.
function InlineDate({ value, editable, onSave, title }: {
  value: string | null; editable: boolean; onSave: (date: string | null) => void; title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const cur = value ? formatDateInput(value) : '';
  if (editing) {
    return (
      <input
        type="date" autoFocus defaultValue={cur}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => { setEditing(false); const v = e.target.value || null; if (v !== (cur || null)) onSave(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') setEditing(false); }}
        className="w-[7.25rem] rounded border border-brand-300 bg-white px-1 py-0.5 text-right text-xs tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400 dark:border-brand-600 dark:bg-slate-800 dark:text-slate-100"
      />
    );
  }
  return (
    <button
      type="button" disabled={!editable} title={editable ? (title ?? 'Click to edit') : title}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className={`w-full rounded px-1 py-0.5 text-right text-xs tabular-nums ${editable ? 'cursor-text text-slate-600 hover:bg-brand-50 dark:text-slate-300 dark:hover:bg-brand-900/20' : 'cursor-default text-slate-500 dark:text-slate-400'}`}
    >
      {value ? formatDate(new Date(value)) : <span className="text-slate-300 dark:text-slate-600">—</span>}
    </button>
  );
}

// Click-to-edit Owner cell — swaps to a resource picker that commits on change.
function InlineOwner({ name, resourceId, editable, resources, onSave }: {
  name: string | null | undefined; resourceId: string | null; editable: boolean;
  resources: ResourceItem[]; onSave: (id: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        autoFocus defaultValue={resourceId ?? ''}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => setEditing(false)}
        onChange={(e) => { const id = e.target.value || null; setEditing(false); if (id !== (resourceId ?? null)) onSave(id); }}
        className="max-w-[10rem] rounded border border-brand-300 bg-white px-1 py-0.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400 dark:border-brand-600 dark:bg-slate-800 dark:text-slate-100"
      >
        <option value="">— unassigned —</option>
        {resources.map((r) => <option key={r.id} value={r.id}>{r.name}{r.roleTitle ? ` · ${r.roleTitle}` : ''}</option>)}
      </select>
    );
  }
  if (!editable) return <OwnerCell name={name} />;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); setEditing(true); }} title="Click to change owner"
      className="rounded px-1 py-0.5 hover:bg-brand-50 dark:hover:bg-brand-900/20">
      <OwnerCell name={name} />
    </button>
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
    queryFn: () => api.get<{ tree: GanttNode[]; dependencies: TaskDependency[]; baselinedAt: string | null; baselineLocked?: boolean }>(`${base}/gantt`),
  });
  const baselinedAt = ganttQ.data?.baselinedAt ?? null;
  const baselineLocked = ganttQ.data?.baselineLocked ?? false;
  // Drag-reschedule + dependency editing are frozen once the baseline is locked (the API enforces it).
  const canPlan = canEdit && !baselineLocked;
  // Drag-to-reschedule is blocked once a schedule baseline is captured — plan dates are then frozen
  // for variance tracking, and any change must go through a change request (not a casual drag).
  const canDrag = canEdit && !baselineLocked && !baselinedAt;
  const deps = ganttQ.data?.dependencies ?? [];

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
    const now = Date.now();
    // Span covers plan + baseline + ACTUAL dates (a task that finished late/early must fit),
    // and extends to "today" when any leaf task is still in progress (its actual bar runs to now).
    let anyActive = false;
    const lo: number[] = [];
    const hi: number[] = [];
    for (const r of rows) {
      const x = rolled.get(r.node.id);
      const pStart = x?.start ?? +new Date(r.node.planStart);
      const pEnd = x?.end ?? +new Date(r.node.planEnd);
      lo.push(Math.min(pStart, x?.baseStart ?? Infinity));
      hi.push(Math.max(pEnd, x?.baseEnd ?? -Infinity));
      const pct = x?.pct ?? r.node.progressPct;
      if (!x?.isParent && pct > 0) { // leaf task that has actually started
        lo.push(r.node.actualStart ? +new Date(r.node.actualStart) : pStart);
        if (pct >= 100) hi.push(r.node.actualFinish ? +new Date(r.node.actualFinish) : pEnd);
        else anyActive = true;
      }
    }
    const min = Math.min(...lo);
    const max = Math.max(...hi, anyActive ? now : -Infinity);
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
    const todayPct = now >= min && now <= max ? pct(now) : null;
    const minBarPct = (6 / width) * 100; // keep tiny tasks/milestones visible at any scale
    return { min, span, width, ticks, todayPct, minBarPct };
  }, [rows, rolled, scale]);

  const [form, setForm] = useState<{ parentId: string | null; edit?: GanttNode } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [fullscreen, setFullscreen] = useState(false);
  // Timeline (Gantt) column is collapsible — hiding it gives the widened 4-date table room.
  const [showGantt, setShowGantt] = useState(true);
  // Inline "add subtask" draft row (monday.com style) — rendered under its parent row.
  const [draft, setDraft] = useState<{ parentId: string; name: string; picResourceId: string; planStart: string; planEnd: string } | null>(null);
  // ✓ WBS Task Owner | Plan Start·Finish | Actual Start·Finish | Dur Budget % Status Var  = 13,
  // plus the Actions column (editors) and the Gantt column (when shown).
  const colCount = 13 + (canEdit ? 1 : 0) + (showGantt ? 1 : 0);
  // Resource pool for the inline owner picker + add-subtask draft (editors only).
  const resourcesQ = useQuery({ queryKey: ['resources'], queryFn: () => api.get<{ resources: ResourceItem[] }>('/resources'), enabled: canEdit });
  const resources = resourcesQ.data?.resources ?? [];

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
  // Drag-to-reschedule: PUT replaces the whole task, so preserve every field and only move the dates.
  const reschedule = useMutation({
    mutationFn: ({ node, planStart, planEnd }: { node: GanttNode; planStart: string; planEnd: string }) =>
      api.put(`${base}/tasks/${node.id}`, {
        name: node.name, planStart, planEnd,
        parentTaskId: node.parentTaskId, sortOrder: node.sortOrder,
        picUserId: node.picUserId ?? undefined, picResourceId: node.picResourceId ?? undefined,
        description: node.description ?? null, deliverable: node.deliverable ?? null, acceptanceCriteria: node.acceptanceCriteria ?? null,
        actualStart: node.actualStart ?? undefined, actualFinish: node.actualFinish ?? undefined,
        progressPct: node.progressPct, isMilestone: node.isMilestone,
      }),
    onSuccess: invalidate,
    onError: (e) => { invalidate(); toast.error(e instanceof ApiError ? e.message : 'Failed to reschedule'); },
  });
  // Inline single-field edit (dates / owner): PUT replaces the whole task, so send the full
  // record and override just the changed field(s). Actual dates carried through as-is so the
  // progress auto-stamp isn't the only way to set them.
  const patchTask = useMutation({
    mutationFn: ({ node, patch }: { node: GanttNode; patch: Record<string, unknown> }) =>
      api.put(`${base}/tasks/${node.id}`, {
        name: node.name, planStart: node.planStart, planEnd: node.planEnd,
        progressPct: node.progressPct, isMilestone: node.isMilestone,
        parentTaskId: node.parentTaskId, sortOrder: node.sortOrder,
        picUserId: node.picUserId ?? undefined, picResourceId: node.picResourceId ?? undefined,
        description: node.description ?? null, deliverable: node.deliverable ?? null, acceptanceCriteria: node.acceptanceCriteria ?? null,
        actualStart: node.actualStart ?? undefined, actualFinish: node.actualFinish ?? undefined,
        ...patch,
      }),
    onSuccess: invalidate,
    onError: (e) => { invalidate(); toast.error(e instanceof ApiError ? e.message : 'Failed to save'); },
  });
  // Inline add-subtask (keeps the draft open for the next sibling on success).
  const createSub = useMutation({
    mutationFn: ({ parentId, name, picResourceId, planStart, planEnd, sortOrder }:
      { parentId: string; name: string; picResourceId: string; planStart: string; planEnd: string; sortOrder: number }) =>
      api.post(`${base}/tasks`, {
        name, planStart, planEnd, progressPct: 0, isMilestone: false,
        parentTaskId: parentId, sortOrder, picResourceId: picResourceId || undefined,
      }),
    onSuccess: () => { invalidate(); setDraft((d) => (d ? { ...d, name: '' } : null)); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to add subtask'),
  });
  const addDep = useMutation({
    mutationFn: ({ predecessorId, successorId }: { predecessorId: string; successorId: string }) =>
      api.post(`${base}/tasks/${successorId}/dependencies`, { predecessorId, type: 'FS', lagDays: 0 }),
    onSuccess: () => { invalidate(); toast.success('Dependency linked'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not link tasks'),
  });
  const removeDep = useMutation({
    mutationFn: (depId: string) => api.del(`${base}/dependencies/${depId}`),
    onSuccess: () => { invalidate(); toast.success('Dependency removed'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to remove dependency'),
  });

  // Chart interactions: drag a bar to reschedule; click a link handle then another bar to connect them.
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'start' | 'end'; dx: number } | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const barRefs = useRef(new Map<string, HTMLDivElement>());
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [arrows, setArrows] = useState<{ id: string; d: string; bad: boolean; mx: number; my: number }[]>([]);
  const [geomTick, setGeomTick] = useState(0);
  const uid = useId().replace(/:/g, '');

  useEffect(() => { if (!linkFrom) return; const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLinkFrom(null); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [linkFrom]);

  function startDrag(e: React.PointerEvent, node: GanttNode, mode: 'move' | 'start' | 'end') {
    if (!canPlan || (node.children && node.children.length > 0) || !axis) return;
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    setDrag({ id: node.id, mode, dx: 0 });
    const onMove = (ev: PointerEvent) => setDrag((d) => (d ? { ...d, dx: ev.clientX - startX } : d));
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      const pxPerDay = axis.width / (axis.span / day);
      const deltaDays = Math.round((ev.clientX - startX) / pxPerDay);
      if (deltaDays === 0) return;
      const s = +new Date(node.planStart), en = +new Date(node.planEnd);
      let ns = s, ne = en;
      if (mode === 'move') { ns = s + deltaDays * day; ne = en + deltaDays * day; }
      // Resize keeps a ≥1-day span so a task never collapses to 0 days (which would zero its EVM weight).
      else if (mode === 'start') ns = Math.min(s + deltaDays * day, node.isMilestone ? en : en - day);
      else ne = Math.max(en + deltaDays * day, node.isMilestone ? s : s + day);
      reschedule.mutate({ node, planStart: new Date(ns).toISOString(), planEnd: new Date(ne).toISOString() });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Re-measure dependency arrows whenever layout could have changed.
  useEffect(() => {
    const bump = () => setGeomTick((t) => t + 1);
    window.addEventListener('resize', bump);
    const ro = new ResizeObserver(bump);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => { window.removeEventListener('resize', bump); ro.disconnect(); };
  }, []);
  useLayoutEffect(() => {
    if (!wrapRef.current || deps.length === 0 || !axis || drag) return;
    const wrap = wrapRef.current.getBoundingClientRect();
    const g = new Map<string, { x0: number; x1: number; y: number }>();
    for (const [id, el] of barRefs.current) {
      if (!el) continue;
      const rc = el.getBoundingClientRect();
      const l = Number(el.dataset.left) || 0, w = Number(el.dataset.width) || 0;
      g.set(id, { x0: rc.left - wrap.left + (l / 100) * rc.width, x1: rc.left - wrap.left + ((l + w) / 100) * rc.width, y: rc.top - wrap.top + rc.height / 2 });
    }
    const out: { id: string; d: string; bad: boolean; mx: number; my: number }[] = [];
    for (const dp of deps) {
      const a = g.get(dp.predecessorId), b = g.get(dp.successorId);
      if (!a || !b) continue;
      const sx = dp.type === 'SS' || dp.type === 'SF' ? a.x0 : a.x1;
      const tx = dp.type === 'FF' || dp.type === 'SF' ? b.x1 : b.x0;
      const sy = a.y, ty = b.y;
      const stub = 11;
      const back = tx < sx + stub; // successor sits at/left of predecessor → elbow around
      const ax = sx + stub;
      const bx = back ? tx - stub : ax;
      const midY = (sy + ty) / 2;
      const d = `M ${sx} ${sy} L ${ax} ${sy} L ${ax} ${midY} L ${bx} ${midY} L ${bx} ${ty} L ${tx} ${ty}`;
      out.push({ id: dp.id, d, bad: dp.type === 'FS' && b.x0 < a.x1 - 1, mx: (ax + bx) / 2, my: midY }); // FS violated if succ starts before pred finishes
    }
    setArrows(out);
  }, [deps, rows, rolled, axis, scale, fullscreen, expanded, geomTick, drag]);

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
            <button onClick={() => setShowGantt((g) => !g)} title={showGantt ? 'Hide the Gantt timeline (more room for the date columns)' : 'Show the Gantt timeline'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
              {showGantt ? '📊 Hide timeline' : '📊 Show timeline'}
            </button>
          )}
          {rows.length > 0 && showGantt && (
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
            <Button data-tour="schedule-baseline" variant="secondary" disabled={baseline.isPending} onClick={async () => { if (await confirm({ title: baselinedAt ? 'Re-capture baseline?' : 'Set schedule baseline?', message: baselinedAt ? 'Re-capture the schedule baseline from the current plan dates? This overwrites the existing baseline used for variance.' : 'Capture the current plan dates as the schedule baseline?', confirmLabel: baselinedAt ? 'Re-baseline' : 'Set baseline' })) baseline.mutate(); }}>
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
        <div className={`overflow-auto ${fullscreen ? '' : 'max-h-[65vh]'}`}>
          {linkFrom && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:border-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
              <span>🔗 Linking <strong>{rows.find((x) => x.node.id === linkFrom)?.node.name}</strong> → click the successor task’s bar to create a Finish-to-Start dependency.</span>
              <button onClick={() => setLinkFrom(null)} className="shrink-0 font-medium hover:underline">Cancel (Esc)</button>
            </div>
          )}
          {/* One scrollable table for every viewport — on phones swipe left/right to reach the
              Start/Finish/Budget/Var/Actions columns and the Gantt timeline (WBS renders as the
              Gantt/table view on mobile, not cards). */}
          <div ref={wrapRef} className="group relative">
          {/* Dependency arrows — a purely-visual SVG overlay measured from the rendered bars (spans
              all rows). pointer-events-none so it never steals a drag from the bars beneath it. */}
          {arrows.length > 0 && (
            <>
              <svg className="pointer-events-none absolute inset-0 z-[7] h-full w-full" style={{ overflow: 'visible' }} aria-hidden>
                <defs>
                  <marker id={`arrow-${uid}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0 0 L10 5 L0 10 z" className="fill-slate-400 dark:fill-slate-500" />
                  </marker>
                </defs>
                {arrows.map((a) => (
                  <path key={a.id} d={a.d} markerEnd={`url(#arrow-${uid})`} className={`fill-none ${a.bad ? 'stroke-red-400' : 'stroke-slate-400 dark:stroke-slate-500'}`} strokeWidth={1.5} />
                ))}
              </svg>
              {/* Delete handles — a small ✕ at each connector's midpoint (sits in the row gap, clear of bars). */}
              {canPlan && arrows.map((a) => (
                <button key={a.id} type="button" title="Remove dependency"
                  onClick={async () => { if (await confirm({ title: 'Remove dependency?', message: 'Delete this task link?', confirmLabel: 'Remove', danger: true })) removeDep.mutate(a.id); }}
                  className="absolute z-[9] grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-slate-300 bg-white text-[9px] leading-none text-slate-500 opacity-0 shadow-sm transition hover:border-red-400 hover:text-red-500 group-hover:opacity-70 hover:!opacity-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"
                  style={{ left: a.mx, top: a.my }}>✕</button>
              ))}
            </>
          )}
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              {/* Row 1 — column groups. Plan & Actual each span a Start/Finish pair. */}
              <tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400 [&>th]:sticky [&>th]:top-0 [&>th]:z-20 [&>th]:bg-white [&>th]:dark:bg-slate-900 [&>th]:py-2 [&>th]:pr-3">
                <th rowSpan={2} className="w-8 border-b border-slate-200 text-center align-bottom dark:border-slate-800" title="Mark task / subtask complete"><span className="text-slate-300 dark:text-slate-600">✓</span></th>
                <th rowSpan={2} className="w-12 border-b border-slate-200 align-bottom dark:border-slate-800">WBS</th>
                <th rowSpan={2} className="min-w-[14rem] border-b border-slate-200 align-bottom dark:border-slate-800">Task</th>
                <th rowSpan={2} className="border-b border-slate-200 align-bottom dark:border-slate-800" title="Owner (PIC) responsible for the task">Owner</th>
                <th colSpan={2} className="border-b border-slate-200 !py-1 text-center text-[10px] font-semibold tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500" title="Planned (baseline plan) dates">Plan</th>
                <th colSpan={2} className="border-b border-slate-200 !py-1 text-center text-[10px] font-semibold tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500" title="Actual start & finish (tracking)">Actual</th>
                <th rowSpan={2} className="border-b border-slate-200 text-right align-bottom dark:border-slate-800">Dur</th>
                <th rowSpan={2} className="border-b border-slate-200 text-right align-bottom dark:border-slate-800" title="Linked Direct Cost (manpower + material) for this work package — the EVM budget weight">Budget</th>
                <th rowSpan={2} className="border-b border-slate-200 text-right align-bottom dark:border-slate-800">% </th>
                <th rowSpan={2} className="border-b border-slate-200 align-bottom dark:border-slate-800">Status</th>
                <th rowSpan={2} className="border-b border-slate-200 text-right align-bottom dark:border-slate-800" title="Finish variance vs baseline (days)">Var</th>
                {canEdit && <th rowSpan={2} className="border-b border-slate-200 text-right align-bottom dark:border-slate-800">Actions</th>}
                {/* Timeline header — dynamic ticks for the chosen scale + a Today marker */}
                {showGantt && (
                  <th rowSpan={2} className="border-b border-slate-200 align-bottom dark:border-slate-800">
                    <div className="relative h-4" style={{ width: axis?.width }}>
                      {axis?.ticks.map((t) => (
                        <span key={t.key} className={`absolute -top-0.5 normal-case ${t.major ? 'text-[10px] font-medium text-slate-500 dark:text-slate-400' : 'text-[9px] font-normal text-slate-300 dark:text-slate-600'}`} style={{ left: `${t.leftPct}%` }}>{t.label}</span>
                      ))}
                      {axis?.todayPct != null && (
                        <span className="absolute -top-0.5 z-10 -translate-x-1/2 rounded bg-brand-600 px-1 text-[9px] font-semibold normal-case text-white" style={{ left: `${axis.todayPct}%` }}>Today</span>
                      )}
                    </div>
                  </th>
                )}
              </tr>
              {/* Row 2 — the Start/Finish sub-labels under each group. */}
              <tr className="text-left text-[11px] uppercase text-slate-400 dark:text-slate-500 [&>th]:sticky [&>th]:top-[25px] [&>th]:z-20 [&>th]:bg-white [&>th]:dark:bg-slate-900 [&>th]:border-b [&>th]:border-slate-200 [&>th]:dark:border-slate-800 [&>th]:py-1 [&>th]:pr-3 [&>th]:text-right [&>th]:font-normal">
                <th>Start</th>
                <th>Finish</th>
                <th>Start</th>
                <th>Finish</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ node, depth, wbs }) => {
                const r = rolled.get(node.id) ?? { start: +new Date(node.planStart), end: +new Date(node.planEnd), dur: node.durationDays, pct: node.progressPct, budget: node.budgetCost, isParent: false, baseStart: null, baseEnd: null };
                const st = statusOf(r.pct);
                // "Late/overdue" = unfinished and past its planned finish DATE (whole days, so a task
                // due today isn't flagged until tomorrow) → red bar + badge.
                const overdue = r.pct < 100 && Math.floor(r.end / day) < Math.floor(Date.now() / day);
                const inProgress = r.pct > 0 && r.pct < 100;
                const bar = BAR[overdue ? 'red' : st.color] ?? BAR.slate;
                const leftPct = axis ? ((r.start - axis.min) / axis.span) * 100 : 0;
                const widthPct = axis ? Math.max(axis.minBarPct, ((r.end - r.start) / axis.span) * 100) : 0;
                // Live drag preview — shift/resize the plan bar by the dragged pixels (as % of span).
                const dragging = drag?.id === node.id ? drag : null;
                const dShiftPct = dragging && axis ? (dragging.dx / axis.width) * 100 : 0;
                const pLeft = dragging && dragging.mode !== 'end' ? leftPct + dShiftPct : leftPct;
                const pWidth = dragging && axis
                  ? Math.max(axis.minBarPct, dragging.mode === 'move' ? widthPct : dragging.mode === 'start' ? widthPct - dShiftPct : widthPct + dShiftPct)
                  : widthPct;
                const draggable = canDrag && !r.isParent && !linkFrom;
                const baseLeft = axis && r.baseStart != null ? ((r.baseStart - axis.min) / axis.span) * 100 : null;
                const baseWidth = axis && r.baseStart != null && r.baseEnd != null ? Math.max(axis.minBarPct, ((r.baseEnd - r.baseStart) / axis.span) * 100) : null;
                // Actuals (leaf tasks only): a task that has started draws a vivid bar at its REAL
                // dates — actualStart → actualFinish (done) or → today (in progress) — so a late/early
                // finish shows a shift vs the plan track. Falls back to plan dates if a stamp is missing.
                const started = !r.isParent && r.pct > 0;
                const actStart = node.actualStart ? +new Date(node.actualStart) : r.start;
                const actEnd = r.pct >= 100 ? (node.actualFinish ? +new Date(node.actualFinish) : r.end) : Date.now();
                const actLeft = axis ? ((actStart - axis.min) / axis.span) * 100 : 0;
                const actWidth = axis ? Math.max(axis.minBarPct, ((actEnd - actStart) / axis.span) * 100) : 0;
                // Milestone marker sits at its confirmed date when done, else the planned date.
                const msMs = r.pct >= 100 && node.actualFinish ? +new Date(node.actualFinish) : r.end;
                const msLeft = axis ? ((msMs - axis.min) / axis.span) * 100 : 0;
                // Schedule variance: actual finish (if completed) else current plan finish, vs baseline.
                const finishMs = r.pct >= 100 && !r.isParent && node.actualFinish ? +new Date(node.actualFinish) : r.end;
                // Compare whole calendar days — actualFinish carries a time-of-day that would
                // otherwise inflate the variance by a day.
                const varDays = r.baseEnd != null ? Math.floor(finishMs / day) - Math.floor(r.baseEnd / day) : null;
                const varIsActual = r.pct >= 100 && !r.isParent && !!node.actualFinish;
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
                    <td className={NAME_TINT[overdue ? 'red' : st.color] ?? ''}>
                      <span style={{ paddingLeft: `${depth * 18}px` }} className="flex items-center gap-1">
                        <button onClick={() => toggle(node.id)} title="WBS dictionary" className={`grid h-4 w-4 shrink-0 place-items-center rounded text-[10px] ${hasDict ? 'text-brand-600' : 'text-slate-300 dark:text-slate-600'} hover:bg-slate-200 dark:hover:bg-slate-700`}>
                          {isOpen ? '▾' : 'ⓘ'}
                        </button>
                        {node.isMilestone && <span className="text-brand-600" title="Milestone">◆</span>}
                        <span className={`${depth === 0 ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'} ${r.pct >= 100 ? 'text-slate-400 line-through decoration-slate-300 dark:text-slate-500' : ''}`}>{node.name}</span>
                      </span>
                    </td>
                    <td>{canEdit
                      ? <InlineOwner name={node.picResource?.name ?? node.pic?.name} resourceId={node.picResourceId ?? null} editable resources={resources} onSave={(id) => patchTask.mutate({ node, patch: { picResourceId: id } })} />
                      : <OwnerCell name={node.picResource?.name ?? node.pic?.name} />}</td>
                    {/* Plan Start — rolls up (read-only) on summary rows; leaf is click-to-edit unless baselined. */}
                    <td className="whitespace-nowrap text-right">
                      {r.isParent
                        ? <span className="text-xs text-slate-500 dark:text-slate-400" title="Rolls up from subtasks">{formatDate(new Date(r.start))}</span>
                        : <InlineDate value={node.planStart} editable={canDrag} onSave={(v) => v && patchTask.mutate({ node, patch: { planStart: v } })} title={canDrag ? 'Plan start — click to edit' : baselinedAt ? 'Baselined — change via a change request' : undefined} />}
                    </td>
                    {/* Plan Finish */}
                    <td className="whitespace-nowrap text-right">
                      {r.isParent
                        ? <span className="text-xs text-slate-500 dark:text-slate-400" title="Rolls up from subtasks">{formatDate(new Date(r.end))}</span>
                        : <InlineDate value={node.planEnd} editable={canDrag} onSave={(v) => v && patchTask.mutate({ node, patch: { planEnd: v } })} title={canDrag ? 'Plan finish — click to edit' : baselinedAt ? 'Baselined — change via a change request' : undefined} />}
                    </td>
                    {/* Actual Start — leaf tasks; always editable while tracking (auto-stamp fills it only if empty). */}
                    <td className="whitespace-nowrap text-right">
                      {r.isParent
                        ? <span className="text-slate-300 dark:text-slate-600">—</span>
                        : <InlineDate value={node.actualStart} editable={canEdit} onSave={(v) => patchTask.mutate({ node, patch: { actualStart: v } })} title="Actual start — click to set" />}
                    </td>
                    {/* Actual Finish */}
                    <td className="whitespace-nowrap text-right">
                      {r.isParent
                        ? <span className="text-slate-300 dark:text-slate-600">—</span>
                        : <InlineDate value={node.actualFinish} editable={canEdit} onSave={(v) => patchTask.mutate({ node, patch: { actualFinish: v } })} title="Actual finish — click to set" />}
                    </td>
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
                    <td><Badge color={overdue ? 'red' : st.color}>{overdue ? 'Overdue' : st.label}</Badge></td>
                    <td className="text-right tabular-nums text-xs">
                      {varDays == null ? (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      ) : (
                        <span title={`${varIsActual ? 'Actual' : 'Forecast'} finish vs baseline (${formatDate(new Date(r.baseEnd!))})`} className={varDays > 0 ? 'font-medium text-red-600 dark:text-red-400' : varDays < 0 ? 'font-medium text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}>
                          {varDays > 0 ? `+${varDays}d` : varDays < 0 ? `${varDays}d` : '0'}{varIsActual && <span className="ml-0.5 text-green-600 dark:text-green-400" title="Based on the confirmed actual finish">✓</span>}
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="whitespace-nowrap text-right text-xs">
                        <button onClick={() => setDraft({ parentId: node.id, name: '', picResourceId: '', planStart: formatDateInput(new Date(node.planStart)), planEnd: formatDateInput(new Date(node.planEnd)) })} className="text-brand-600 hover:underline" title="Add a subtask inline">+ Sub</button>
                        <button onClick={() => setForm({ parentId: node.parentTaskId, edit: node })} className="ml-2 text-slate-500 hover:underline dark:text-slate-400" title="Full editor (dictionary, scope, acceptance)">Edit</button>
                        <button onClick={async () => { if (await confirm({ title: 'Delete task?', message: <>Delete <strong>{node.name}</strong> and all of its subtasks? This cannot be undone.</>, confirmLabel: 'Delete', danger: true })) del.mutate(node.id); }} className="ml-2 text-red-500 hover:underline">Del</button>
                      </td>
                    )}
                    {showGantt && (
                    <td>
                      <div
                        ref={(el) => { if (el) barRefs.current.set(node.id, el); else barRefs.current.delete(node.id); }}
                        data-left={node.isMilestone ? msLeft : leftPct}
                        data-width={node.isMilestone ? 0 : widthPct}
                        onClick={() => { if (linkFrom && linkFrom !== node.id) { addDep.mutate({ predecessorId: linkFrom, successorId: node.id }); setLinkFrom(null); } }}
                        className={`group/bar relative h-8 ${linkFrom && linkFrom !== node.id ? 'cursor-crosshair rounded ring-1 ring-inset ring-brand-400/50 hover:bg-brand-500/5' : ''}`}
                        style={{ width: axis?.width }}
                      >
                        {/* month/period gridlines + today marker for orientation */}
                        {axis?.ticks.filter((t) => t.major).map((t) => (
                          <div key={t.key} className="absolute inset-y-0 w-px bg-slate-100 dark:bg-slate-800/80" style={{ left: `${t.leftPct}%` }} />
                        ))}
                        {axis?.todayPct != null && (
                          <div className="absolute inset-y-0 z-10 w-px bg-brand-500/60" style={{ left: `${axis.todayPct}%` }} />
                        )}
                        {node.isMilestone ? (
                          <>
                            {/* baseline milestone (ghost diamond) */}
                            {r.baseEnd != null && axis && (
                              <div className="absolute top-1/2 z-[4] h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-slate-300/80 dark:bg-slate-600/70"
                                style={{ left: `${((r.baseEnd - axis.min) / axis.span) * 100}%` }} title={`Baseline milestone · ${formatDate(new Date(r.baseEnd))}`} />
                            )}
                            {/* milestone diamond — draggable; sits at the confirmed date when reached, else the planned date */}
                            <div
                              onPointerDown={(e) => draggable && startDrag(e, node, 'move')}
                              className={`absolute top-1/2 z-[5] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] shadow-sm ring-2 ring-white dark:ring-slate-900 ${draggable ? 'cursor-grab touch-none active:cursor-grabbing' : ''} ${dragging ? 'ring-brand-400' : ''} ${overdue ? 'bg-red-500' : r.pct >= 100 ? bar.fill : 'bg-brand-500'}`}
                              style={{ left: `${dragging ? msLeft + dShiftPct : msLeft}%` }}
                              title={r.pct >= 100 && node.actualFinish ? `Milestone reached · ${formatDate(new Date(node.actualFinish))}` : `Milestone (planned) · ${formatDate(new Date(r.end))}`}
                            />
                          </>
                        ) : (
                          <>
                            {/* baseline (ghost) — thin pill on top */}
                            {baseLeft != null && baseWidth != null && (
                              <div className="absolute top-1 h-1.5 rounded-full bg-slate-300/80 dark:bg-slate-600/70" style={{ left: `${baseLeft}%`, width: `${baseWidth}%` }} title={`Baseline: ${formatDate(new Date(r.baseStart!))} → ${formatDate(new Date(r.baseEnd!))}`} />
                            )}
                            {/* plan track — light status-tinted reference; drag to move, edge handles to resize */}
                            <div
                              onPointerDown={(e) => draggable && startDrag(e, node, 'move')}
                              className={`group/track absolute top-3 h-[15px] overflow-hidden rounded-full ring-1 ring-inset ring-black/5 dark:ring-white/10 ${bar.track} ${draggable ? 'cursor-grab touch-none active:cursor-grabbing' : ''} ${dragging ? 'ring-2 ring-brand-400' : ''}`}
                              style={{ left: `${pLeft}%`, width: `${pWidth}%` }}
                              title={dragging ? 'Release to reschedule' : `Plan: ${formatDate(new Date(r.start))} → ${formatDate(new Date(r.end))}`}
                            >
                              {/* summary (parent) rows show rolled progress inside the plan track */}
                              {r.isParent && <div className={`h-full rounded-full ${bar.fill}`} style={{ width: `${r.pct}%` }} />}
                              {/* resize handles (leaf, editable) */}
                              {draggable && <span onPointerDown={(e) => startDrag(e, node, 'start')} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize touch-none rounded-l-full bg-black/25 opacity-0 group-hover/track:opacity-100 dark:bg-white/25" />}
                              {draggable && <span onPointerDown={(e) => startDrag(e, node, 'end')} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none rounded-r-full bg-black/25 opacity-0 group-hover/track:opacity-100 dark:bg-white/25" />}
                            </div>
                            {/* actual bar — vivid, at REAL dates, overlaid on the plan track (leaf tasks that started) */}
                            {started && (
                              <div
                                className={`pointer-events-none absolute top-[13px] z-[6] h-[13px] rounded-full shadow-sm ${bar.fill} ${r.pct < 100 ? 'opacity-95' : ''}`}
                                style={{ left: `${actLeft}%`, width: `${actWidth}%` }}
                                title={`${r.pct >= 100 ? 'Actual' : 'Actual so far'}: ${formatDate(new Date(actStart))} → ${r.pct >= 100 ? formatDate(new Date(actEnd)) : 'today'} · ${r.pct}%`}
                              />
                            )}
                            {/* in-progress pulse at the leading (today) edge */}
                            {started && inProgress && axis && (
                              <span className={`pointer-events-none absolute top-[15px] z-[7] h-[9px] w-[9px] -translate-x-1/2 animate-pulse rounded-full ring-2 ring-white dark:ring-slate-900 ${overdue ? 'bg-red-400' : 'bg-amber-400'}`} style={{ left: `${actLeft + actWidth}%` }} />
                            )}
                          </>
                        )}
                        {/* link handle — click to start a Finish→Start dependency from this task */}
                        {canPlan && !dragging && (
                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); setLinkFrom(linkFrom === node.id ? null : node.id); }}
                            title={linkFrom === node.id ? 'Click another task to link (Esc to cancel)' : 'Link this task → another (Finish-to-Start)'}
                            className={`absolute top-1/2 z-[8] h-3 w-3 -translate-y-1/2 translate-x-1.5 rounded-full border shadow-sm transition ${linkFrom === node.id ? 'border-brand-500 bg-brand-500 ring-2 ring-brand-300' : 'border-slate-300 bg-white opacity-0 group-hover/bar:opacity-100 dark:border-slate-500 dark:bg-slate-700'}`}
                            style={{ left: `${node.isMilestone ? msLeft : leftPct + widthPct}%` }}
                          />
                        )}
                      </div>
                    </td>
                    )}
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={colCount} className="border-b border-slate-100 bg-slate-50/60 px-3 py-3 dark:border-slate-800 dark:bg-slate-800/30">
                        <DictionaryView node={node} />
                      </td>
                    </tr>
                  )}
                  {draft?.parentId === node.id && (
                    <DraftRow
                      draft={draft} depth={depth + 1} colCount={colCount} resources={resources} saving={createSub.isPending}
                      onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
                      onCancel={() => setDraft(null)}
                      onSave={() => { if (draft.name.trim()) createSub.mutate({ ...draft, sortOrder: node.children.length }); }}
                    />
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
          {/* Tracking-Gantt legend — the timeline overlays baseline, plan and actual dates. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-5 rounded-full bg-slate-300/80 dark:bg-slate-600/70" />Baseline</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-full bg-slate-300/50 ring-1 ring-inset ring-black/5 dark:bg-slate-600/40 dark:ring-white/10" />Plan</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-emerald-500" />Actual · done</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-amber-500" />In progress</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-red-500" />Late / overdue</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px] bg-brand-500" />Milestone</span>
            <span className="flex items-center gap-1.5"><svg width="26" height="8" className="overflow-visible"><line x1="1" y1="4" x2="20" y2="4" className="stroke-slate-400 dark:stroke-slate-500" strokeWidth="1.5" markerEnd={`url(#arrow-${uid})`} /></svg>Dependency (FS)</span>
            {canDrag && <span className="text-slate-400 dark:text-slate-500">· drag a bar to reschedule</span>}
            {canPlan && <span className="text-slate-400 dark:text-slate-500">· use the ⛓ handle to link tasks</span>}
            {canPlan && baselinedAt && <span className="text-amber-600 dark:text-amber-400">· schedule baselined — reschedule via a change request</span>}
            {baselineLocked && <span className="text-amber-600 dark:text-amber-400">· baseline locked — unlock to edit the schedule</span>}
          </div>
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

// Inline "add subtask" row (monday.com style) — editable name / owner / plan dates in-column;
// Enter saves & keeps the row open for the next sibling, Esc cancels. The remaining columns
// merge into a single Save/Cancel cell (a fresh task has no actuals/budget/status yet).
function DraftRow({ draft, depth, colCount, resources, saving, onChange, onCancel, onSave }: {
  draft: { name: string; picResourceId: string; planStart: string; planEnd: string };
  depth: number; colCount: number; resources: ResourceItem[]; saving: boolean;
  onChange: (patch: Partial<{ name: string; picResourceId: string; planStart: string; planEnd: string }>) => void;
  onCancel: () => void; onSave: () => void;
}) {
  const inp = 'w-full rounded border border-brand-300 bg-white px-1.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400 dark:border-brand-600 dark:bg-slate-800 dark:text-slate-100';
  return (
    <tr className="bg-brand-50/40 dark:bg-brand-900/10 [&>td]:border-b [&>td]:border-slate-100 [&>td]:dark:border-slate-800 [&>td]:py-1.5 [&>td]:pr-3">
      <td className="text-center text-brand-500">＋</td>
      <td className="font-mono text-[10px] uppercase text-brand-500">new</td>
      <td>
        <span style={{ paddingLeft: `${depth * 18}px` }} className="flex items-center">
          <input autoFocus value={draft.name} placeholder="Subtask name…" aria-label="Subtask name"
            onChange={(e) => onChange({ name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSave(); } else if (e.key === 'Escape') onCancel(); }}
            className={inp} />
        </span>
      </td>
      <td>
        <select value={draft.picResourceId} onChange={(e) => onChange({ picResourceId: e.target.value })} className={`${inp} max-w-[10rem]`} aria-label="Subtask owner">
          <option value="">— owner —</option>
          {resources.map((r) => <option key={r.id} value={r.id}>{r.name}{r.roleTitle ? ` · ${r.roleTitle}` : ''}</option>)}
        </select>
      </td>
      <td><input type="date" value={draft.planStart} onChange={(e) => onChange({ planStart: e.target.value })} className={`${inp} text-right`} aria-label="Subtask plan start" /></td>
      <td><input type="date" value={draft.planEnd} onChange={(e) => onChange({ planEnd: e.target.value })} className={`${inp} text-right`} aria-label="Subtask plan finish" /></td>
      <td colSpan={Math.max(1, colCount - 6)} className="whitespace-nowrap text-right text-xs">
        <span className="mr-2 hidden text-[11px] text-slate-400 sm:inline dark:text-slate-500">Enter=save · Esc=cancel</span>
        <button disabled={!draft.name.trim() || saving} onClick={onSave} className="rounded bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="ml-2 rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">Cancel</button>
      </td>
    </tr>
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
