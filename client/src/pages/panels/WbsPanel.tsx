import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { AutoMoveRow, AutoScheduleResult, CpmResult, DependencyType, GanttNode, ResourceItem, TaskDependency, WbsTemplateInfo } from '../../api/types';
import { Badge, Button, Card, Field, Input, Select, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import ImportTasksModal from '../../components/ImportTasksModal';
import WeightEditorModal from '../../components/WeightEditorModal';
import StepsModal from '../../components/StepsModal';
import InfoTip from '../../components/InfoTip';
import { useConfirm } from '../../components/ConfirmDialog';
import { formatDate, formatDateInput, formatIdrShort } from '../../lib/format';
import { useProjectWrite } from '../../lib/useProjectWrite';
import { useIsMobile } from '../../hooks/useIsMobile';
import AiTimelineGenerate from '../../components/AiTimelineGenerate';

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
function flatten(nodes: GanttNode[], collapsed?: Set<string>, depth = 0, prefix = '', acc: Row[] = []): Row[] {
  const ordered = [...nodes].sort((a, b) => subtreeStart(a) - subtreeStart(b) || +new Date(a.planEnd) - +new Date(b.planEnd));
  ordered.forEach((node, i) => {
    const wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
    acc.push({ node, depth, wbs });
    // Skip descendants of a collapsed parent (its rolled bar still spans the subtree).
    if (node.children?.length && !collapsed?.has(node.id)) flatten(node.children, collapsed, depth + 1, wbs, acc);
  });
  return acc;
}

function statusOf(pct: number): { label: string; color: string } {
  if (pct >= 100) return { label: 'Completed', color: 'green' };
  if (pct > 0) return { label: 'In progress', color: 'amber' };
  return { label: 'Not started', color: 'slate' };
}

// Live progress-fill background for the editable "% complete" cell: a left→right fill proportional
// to the value over a faint track, so the box reads as a mini progress bar you can watch fill while
// typing. Colour follows the same RAG semantics as the Gantt bars (emerald done · amber active ·
// red just-started). rgba stays translucent so the centred number is legible on both themes.
function pctFillColor(pct: number): string {
  if (pct >= 100) return 'rgba(16,185,129,0.34)';  // emerald-500 — complete
  if (pct >= 34) return 'rgba(245,158,11,0.32)';   // amber-500  — in progress
  if (pct > 0) return 'rgba(244,63,94,0.30)';      // rose-500   — just started
  return 'transparent';
}
function pctFillBg(pct: number): string {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const fill = pctFillColor(p);
  const track = 'rgba(148,163,184,0.16)'; // slate-400, faint unfilled track
  return `linear-gradient(to right, ${fill} 0%, ${fill} ${p}%, ${track} ${p}%, ${track} 100%)`;
}

// Gantt bar palette: a soft status-tinted reference track + a vivid, gently GRADIENT
// progress fill (top-lit → deeper base) so bars read with depth, not flat colour —
// "colourful yet elegant". Colour still encodes RAG (green on-track · amber active ·
// red late · slate not-started). Pair every fill with SHEEN for the premium top-gloss.
const BAR: Record<string, { track: string; fill: string }> = {
  green: { track: 'bg-emerald-400/30 dark:bg-emerald-500/25', fill: 'bg-gradient-to-b from-emerald-400 to-emerald-600' },
  amber: { track: 'bg-amber-400/30 dark:bg-amber-500/25', fill: 'bg-gradient-to-b from-amber-300 to-amber-500' },
  red: { track: 'bg-red-400/30 dark:bg-red-500/25', fill: 'bg-gradient-to-b from-rose-400 to-red-600' }, // late / overdue
  slate: { track: 'bg-slate-300/60 dark:bg-slate-600/45', fill: 'bg-gradient-to-b from-slate-300 to-slate-400 dark:from-slate-500 dark:to-slate-600' },
};
// Elegant top-gloss + hairline base-shade applied to every solid bar/fill/milestone — the
// single touch that turns a flat pill into a modern, dimensional one. Colour-agnostic.
const SHEEN = 'shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_1px_rgba(15,23,42,0.08)]';

// Left accent rail on the (frozen) task-name cell by RAG status — greens on-track/done, amber
// in progress, red late/overdue, transparent not-started. A slim rail keeps the Gantt health
// readable in the pinned pane WITHOUT a translucent bg (which would let scrolled content bleed
// through the sticky cell).
const NAME_ACCENT: Record<string, string> = {
  green: 'border-l-4 border-l-emerald-400 dark:border-l-emerald-500/70',
  amber: 'border-l-4 border-l-amber-400 dark:border-l-amber-500/70',
  red: 'border-l-4 border-l-red-400 dark:border-l-red-500/70',
  slate: 'border-l-4 border-l-transparent',
};

const day = 86_400_000;
// Default duration (days) for a brand-new task when we auto-continue the schedule.
const DEFAULT_TASK_DAYS = 7;
type Scale = 'day' | 'week' | 'month';
const PX_PER_DAY: Record<Scale, number> = { day: 22, week: 7, month: 2.4 };

// Timeline scale options. 'width' fits the whole timeline to the visible width (no horizontal
// scroll); 'fit' auto-picks a legible day/week/month by span; day/week/month are explicit and
// accept continuous zoom (±). Ticks are always chosen from the resulting px/day for legibility.
type ScaleOpt = Scale | 'fit' | 'width';
const SCALE_OPTS: ScaleOpt[] = ['width', 'fit', 'day', 'week', 'month'];
const SCALE_LABEL: Record<ScaleOpt, string> = { width: 'Fit', fit: 'Auto', day: 'Day', week: 'Week', month: 'Month' };

// Shared header control-button chrome (Full screen / Today / Options trigger) and the row style
// used inside the Options popover, so the toolbar and the menu stay visually consistent.
const CTRL_BTN = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';
const OPT_ROW = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700';

// Persist the Gantt view preferences (timeline scale · show-timeline · show-dates) across reloads
// so a PM's chosen layout sticks. Collapse state is intentionally session-only — it's tied to
// specific task ids that change as the WBS is edited.
const WBS_PREFS_KEY = 'prima_wbs_prefs';
// Row density — 'comfortable' (roomy, default) vs 'compact' (more rows on screen). Presentation only.
type Density = 'comfortable' | 'compact';
// Per-column visibility. Single columns hide individually; the plan/actual date pairs hide as a
// GROUP (each group keeps a fixed 2-col span, so the grouped header never needs partial-colSpan
// math). ✓ / WBS / Task are the row's identity + frozen-pane anchors → never hideable.
type ColKey = 'owner' | 'planDates' | 'actualDates' | 'dur' | 'budget' | 'weight' | 'pct' | 'status' | 'var' | 'timeline';
const HIDEABLE_COLS: { key: ColKey; label: string }[] = [
  { key: 'owner', label: 'Owner' },
  { key: 'planDates', label: 'Plan dates' },
  { key: 'actualDates', label: 'Actual dates' },
  { key: 'dur', label: 'Duration' },
  { key: 'budget', label: 'Budget' },
  { key: 'weight', label: 'Weight' },
  { key: 'pct', label: '% complete' },
  { key: 'status', label: 'Status' },
  { key: 'var', label: 'Variance' },
  { key: 'timeline', label: 'Timeline (Gantt)' },
];
type WbsPrefs = { scale?: ScaleOpt; showGantt?: boolean; showDates?: boolean; density?: Density; hiddenCols?: ColKey[]; highlightCritical?: boolean; showLegend?: boolean; showBarLabels?: boolean; showFloat?: boolean; colWidths?: Record<string, number> };
const readWbsPrefs = (): WbsPrefs => { try { return JSON.parse(localStorage.getItem(WBS_PREFS_KEY) || '{}'); } catch { return {}; } };
const ZOOM_MIN = 0.3, ZOOM_MAX = 6;

// Frozen identity pane — ✓ · WBS · Task stay pinned while the timeline (and any date columns)
// scroll horizontally, so a bar is always readable next to its task name. Cumulative left
// offsets = the preceding sticky widths: ✓ w-8 (2rem) → WBS left-8; +WBS w-12 (3rem) → Task
// left-20 (5rem). Header cells sit above everything (z-30); body cells above normal cells (z-10)
// but below the sticky header. Body cells carry an opaque bg + group-hover so the row highlight
// still reads across the frozen boundary.
// Header band: a solid dark-slate tint across the whole header (frozen pane + scrolling
// timeline share the SAME bg so there's no seam at the frozen edge) so the column titles read
// firmly against the data rows. Opaque so scrolled bars never bleed through the sticky header.
const FROZEN_TH = 'sticky !z-30 bg-slate-200 dark:bg-slate-800';
const FROZEN_TD = 'sticky z-10'; // opaque zebra bg + group-hover are applied per-row (see rowBg)
const FROZEN_EDGE = 'border-r border-slate-200 dark:border-slate-800 shadow-[2px_0_5px_-3px_rgba(15,23,42,0.25)]';

// WBS dictionary (per-row ⓘ detail: description / deliverable / acceptance criteria / owner) is
// hidden for now — flip to true to bring back the row toggle, expandable detail and menu entry.
const SHOW_WBS_DICTIONARY = false;

// Summary-task roll-up (MS-Project / WBS 100% rule): a parent's dates span its
// descendants and its % is the WEIGHT-weighted average of theirs — using each node's
// effective work-package weight (`effectiveWeightPct`, which already honours any manual
// Main-Task weights). With no manual weights that share equals the duration proportion,
// so this stays identical to the old duration-weighted roll-up. The parent's % therefore
// matches the authoritative project % from the EVM engine. Leaves keep their stored values.
interface Roll { start: number; end: number; dur: number; wt: number; pct: number; budget: number; isParent: boolean; baseStart: number | null; baseEnd: number | null; actualStart: number | null; actualFinish: number | null }
const ts = (s: string | null) => (s ? +new Date(s) : null);
function rollup(node: GanttNode, out: Map<string, Roll>): Roll {
  if (!node.children?.length) {
    // effectiveWeightPct may be 0 (or absent on a stale payload) → fall back to duration.
    const wt = node.effectiveWeightPct || node.durationDays || 0;
    const r: Roll = { start: +new Date(node.planStart), end: +new Date(node.planEnd), dur: node.durationDays, wt, pct: node.progressPct, budget: node.budgetCost, isParent: false, baseStart: ts(node.baselineStart), baseEnd: ts(node.baselineFinish), actualStart: ts(node.actualStart), actualFinish: ts(node.actualFinish) };
    out.set(node.id, r);
    return r;
  }
  const kids = node.children.map((c) => rollup(c, out));
  const start = Math.min(...kids.map((k) => k.start));
  const end = Math.max(...kids.map((k) => k.end));
  const totalWt = kids.reduce((s, k) => s + k.wt, 0) || 1;
  const pct = Math.round(kids.reduce((s, k) => s + k.pct * k.wt, 0) / totalWt);
  const budget = kids.reduce((s, k) => s + k.budget, 0); // summary budget = Σ children
  const bs = kids.map((k) => k.baseStart).filter((x): x is number => x != null);
  const be = kids.map((k) => k.baseEnd).filter((x): x is number => x != null);
  // Actual roll-up (MS-Project semantics): summary actual start = earliest child actual start;
  // summary actual finish is only known once EVERY descendant has finished (else still open → null).
  const as = kids.map((k) => k.actualStart).filter((x): x is number => x != null);
  const af = kids.map((k) => k.actualFinish).filter((x): x is number => x != null);
  const allFinished = kids.every((k) => k.actualFinish != null);
  const r: Roll = { start, end, dur: Math.round((end - start) / day) + 1, wt: kids.reduce((s, k) => s + k.wt, 0), pct, budget, isParent: true, baseStart: bs.length ? Math.min(...bs) : null, baseEnd: be.length ? Math.max(...be) : null, actualStart: as.length ? Math.min(...as) : null, actualFinish: allFinished && af.length ? Math.max(...af) : null };
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
// %complete). Rendered as a compact RAG pill (button-height) — a coloured dot + % + short health
// word — whose colour tracks schedule health (SPI): green on track, amber at risk, red behind,
// slate before a baseline exists — so the colour is meaningful, not decorative.
const HEALTH_WORD: Record<string, string> = { GREEN: 'on track', AMBER: 'at risk', RED: 'behind schedule', NO_DATA: 'no schedule baseline yet' };
const HEALTH_SHORT: Record<string, string> = { GREEN: 'On track', AMBER: 'At risk', RED: 'Behind', NO_DATA: 'No baseline' };
const HEALTH_PILL: Record<string, { box: string; dot: string }> = {
  GREEN: { box: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300', dot: 'bg-emerald-500' },
  AMBER: { box: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300', dot: 'bg-amber-500' },
  RED: { box: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-300', dot: 'bg-rose-500' },
  NO_DATA: { box: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300', dot: 'bg-slate-400' },
};

// Overall project % complete as a RAG rounded box, sized to match the header control buttons.
function ProgressBadge({ pct, health = 'NO_DATA', loading }: { pct: number; health?: string; loading?: boolean }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const p = HEALTH_PILL[health] ?? HEALTH_PILL.NO_DATA;
  return (
    <div
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${p.box}`}
      title={`Overall project progress: ${clamped.toFixed(1)}% complete — schedule ${HEALTH_WORD[health] ?? ''}. Weighted roll-up (same figure as the dashboard).`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${p.dot}`} aria-hidden />
      <span className="tabular-nums">{loading ? '…' : `${Math.round(clamped)}%`}</span>
      <span className="opacity-75">· {HEALTH_SHORT[health] ?? ''}</span>
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

// A task's owners ordered lead-first (the lead is `picResourceId`). Falls back to the legacy
// single picResource/pic name when the owner set is empty (e.g. pre-migration data mid-fetch).
function orderedOwners(node: GanttNode): { id: string; name: string }[] {
  const list = node.owners ?? [];
  if (list.length) {
    const lead = node.picResourceId;
    return [...list].sort((a, b) => (a.id === lead ? -1 : b.id === lead ? 1 : 0));
  }
  const fallback = node.picResource ?? node.pic;
  return fallback ? [{ id: fallback.id, name: fallback.name }] : [];
}

// The Owner(s) (PIC) responsible for a task/subtask — an overlapping initials avatar stack with the
// LEAD first, then the lead name and a "+N" badge for co-owners. Pass either the ordered owner set
// (preferred) or a single fallback name.
function OwnerCell({ owners, name }: { owners?: { id: string; name: string }[]; name?: string | null }) {
  const list = owners && owners.length ? owners : name ? [{ id: '_solo', name }] : [];
  if (!list.length) return <span className="text-xs text-slate-300 dark:text-slate-600">—</span>;
  const shown = list.slice(0, 3);
  const co = list.length - 1; // co-owners beyond the lead
  return (
    <span className="inline-flex items-center gap-1.5" title={`Owner (PIC): ${list.map((o) => o.name).join(', ')}`}>
      <span className="flex -space-x-1.5">
        {shown.map((o, i) => (
          <span key={o.id} style={{ zIndex: shown.length - i }}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-[9px] font-semibold text-brand-700 ring-1 ring-white dark:bg-brand-500/20 dark:text-brand-300 dark:ring-slate-900">{initialsOf(o.name)}</span>
        ))}
      </span>
      <span className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
        {list[0].name}{co > 0 && <span className="text-slate-400 dark:text-slate-500"> +{co}</span>}
      </span>
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
        // Commit on blur / Enter (NOT onChange — a native date input fires onChange on every
        // partial subfield edit, which would close the editor mid-edit and save half-changed dates).
        onBlur={(e) => { setEditing(false); const v = e.target.value || null; if (v !== (cur || null)) onSave(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') setEditing(false); }}
        className="w-[7.25rem] rounded border border-brand-300 bg-white px-1 py-0.5 text-center text-xs tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400 dark:border-brand-600 dark:bg-slate-800 dark:text-slate-100"
      />
    );
  }
  // A set date reads as a recessed grey pill (rounded + inset shadow for depth); an empty cell stays a
  // plain dash so not-started rows don't fill with boxes.
  const boxed = !!value;
  return (
    <button
      type="button" disabled={!editable} title={editable ? (title ?? 'Click to edit') : title}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className={`px-1.5 py-0.5 text-center text-xs tabular-nums transition ${
        boxed
          ? 'inline-block rounded-lg border border-slate-200/80 bg-slate-100/90 text-slate-700 shadow-[inset_0_1px_2px_rgba(15,23,42,0.10)] dark:border-slate-700/80 dark:bg-slate-800/70 dark:text-slate-200'
          : 'w-full rounded text-slate-300 dark:text-slate-600'
      } ${editable ? 'cursor-text hover:border-slate-300 hover:bg-slate-200/80 dark:hover:border-slate-600 dark:hover:bg-slate-700/70' : 'cursor-default'}`}
    >
      {value ? formatDate(new Date(value)) : '—'}
    </button>
  );
}

// Click-to-edit Owner cell — shows the owner avatar stack; clicking opens a checklist popover to
// manage the FULL owner set (tick = owner, ★ = lead). Commits the whole set + lead in one PUT; the
// server replaces the owner links and always keeps the lead inside the set. Portaled (like RowMenu/
// OptionsMenu) so it escapes the table's frozen-column overflow; container = the fullscreen element
// when the Gantt is full-screen, else <body>.
function OwnerPopover({ owners, node, editable, resources, container, onSave }: {
  owners: { id: string; name: string }[]; node: GanttNode; editable: boolean;
  resources: ResourceItem[]; container?: Element | null; onSave: (patch: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const w = panelRef.current?.getBoundingClientRect().width ?? 256;
    const h = panelRef.current?.getBoundingClientRect().height ?? 0;
    setPos({ left: Math.max(8, Math.min(b.left, window.innerWidth - w - 8)), top: Math.max(8, Math.min(b.bottom + 4, window.innerHeight - h - 8)) });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onResize = () => setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, [open]);

  if (!editable) return <OwnerCell owners={owners} />;

  const selected = new Set((node.owners ?? []).map((o) => o.id));
  const lead = node.picResourceId ?? null;
  const emit = (ids: string[], newLead: string | null) => onSave({ ownerResourceIds: ids, picResourceId: newLead });
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    const ids = [...next];
    emit(ids, lead && next.has(lead) ? lead : (ids[0] ?? null)); // keep lead if still selected, else first / none
  };
  const makeLead = (id: string) => { const next = new Set(selected); next.add(id); emit([...next], id); };

  return (
    <>
      <button ref={btnRef} type="button" aria-expanded={open} title="Click to manage owners (lead + co-owners)"
        onClick={(e) => { e.stopPropagation(); if (!open) place(); setOpen((o) => !o); }}
        className="rounded px-1 py-0.5 hover:bg-brand-50 dark:hover:bg-brand-900/20">
        <OwnerCell owners={owners} />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[59]" onMouseDown={() => setOpen(false)} />
          <div ref={panelRef} role="dialog" aria-label="Task owners" style={{ left: pos.left, top: pos.top }}
            onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
            className="fixed z-[60] w-64 rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-xl dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-1 flex items-center px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Owners (PIC)
              <InfoTip text="Tick to assign an owner, untick to remove. Click ★ to set the lead; unticking the lead promotes the next owner. Add people in Resources first." />
            </div>
            <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {resources.length === 0 && <p className="px-2 py-2 text-xs text-slate-400 dark:text-slate-500">No resources yet — add people under Resources first.</p>}
              {resources.map((r) => {
                const on = selected.has(r.id);
                const isLead = lead === r.id;
                return (
                  <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <input type="checkbox" checked={on} onChange={() => toggle(r.id)} className="accent-brand-600" aria-label={`Assign ${r.name}`} />
                    <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{r.name}{r.roleTitle ? <span className="text-slate-400 dark:text-slate-500"> · {r.roleTitle}</span> : ''}</span>
                    <button type="button" onClick={() => makeLead(r.id)} disabled={isLead}
                      title={isLead ? 'Lead owner' : 'Make lead owner'} aria-label={isLead ? `${r.name} is the lead owner` : `Make ${r.name} the lead owner`}
                      className={`text-sm leading-none ${isLead ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400 dark:text-slate-600 dark:hover:text-amber-400'}`}>{isLead ? '★' : '☆'}</button>
                  </div>
                );
              })}
            </div>
          </div>
        </>,
        container ?? document.body,
      )}
    </>
  );
}

// Click-to-edit task/subtask NAME — renders the styled name; clicking (when editable) swaps to a
// text input that commits on blur/Enter and cancels on Esc. Empty input is ignored (name required).
function InlineName({ value, editable, done, depthZero, onSave }: {
  value: string; editable: boolean; done: boolean; depthZero: boolean; onSave: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const nameCls = `${depthZero ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'} ${done ? 'text-slate-400 dark:text-slate-500' : ''}`;
  if (editing) {
    return (
      <input
        type="text" autoFocus defaultValue={value}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => { setEditing(false); const v = e.target.value.trim(); if (v && v !== value) onSave(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') setEditing(false); }}
        className="w-full min-w-[8rem] rounded border border-brand-300 bg-white px-1.5 py-0.5 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-400 dark:border-brand-600 dark:bg-slate-800 dark:text-slate-100"
      />
    );
  }
  if (!editable) return <span className={nameCls}>{value}</span>;
  return (
    <button type="button" title="Click to rename"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className={`${nameCls} truncate rounded px-0.5 text-left hover:bg-brand-50 dark:hover:bg-brand-900/20`}>
      {value}
    </button>
  );
}

// A single entry in the row action menu (or a divider via `separator`).
interface MenuEntry { label?: string; icon?: string; hint?: string; disabled?: boolean; danger?: boolean; separator?: boolean; onClick?: () => void; }

// Right-click / ⋮ row action menu. Fixed-positioned at (x,y), clamped to the viewport, closes on
// outside-click / Esc / resize. PORTALED into `container` (the full-screen element when in
// full-screen, else document.body) — same pattern as the modals; a body-portaled menu would be
// invisible UNDER a native full-screen element (only its own subtree paints in the top layer).
function RowMenu({ x, y, items, container, onClose }: { x: number; y: number; items: MenuEntry[]; container?: Element | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
    setPos({ left, top });
  }, [x, y]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onClose); };
  }, [onClose]);
  return createPortal(
    <>
      {/* Invisible backdrop — a click (or another right-click) anywhere dismisses the menu. */}
      <div className="fixed inset-0 z-[59]" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div ref={ref} role="menu" style={{ left: pos.left, top: pos.top }}
        className="fixed z-[60] min-w-[11rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-xl dark:border-slate-700 dark:bg-slate-800">
        {items.map((it, i) => it.separator ? (
          <div key={i} className="my-1 border-t border-slate-100 dark:border-slate-700" />
        ) : (
          <button key={i} type="button" role="menuitem" disabled={it.disabled}
            onClick={() => { if (!it.disabled) { it.onClick?.(); onClose(); } }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition disabled:cursor-default disabled:opacity-40 ${it.danger ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700'}`}>
            <span className="w-4 shrink-0 text-center text-xs">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.hint && <span className="text-[10px] text-slate-400 dark:text-slate-500">{it.hint}</span>}
          </button>
        ))}
      </div>
    </>,
    container ?? document.body,
  );
}

// "Options" popover for the WBS/Gantt header — consolidates the view toggles, timeline scale
// and baseline controls behind a single trigger so the toolbar stays one line. Anchored under the
// trigger button and PORTALED into `container` (the full-screen element when in full-screen, else
// document.body) so it isn't clipped by the overflow-x-auto control row in full-screen. Closes on
// outside-click / Esc / resize. `children` is a render-prop receiving a `close` fn.
function OptionsMenu({ container, children }: { container?: Element | null; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const w = panelRef.current?.getBoundingClientRect().width ?? 256;
    const h = panelRef.current?.getBoundingClientRect().height ?? 0;
    const left = Math.max(8, Math.min(b.right - w, window.innerWidth - w - 8));
    const top = Math.max(8, Math.min(b.bottom + 4, window.innerHeight - h - 8));
    setPos({ left, top });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onResize = () => setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, [open]);
  return (
    <>
      <button ref={btnRef} type="button" onClick={() => { if (!open) place(); setOpen((o) => !o); }} aria-expanded={open} title="Menu — view, timeline, plan actions, export, columns" className={CTRL_BTN}>
        {/* Hamburger/funnel glyph — the consolidated toolbar menu. */}
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
        Menu <span className="text-[9px]">▾</span>
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[59]" onMouseDown={() => setOpen(false)} />
          <div ref={panelRef} role="menu" style={{ left: pos.left, top: pos.top }}
            className="fixed z-[60] max-h-[80vh] w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-xl dark:border-slate-700 dark:bg-slate-800">
            {children(() => setOpen(false))}
          </div>
        </>,
        container ?? document.body,
      )}
    </>
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

export default function WbsPanel({ projectId, focusTaskId, focusKey }: { projectId: string; focusTaskId?: string | null; focusKey?: number }) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/schedule`;
  const canEdit = useProjectWrite(projectId);
  const [importOpen, setImportOpen] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [stepsFor, setStepsFor] = useState<GanttNode | null>(null);
  // Visual Gantt export (server-rendered PDF / Excel — the full timeline, horizontal view).
  const [ganttExporting, setGanttExporting] = useState<'pdf' | 'excel' | null>(null);
  const exportGantt = async (kind: 'pdf' | 'excel') => {
    setGanttExporting(kind);
    try {
      const ext = kind === 'excel' ? 'xlsx' : 'pdf';
      await api.download(`/projects/${projectId}/export/gantt/${kind === 'excel' ? 'excel' : 'pdf'}`, `gantt.${ext}`);
    } catch { /* api.download surfaces its own error toast */ }
    finally { setGanttExporting(null); }
  };

  const ganttQ = useQuery({
    queryKey: ['gantt', projectId],
    queryFn: () => api.get<{ tree: GanttNode[]; dependencies: TaskDependency[]; baselinedAt: string | null; baselineLocked?: boolean }>(`${base}/gantt`),
  });
  const baselinedAt = ganttQ.data?.baselinedAt ?? null;
  const baselineLocked = ganttQ.data?.baselineLocked ?? false;
  // Coarse-pointer (touch) devices: bar drag uses touch-action:none, which on a phone swallows
  // vertical/horizontal swipes over the bars → the timeline feels "stuck". So drag is disabled on
  // touch (edit dates via the inline fields instead); it also drives the landscape hint. `portrait`
  // tracks orientation for that hint + for whether to offer orientation-lock on fullscreen.
  const [isTouch, setIsTouch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const port = window.matchMedia('(orientation: portrait)');
    const sync = () => { setIsTouch(coarse.matches); setPortrait(port.matches); };
    sync();
    coarse.addEventListener('change', sync);
    port.addEventListener('change', sync);
    return () => { coarse.removeEventListener('change', sync); port.removeEventListener('change', sync); };
  }, []);
  // Drag-reschedule + dependency editing are frozen once the baseline is locked (the API enforces it).
  const canPlan = canEdit && !baselineLocked;
  // Drag-to-reschedule is blocked once a schedule baseline is captured — plan dates are then frozen
  // for variance tracking, and any change must go through a change request (not a casual drag) —
  // and is off on touch devices (see isTouch above) so the timeline scrolls freely.
  const canDrag = canEdit && !baselineLocked && !baselinedAt && !isTouch;

  // On narrow phones (portrait) the frozen ✓/WBS/Task pane filled the viewport and overlapped the
  // scrolled columns. Un-freeze there: the whole Gantt becomes one wide table you swipe through
  // (nothing sticky-left, so task names and bars scroll together — no overlap). The header row
  // still sticks to the top for vertical scroll (its own row-level sticky). Desktop keeps the pinned
  // pane. `frozen*` = the sticky classes only when wide; `frozenLeft()` drops the left offset on
  // narrow so the row-level header sticky doesn't re-freeze the columns horizontally.
  const isNarrow = useIsMobile();
  const stickyCol = !isNarrow;
  const frozenTh = stickyCol ? FROZEN_TH : 'bg-slate-200 dark:bg-slate-800';
  const frozenTd = stickyCol ? FROZEN_TD : '';
  const frozenEdge = stickyCol ? FROZEN_EDGE : '';
  const frozenLeft = (n: number, rest: CSSProperties = {}) => (stickyCol ? { left: n, ...rest } : rest);
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

  // Is the project % being steered by manual phase weights? (vs. auto cost/duration.) Once a
  // baseline exists the frozen `baselineWeight` is what drives EV, so check that instead. Drives
  // the header "⚖ Weighted" badge + the per-phase share chip in the compact view.
  const weightsBaselined = !!baselinedAt;
  const isWeighted = useMemo(() => {
    const any = (nodes: GanttNode[]): boolean =>
      nodes.some((n) => (weightsBaselined ? n.baselineWeight : n.weight) != null || any(n.children ?? []));
    return any(ganttQ.data?.tree ?? []);
  }, [ganttQ.data, weightsBaselined]);

  // Critical Path (CPM) — the set of tasks whose slip moves the whole project finish. Fetched
  // read-only to outline the critical bars on the Gantt (same data as the CPM panel).
  const cpmQ = useQuery({ queryKey: ['cpm', projectId], queryFn: () => api.get<CpmResult>(`${base}/cpm`) });
  const criticalIds = useMemo(() => new Set((cpmQ.data?.tasks ?? []).filter((t) => t.critical).map((t) => t.id)), [cpmQ.data]);
  // Total float (days of slack) per task, from the same CPM run — drives the optional "slack ghost"
  // drawn past a non-critical bar. Only non-critical tasks with a positive float are worth showing.
  const floatById = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of cpmQ.data?.tasks ?? []) if (!t.critical && t.totalFloat > 0) m.set(t.id, t.totalFloat);
    return m;
  }, [cpmQ.data]);
  const hasFloat = floatById.size > 0;

  // Collapsed parent rows (subtree hidden; the parent's rolled bar still spans it).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (id: string) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Horizontal scroll container + timeline header, for the "scroll to Today" jump.
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLTableCellElement>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['gantt', projectId] });
    qc.invalidateQueries({ queryKey: ['mp-sync', projectId] });
    // Refresh the overall-progress ring + the Project Health (EVM) panel after a progress edit.
    qc.invalidateQueries({ queryKey: ['evm', base] });
    // Baseline capture + progress edits change the guided next-step cues.
    qc.invalidateQueries({ queryKey: ['next-steps', projectId] });
    // Any schedule change may make the bulk-cleanup undo/redo stack go stale.
    qc.invalidateQueries({ queryKey: ['undo-state', projectId] });
  };

  const rows = useMemo(() => (ganttQ.data ? flatten(ganttQ.data.tree, collapsed) : []), [ganttQ.data, collapsed]);
  // Deep-link from an OVERDUE_TASK notification (?focus=<taskId>): once the rows render, scroll
  // that task into view and flash a highlight so the PM lands directly on the culprit.
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusTaskId || !rows.some((r) => r.node.id === focusTaskId)) return;
    setFlashId(focusTaskId);
    const scrollT = setTimeout(() => {
      (scrollRef.current?.querySelector(`[data-task-row="${focusTaskId}"]`) as HTMLElement | null)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    const clearT = setTimeout(() => setFlashId(null), 2800);
    return () => { clearTimeout(scrollT); clearTimeout(clearT); };
  }, [focusTaskId, focusKey, rows]);
  // Every parent id (for "collapse all") + whether anything is currently collapsed.
  const allParentIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (ns: GanttNode[]) => ns.forEach((n) => { if (n.children?.length) { ids.push(n.id); walk(n.children); } });
    walk(ganttQ.data?.tree ?? []);
    return ids;
  }, [ganttQ.data]);
  // Tree navigation for indent/outdent (MS-Project style): each node's parent, its ordered
  // siblings (the parent's child list), and an id→node map. Children arrive already sorted.
  const nav = useMemo(() => {
    const parentOf = new Map<string, string | null>();
    const kidsOf = new Map<string | null, GanttNode[]>();
    const nodeById = new Map<string, GanttNode>();
    const walk = (ns: GanttNode[], parent: string | null) => {
      kidsOf.set(parent, ns);
      ns.forEach((n) => { parentOf.set(n.id, parent); nodeById.set(n.id, n); if (n.children?.length) walk(n.children, n.id); });
    };
    walk(ganttQ.data?.tree ?? [], null);
    return { parentOf, kidsOf, nodeById };
  }, [ganttQ.data]);
  const rolled = useMemo(() => {
    const m = new Map<string, Roll>();
    (ganttQ.data?.tree ?? []).forEach((n) => rollup(n, m));
    return m;
  }, [ganttQ.data]);

  // Row filter — a quick name search + a status chip. When active we flatten the WHOLE tree
  // (ignoring collapse, so a match hidden inside a collapsed phase still surfaces) and keep every
  // match plus its ancestors, so the hierarchy still reads. Inactive → the normal `rows`.
  const [search, setSearch] = useState('');
  type StatusFilter = 'all' | 'late' | 'active' | 'done' | 'todo';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const filterActive = search.trim() !== '' || statusFilter !== 'all';
  const visibleRows = useMemo(() => {
    if (!filterActive) return rows;
    const q = search.trim().toLowerCase();
    const keep = new Set<string>();
    const walk = (ns: GanttNode[], anc: string[]) => {
      for (const n of ns) {
        const roll = rolled.get(n.id);
        const pct = roll?.pct ?? n.progressPct;
        const end = roll?.end ?? +new Date(n.planEnd);
        const overdue = pct < 100 && Math.floor(end / day) < Math.floor(Date.now() / day);
        const statusOk =
          statusFilter === 'all' ||
          (statusFilter === 'late' && overdue) ||
          (statusFilter === 'active' && pct > 0 && pct < 100) ||
          (statusFilter === 'done' && pct >= 100) ||
          (statusFilter === 'todo' && pct === 0);
        const textOk = !q || (n.name ?? '').toLowerCase().includes(q);
        if (statusOk && textOk) { keep.add(n.id); anc.forEach((a) => keep.add(a)); }
        if (n.children?.length) walk(n.children, [...anc, n.id]);
      }
    };
    walk(ganttQ.data?.tree ?? [], []);
    return flatten(ganttQ.data?.tree ?? []).filter((r) => keep.has(r.node.id));
  }, [filterActive, search, statusFilter, rows, rolled, ganttQ.data]);

  // Project totals for the pinned footer — leaf work packages only (parents roll up; milestones
  // are counted separately). Always over the FULL set, so the footer is a stable project summary.
  const totals = useMemo(() => {
    let count = 0, done = 0, late = 0, budget = 0, ms = 0;
    for (const { node } of rows) {
      const roll = rolled.get(node.id);
      if (roll?.isParent) continue;
      if (node.isMilestone) { ms++; continue; }
      count++;
      const pct = roll?.pct ?? node.progressPct;
      const end = roll?.end ?? +new Date(node.planEnd);
      if (pct >= 100) done++;
      else if (Math.floor(end / day) < Math.floor(Date.now() / day)) late++;
      budget += node.budgetCost ?? 0;
    }
    return { count, done, late, budget, ms };
  }, [rows, rolled]);

  // Schedule-slip roll-up for the banner: how many baselined leaf tasks finish late vs baseline
  // and the worst slip (days). "Late" uses actual finish when done, else the current plan finish.
  const slip = useMemo(() => {
    let late = 0, worst = 0, baselined = 0;
    for (const { node } of rows) {
      const r = rolled.get(node.id);
      if (!r || r.isParent || r.baseEnd == null) continue;
      baselined++;
      const finishMs = r.pct >= 100 && node.actualFinish ? +new Date(node.actualFinish) : r.end;
      const v = Math.floor(finishMs / day) - Math.floor(r.baseEnd / day);
      if (v > 0) { late++; worst = Math.max(worst, v); }
    }
    return { late, worst, baselined };
  }, [rows, rolled]);

  // Timeline zoom/scale. 'fit' auto-picks a legible discrete scale; 'width' fits the visible width;
  // day/week/month are explicit and multiplied by `zoom` (± buttons / ⌘-scroll). `fitW` is the
  // measured available timeline width for 'width' mode; `overflowX` drives the right-edge scroll hint.
  const [scale, setScale] = useState<ScaleOpt>(() => readWbsPrefs().scale ?? 'fit');
  const [zoom, setZoom] = useState(1);
  const [fitW, setFitW] = useState<number | null>(null);
  const [overflowX, setOverflowX] = useState(false);
  const axisRef = useRef<{ width: number; effScale: Scale } | null>(null);
  const preserveRef = useRef<number | null>(null); // timeline-centre fraction to restore across a zoom
  const fitFracRef = useRef<number | null>(null); // left-edge fraction to scroll to after a fit-to-selection

  // Timeline axis: span of all (rolled) plan dates → a pixel width + ticks for the
  // chosen scale, plus a "today" marker. Bars are positioned by % of the span, so
  // changing the scale only restyles the axis and grows/shrinks the timeline width.
  const axis = useMemo(() => {
    // Span the VISIBLE rows so an active filter zooms the timeline to the matches.
    if (!visibleRows.length) return null;
    const now = Date.now();
    // Span covers plan + baseline + ACTUAL dates (a task that finished late/early must fit),
    // and extends to "today" when any leaf task is still in progress (its actual bar runs to now).
    let anyActive = false;
    const lo: number[] = [];
    const hi: number[] = [];
    for (const r of visibleRows) {
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
    // Base pixels-per-day: 'width' fits the measured visible width; otherwise the discrete scale
    // (auto-picked for 'fit') × zoom. Ticks are chosen from the RESULTING px/day so zooming into a
    // month view still reveals week/day gridlines.
    const autoScale: Scale = spanDays <= 45 ? 'day' : spanDays <= 400 ? 'week' : 'month';
    let pxPerDay: number;
    if (scale === 'width') pxPerDay = (fitW ?? 900) / spanDays;
    else pxPerDay = PX_PER_DAY[scale === 'fit' ? autoScale : scale] * zoom;
    let width = Math.max(300, Math.round(spanDays * pxPerDay));
    if (scale !== 'width') width = Math.min(11000, width); // 'width' is already ≤ viewport
    const effScale: Scale = pxPerDay >= 13 ? 'day' : pxPerDay >= 3.2 ? 'week' : 'month';
    const pct = (t: number) => Math.max(0, ((t - min) / span) * 100);

    const ticks: { key: string; label: string; leftPct: number; major: boolean }[] = [];
    if (effScale === 'month') {
      const d = new Date(min); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
      while (+d <= max) { ticks.push({ key: `${+d}`, label: d.toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }), leftPct: pct(+d), major: true }); d.setUTCMonth(d.getUTCMonth() + 1); }
    } else if (effScale === 'week') {
      const d = new Date(min); d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
      while (+d <= max) { ticks.push({ key: `${+d}`, label: d.toLocaleString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }), leftPct: pct(+d), major: d.getUTCDate() <= 7 }); d.setUTCDate(d.getUTCDate() + 7); }
    } else {
      const d = new Date(min); d.setUTCHours(0, 0, 0, 0);
      while (+d <= max) { const first = d.getUTCDate() === 1; ticks.push({ key: `${+d}`, label: first ? d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }) : String(d.getUTCDate()), leftPct: pct(+d), major: first }); d.setUTCDate(d.getUTCDate() + 1); }
    }
    // Weekend shading — one faint band per Saturday & Sunday. Only at day zoom; at week/month a
    // 2-day band would be sub-pixel noise (and the scheduler already keeps bar dates off weekends).
    const weekends: { key: string; leftPct: number; widthPct: number }[] = [];
    if (effScale === 'day') {
      const dayPct = (day / span) * 100;
      const d = new Date(min); d.setUTCHours(0, 0, 0, 0);
      while (+d <= max) {
        const dow = d.getUTCDay();
        if (dow === 0 || dow === 6) weekends.push({ key: `w${+d}`, leftPct: pct(+d), widthPct: dayPct });
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    const todayPct = now >= min && now <= max ? pct(now) : null;
    const minBarPct = (6 / width) * 100; // keep tiny tasks/milestones visible at any scale
    return { min, span, width, ticks, weekends, todayPct, minBarPct, effScale };
  }, [visibleRows, rolled, scale, zoom, fitW]);
  // Mirror the live axis into a ref so the (once-bound) wheel/zoom handlers never read a stale copy.
  axisRef.current = axis ? { width: axis.width, effScale: axis.effScale } : null;

  // Jump the horizontal scroll so the Today marker is centered (measured from the live layout so
  // it's robust to the frozen pane + whatever columns precede the timeline).
  const scrollToToday = () => {
    const sc = scrollRef.current, tl = timelineRef.current;
    if (!sc || !tl || !axis || axis.todayPct == null) return;
    const todayX = tl.getBoundingClientRect().left - sc.getBoundingClientRect().left + sc.scrollLeft + (axis.todayPct / 100) * axis.width;
    sc.scrollTo({ left: Math.max(0, todayX - sc.clientWidth / 2), behavior: 'smooth' });
  };

  // Zoom while keeping the timeline centre stable: capture the centre fraction before the width
  // changes, restore the scroll after the re-render (reuses the frozen-pane offset math above).
  const captureCenter = () => {
    const sc = scrollRef.current, tl = timelineRef.current, a = axisRef.current;
    if (!sc || !tl || !a) return;
    const left = tl.getBoundingClientRect().left - sc.getBoundingClientRect().left + sc.scrollLeft;
    preserveRef.current = (sc.scrollLeft - left + sc.clientWidth / 2) / a.width;
  };
  useLayoutEffect(() => {
    const sc = scrollRef.current, tl = timelineRef.current, a = axisRef.current;
    if (!sc || !tl || !a) return;
    // Fit-to-selection: scroll the framed span's left edge just inside the frozen pane.
    if (fitFracRef.current != null) {
      sc.scrollLeft = Math.max(0, fitFracRef.current * a.width - 24);
      fitFracRef.current = null;
      return;
    }
    if (preserveRef.current == null) return;
    const left = tl.getBoundingClientRect().left - sc.getBoundingClientRect().left + sc.scrollLeft;
    sc.scrollLeft = left + preserveRef.current * a.width - sc.clientWidth / 2;
    preserveRef.current = null;
  }, [axis?.width]);
  // Continuous zoom. From an auto mode ('fit'/'width') it first locks to the current discrete scale.
  const zoomBy = (f: number) => {
    captureCenter();
    setScale((s) => (s === 'fit' || s === 'width' ? (axisRef.current?.effScale ?? 'week') : s));
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * f)));
  };

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [fullscreen, setFullscreen] = useState(false);
  const fsRef = useRef<HTMLDivElement>(null);
  // Dialogs/menus opened from the fullscreen Gantt must portal INTO the fullscreen element — under
  // the native Fullscreen API only that subtree paints, so a <body>-level modal would be invisible
  // (the "can't add a task in full screen" bug). Outside fullscreen: default portal (undefined).
  const modalContainer = fullscreen ? fsRef.current : undefined;
  // Resizable Gantt box (normal view only) — drag the bottom handle to grow/shrink the timeline.
  // null = default (max-h-[78vh]); a px height once the user drags. Persisted per project.
  const HKEY = `wbs-h:${projectId}`;
  const [panelH, setPanelH] = useState<number | null>(() => {
    const s = Number(localStorage.getItem(HKEY));
    return Number.isFinite(s) && s >= 220 ? s : null;
  });
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = scrollRef.current?.getBoundingClientRect().height ?? 400;
    const onMove = (ev: PointerEvent) => {
      const h = Math.max(220, Math.min(window.innerHeight * 0.92, startH + (ev.clientY - startY)));
      setPanelH(h);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setPanelH((h) => { if (h) localStorage.setItem(HKEY, String(Math.round(h))); return h; });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  // Fullscreen = a CSS overlay always; on top of that, where the platform supports it
  // (Android/desktop Chrome) we request the real Fullscreen API and lock landscape so the
  // timeline gets max width. iOS Safari supports neither element-fullscreen nor orientation.lock,
  // so it just gets the overlay + a "rotate your device" hint (see the header below).
  const enterFullscreen = async () => {
    setFullscreen(true);
    // Re-centre on today once the overlay has laid out (the timeline just got the full width).
    requestAnimationFrame(() => requestAnimationFrame(scrollToToday));
    const el = fsRef.current;
    if (el?.requestFullscreen) {
      try {
        await el.requestFullscreen();
        const orient = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
        if (orient?.lock) { try { await orient.lock('landscape'); } catch { /* desktop / unsupported — no-op */ } }
      } catch { /* element-fullscreen unsupported (iOS) — the CSS overlay still applies */ }
    }
  };
  const exitFullscreen = async () => {
    const orient = screen.orientation as (ScreenOrientation & { unlock?: () => void }) | undefined;
    try { orient?.unlock?.(); } catch { /* no-op */ }
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { /* no-op */ } }
    setFullscreen(false);
  };
  const toggleFullscreen = () => { fullscreen ? exitFullscreen() : enterFullscreen(); };
  // Per-column visibility (Set of hidden ColKeys). Migrates the old boolean prefs on first load:
  // showDates:false → hide both date groups; showGantt:false → hide the timeline.
  const [hiddenCols, setHiddenCols] = useState<Set<ColKey>>(() => {
    const p = readWbsPrefs();
    if (p.hiddenCols) return new Set(p.hiddenCols);
    const init = new Set<ColKey>();
    if (p.showDates === false) { init.add('planDates'); init.add('actualDates'); }
    if (p.showGantt === false) init.add('timeline');
    return init;
  });
  const show = (k: ColKey) => !hiddenCols.has(k);
  const toggleCol = (k: ColKey) => setHiddenCols((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const hideCol = (k: ColKey) => setHiddenCols((s) => (s.has(k) ? s : new Set(s).add(k)));
  const showAllCols = () => setHiddenCols(new Set());
  // Back-compat derived flags so the rest of the component keeps reading these names. `showGantt` =
  // the timeline column; `showDates` = ANY date group visible (drives the 2-row grouped header).
  const showGantt = show('timeline');
  const showDates = show('planDates') || show('actualDates');
  // Row density (comfortable/compact) — drives the row vertical padding.
  const [density, setDensity] = useState<Density>(() => readWbsPrefs().density ?? 'comfortable');
  // Isolate the critical path (dim non-critical bars) + show the timeline legend. Presentation only.
  const [highlightCritical, setHighlightCritical] = useState<boolean>(() => readWbsPrefs().highlightCritical ?? false);
  const [showLegend, setShowLegend] = useState<boolean>(() => readWbsPrefs().showLegend ?? false);
  // Render the task name trailing its bar in the timeline (readable without the frozen name pane).
  const [showBarLabels, setShowBarLabels] = useState<boolean>(() => readWbsPrefs().showBarLabels ?? false);
  // Draw each non-critical leaf's total float as a faded "slack" extension past its plan bar, so the
  // schedule buffer (how far a task can slip before it becomes critical) reads at a glance.
  const [showFloat, setShowFloat] = useState<boolean>(() => readWbsPrefs().showFloat ?? false);
  // Per-column widths (px) — drag a header's right edge to resize. Pinned via width+min+max (the
  // same technique the frozen columns use), so it works on this border-separate (non-fixed) table.
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => readWbsPrefs().colWidths ?? {});
  const colResize = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const colStyle = (key: string, base: CSSProperties = {}): CSSProperties => {
    const w = colWidths[key];
    return w ? { ...base, width: w, minWidth: w, maxWidth: w } : base;
  };
  const startColResize = (key: string, e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest('th');
    const startW = colWidths[key] ?? th?.getBoundingClientRect().width ?? 120;
    colResize.current = { key, startX: e.clientX, startW };
    const move = (ev: PointerEvent) => {
      if (!colResize.current) return;
      const w = Math.max(48, Math.min(640, Math.round(colResize.current.startW + (ev.clientX - colResize.current.startX))));
      setColWidths((m) => ({ ...m, [colResize.current!.key]: w }));
    };
    const up = () => { colResize.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // Reusable resize grip for a header cell (the cell must be position:relative).
  const ColGrip = ({ col }: { col: string }) => (
    <span onPointerDown={(e) => startColResize(col, e)} onClick={(e) => e.stopPropagation()} onDoubleClick={() => setColWidths((m) => { const n = { ...m }; delete n[col]; return n; })}
      data-export-hide="true" title="Drag to resize · double-click to reset"
      className="absolute -right-px top-0 z-20 h-full w-1.5 cursor-col-resize touch-none select-none bg-transparent transition-colors hover:bg-brand-400/50" />
  );
  // Snapshot the current timeline (WYSIWYG — honours zoom, filter, columns) to a PNG for decks.
  const [exporting, setExporting] = useState(false);
  const downloadGantt = async () => {
    const node = wrapRef.current;
    if (!node || exporting) return;
    setExporting(true);
    try {
      const { toPng } = await import('html-to-image');
      const dark = document.documentElement.classList.contains('dark');
      const dataUrl = await toPng(node, {
        backgroundColor: dark ? '#0f172a' : '#ffffff',
        pixelRatio: 2,
        width: node.scrollWidth,
        height: node.scrollHeight,
        cacheBust: true,
        // hover-only affordances (resize/link handles) sit at opacity-0 already; skip anything
        // explicitly flagged so a stray tooltip/menu never bleeds into the snapshot.
        filter: (el) => !(el instanceof HTMLElement && el.dataset.exportHide === 'true'),
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `gantt-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      console.error('Gantt image export failed', e);
    } finally {
      setExporting(false);
    }
  };
  // Row currently hovered — drives the dependency-chain highlight (its links pop, the rest dim).
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  // Remember the view prefs across reloads.
  useEffect(() => {
    try { localStorage.setItem(WBS_PREFS_KEY, JSON.stringify({ scale, density, hiddenCols: [...hiddenCols], highlightCritical, showLegend, showBarLabels, showFloat, colWidths })); } catch { /* ignore quota */ }
  }, [scale, density, hiddenCols, highlightCritical, showLegend, showBarLabels, showFloat, colWidths]);

  // Measure the visible timeline width (viewport minus the frozen left pane) for 'Fit' mode, and
  // whether the timeline overflows horizontally (drives the right-edge scroll hint). Re-runs on
  // container resize, window resize, and layout-affecting toggles.
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const measure = () => {
      const s = scrollRef.current, t = timelineRef.current;
      if (!s) return;
      if (t) {
        const left = t.getBoundingClientRect().left - s.getBoundingClientRect().left + s.scrollLeft;
        setFitW(Math.max(300, s.clientWidth - left - 6));
      }
      setOverflowX(s.scrollWidth > s.clientWidth + 2);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sc);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [rows.length, fullscreen, hiddenCols]);
  // Refresh the overflow flag when the width changes via zoom/scale (no container resize fires).
  useEffect(() => {
    const sc = scrollRef.current;
    if (sc) setOverflowX(sc.scrollWidth > sc.clientWidth + 2);
  }, [axis?.width, hiddenCols]);
  // ⌘/Ctrl + wheel zooms the timeline (bound once; zoomBy reads the axis via a ref, never stale).
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => sc.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // Inline "add subtask" draft row (monday.com style) — rendered under its parent row.
  // `afterId` = insert this new task right AFTER that row (the inline "+" between rows); the row
  // becomes a sibling (parentId = that row's parent). Absent → a subtask (parentId=node) or the
  // first/top-level task (parentId=null, empty state).
  const [draft, setDraft] = useState<{ parentId: string | null; afterId?: string; name: string; picResourceId: string; planStart: string; planEnd: string } | null>(null);
  // Open an inline draft to insert a task after `node` (same level = a sibling). Start date defaults
  // to the row's finish so it sorts right after it (rows order by date).
  const insertAfter = (node: GanttNode, endMs: number) => setDraft({
    parentId: node.parentTaskId, afterId: node.id, name: '', picResourceId: '',
    planStart: formatDateInput(new Date(endMs)), planEnd: formatDateInput(new Date(endMs + DEFAULT_TASK_DAYS * day)),
  });
  // Right-click / ⋮ row action menu (indent · outdent · add subtask · edit details · delete).
  // Replaces the old Actions column — anchored at the pointer (right-click) or the ⋮ button.
  const [menu, setMenu] = useState<{ node: GanttNode; x: number; y: number } | null>(null);
  const openRowMenu = (node: GanttNode, x: number, y: number) => { if (canEdit) setMenu({ node, x, y }); };
  // Right-click a column header → a one-item "Hide column" menu (restore via ⚙ Options → Columns).
  const [colMenu, setColMenu] = useState<{ key: ColKey; label: string; x: number; y: number } | null>(null);
  const openColMenu = (key: ColKey, label: string, e: React.MouseEvent) => { e.preventDefault(); setColMenu({ key, label, x: e.clientX, y: e.clientY }); };
  // Base = ✓ WBS Task Owner % Status Var (7); +6 date/budget cols when shown; + the Gantt column
  // (when shown). No Actions column anymore — row actions live in the right-click / ⋮ menu.
  // Visible column count for DraftRow / empty-state colSpans: ✓ + WBS + Task (3, always) + each
  // visible single column + 2 per visible date group + the timeline.
  const SINGLE_COLS: ColKey[] = ['owner', 'dur', 'budget', 'weight', 'pct', 'status', 'var'];
  const colCount = 3 + SINGLE_COLS.filter(show).length + (show('planDates') ? 2 : 0) + (show('actualDates') ? 2 : 0) + (showGantt ? 1 : 0);
  // Resource pool for the inline owner picker + add-subtask draft (editors only).
  const resourcesQ = useQuery({ queryKey: ['resources'], queryFn: () => api.get<{ resources: ResourceItem[] }>('/resources'), enabled: canEdit });
  const resources = resourcesQ.data?.resources ?? [];

  // Esc exits full screen; also keep our state in sync when native fullscreen is left via the
  // device back-gesture / browser chrome (fullscreenchange) so the overlay + orientation unlock too.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitFullscreen(); };
    const onFsChange = () => { if (!document.fullscreenElement) exitFullscreen(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFsChange); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Multi-select cleanup — pick several tasks (each deletes its subtree) or clear the whole timeline.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()); };
  // Fit-to-selection — zoom & scroll the timeline so the selected tasks' date span fills the view.
  // Picks a legible base scale for the selection span, zooms to ~90% fill, then scrolls its left edge
  // just inside the frozen pane (via fitFracRef; the span fraction is invariant to zoom).
  const fitToSelection = () => {
    const sc = scrollRef.current, tl = timelineRef.current;
    if (!axis || !selectedIds.size || !sc || !tl) return;
    let lo = Infinity, hi = -Infinity;
    for (const id of selectedIds) {
      const rr = rolled.get(id), n = nav.nodeById.get(id);
      const s = rr?.start ?? (n ? +new Date(n.planStart) : NaN);
      const e = rr?.end ?? (n ? +new Date(n.planEnd) : NaN);
      if (Number.isFinite(s)) lo = Math.min(lo, s);
      if (Number.isFinite(e)) hi = Math.max(hi, e);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    const selSpanDays = Math.max((hi - lo) / day, 1);
    const tlLeft = tl.getBoundingClientRect().left - sc.getBoundingClientRect().left + sc.scrollLeft; // frozen-pane width
    const availW = Math.max(160, sc.clientWidth - tlLeft);
    const base: Scale = selSpanDays <= 45 ? 'day' : selSpanDays <= 400 ? 'week' : 'month';
    const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (availW * 0.9) / selSpanDays / PX_PER_DAY[base]));
    fitFracRef.current = (lo - axis.min) / axis.span;
    setScale(base);
    setZoom(nextZoom);
    // Fallback when the width didn't change (the layout effect won't re-fire): scroll next frame.
    requestAnimationFrame(() => {
      if (fitFracRef.current == null) return;
      const a = axisRef.current;
      if (a && sc) sc.scrollLeft = Math.max(0, fitFracRef.current * a.width - 24);
      fitFracRef.current = null;
    });
  };
  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => api.post<{ deleted: number }>(`${base}/tasks/bulk-delete`, { ids }),
    onSuccess: (res) => { invalidate(); toast.success(`${res.deleted} task${res.deleted === 1 ? '' : 's'} deleted`); exitSelect(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete tasks'),
  });
  const clearAll = useMutation({
    mutationFn: () => api.post<{ deleted: number }>(`${base}/clear`, {}),
    onSuccess: (res) => { invalidate(); toast.success(`Timeline cleared — ${res.deleted} task${res.deleted === 1 ? '' : 's'} removed`); exitSelect(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to clear the timeline'),
  });
  // Undo/redo for the bulk-cleanup ops (delete selected / clear). Self-invalidates when the schedule
  // is edited another way (the server fingerprints it), so the buttons just reflect undo-state.
  interface UndoState { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null }
  const undoStateQ = useQuery({
    queryKey: ['undo-state', projectId],
    queryFn: () => api.get<UndoState>(`${base}/undo-state`),
    enabled: canEdit,
  });
  const undoState = undoStateQ.data;
  const undo = useMutation({
    mutationFn: () => api.post<{ undo: UndoState }>(`${base}/undo`, {}),
    onSuccess: () => { invalidate(); toast.success('Undone'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Nothing to undo'),
  });
  const redo = useMutation({
    mutationFn: () => api.post<{ undo: UndoState }>(`${base}/redo`, {}),
    onSuccess: () => { invalidate(); toast.success('Redone'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Nothing to redo'),
  });
  // When an edit auto-shifts downstream tasks, tell the user how many moved (honest & non-modal).
  const notifyAutoMoves = (res: { autoScheduled?: AutoMoveRow[] } | undefined) => {
    const n = res?.autoScheduled?.length ?? 0;
    if (n > 0) toast.success(`${n} downstream task${n === 1 ? '' : 's'} auto-shifted to keep dependencies`);
  };
  // Drag-to-reschedule: PUT replaces the whole task, so preserve every field and only move the dates.
  const reschedule = useMutation({
    mutationFn: ({ node, planStart, planEnd }: { node: GanttNode; planStart: string; planEnd: string }) =>
      api.put<{ autoScheduled?: AutoMoveRow[] }>(`${base}/tasks/${node.id}`, {
        name: node.name, planStart, planEnd,
        parentTaskId: node.parentTaskId, sortOrder: node.sortOrder,
        picUserId: node.picUserId ?? undefined, picResourceId: node.picResourceId ?? undefined,
        description: node.description ?? null, deliverable: node.deliverable ?? null, acceptanceCriteria: node.acceptanceCriteria ?? null,
        actualStart: node.actualStart ?? undefined, actualFinish: node.actualFinish ?? undefined,
        progressPct: node.progressPct, isMilestone: node.isMilestone, weight: node.weight,
      }),
    onSuccess: (res) => { invalidate(); notifyAutoMoves(res); },
    onError: (e) => { invalidate(); toast.error(e instanceof ApiError ? e.message : 'Failed to reschedule'); },
  });
  // Inline single-field edit (dates / owner): PUT replaces the whole task, so send the full
  // record and override just the changed field(s). Actual dates carried through as-is so the
  // progress auto-stamp isn't the only way to set them.
  const patchTask = useMutation({
    mutationFn: ({ node, patch }: { node: GanttNode; patch: Record<string, unknown> }) =>
      api.put<{ autoScheduled?: AutoMoveRow[] }>(`${base}/tasks/${node.id}`, {
        name: node.name, planStart: node.planStart, planEnd: node.planEnd,
        progressPct: node.progressPct, isMilestone: node.isMilestone, weight: node.weight,
        parentTaskId: node.parentTaskId, sortOrder: node.sortOrder,
        picUserId: node.picUserId ?? undefined, picResourceId: node.picResourceId ?? undefined,
        description: node.description ?? null, deliverable: node.deliverable ?? null, acceptanceCriteria: node.acceptanceCriteria ?? null,
        actualStart: node.actualStart ?? undefined, actualFinish: node.actualFinish ?? undefined,
        ...patch,
      }),
    onSuccess: (res) => { invalidate(); notifyAutoMoves(res); },
    onError: (e) => { invalidate(); toast.error(e instanceof ApiError ? e.message : 'Failed to save'); },
  });

  // Editing a plan date from the table. Plan Start SHIFTS Plan Finish to keep the duration
  // (MS-Project style) so moving a task earlier/later never produces an invalid start>finish
  // intermediate — the server enforces planEnd>=planStart and would 400 ("Invalid request") if we
  // sent a new start against the old finish. Plan Finish sets the finish directly (changes
  // duration), guarded so it can't land before the start.
  const editPlanStart = (node: GanttNode, v: string) => {
    const dur = Math.max(0, +new Date(node.planEnd) - +new Date(node.planStart));
    const planEnd = new Date(+new Date(v) + dur).toISOString();
    patchTask.mutate({ node, patch: { planStart: v, planEnd } });
  };
  const editPlanEnd = (node: GanttNode, v: string) => {
    if (+new Date(v) < +new Date(node.planStart)) { toast.error('Plan finish can’t be before plan start.'); return; }
    patchTask.mutate({ node, patch: { planEnd: v } });
  };

  // Actual-date tracking edit (set to a specific day, or null to clear). Hits the dedicated
  // /actuals endpoint so it keeps working under a locked baseline — actuals evolve in execution
  // even when the plan is frozen (unlike patchTask, which the API blocks once the baseline locks).
  const setActuals = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { actualStart?: string | null; actualFinish?: string | null } }) =>
      api.patch(`${base}/tasks/${id}/actuals`, patch),
    onSuccess: invalidate,
    onError: (e) => { invalidate(); toast.error(e instanceof ApiError ? e.message : 'Failed to save actual date'); },
  });
  // Inline add-subtask (keeps the draft open for the next sibling on success).
  const createSub = useMutation({
    mutationFn: ({ parentId, name, picResourceId, planStart, planEnd, sortOrder }:
      { parentId: string | null; name: string; picResourceId: string; planStart: string; planEnd: string; sortOrder: number }) =>
      api.post(`${base}/tasks`, {
        name, planStart, planEnd, progressPct: 0, isMilestone: false,
        parentTaskId: parentId ?? undefined, sortOrder, picResourceId: picResourceId || undefined,
      }),
    onSuccess: () => { invalidate(); setDraft((d) => (d ? { ...d, name: '' } : null)); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to add subtask'),
  });
  const addDep = useMutation({
    mutationFn: ({ predecessorId, successorId }: { predecessorId: string; successorId: string }) =>
      api.post<{ autoScheduled?: AutoMoveRow[] }>(`${base}/tasks/${successorId}/dependencies`, { predecessorId, type: 'FS', lagDays: 0 }),
    onSuccess: (res) => { invalidate(); toast.success('Dependency linked'); notifyAutoMoves(res); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not link tasks'),
  });
  // Edit a link's type (FS/SS/FF/SF) / lag; the server re-settles the schedule.
  const updateDep = useMutation({
    mutationFn: ({ depId, type, lagDays }: { depId: string; type: DependencyType; lagDays: number }) =>
      api.patch<{ autoScheduled?: AutoMoveRow[] }>(`${base}/dependencies/${depId}`, { type, lagDays }),
    onSuccess: (res) => { invalidate(); setEditDep(null); toast.success('Dependency updated'); notifyAutoMoves(res); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update dependency'),
  });
  const removeDep = useMutation({
    mutationFn: (depId: string) => api.del(`${base}/dependencies/${depId}`),
    onSuccess: () => { invalidate(); setEditDep(null); toast.success('Dependency removed'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to remove dependency'),
  });
  // Whole-network recompute ("Tidy schedule") — preview via dry-run, then apply on confirm.
  // mode 'push' = settle links only (never pulls earlier); 'asap' = compact (pull tasks
  // earlier to close gaps left by removed/edited links).
  const rescheduleAll = useMutation({
    mutationFn: (mode: 'push' | 'asap') => api.post<AutoScheduleResult>(`${base}/reschedule?mode=${mode}`, {}),
    onSuccess: (res, mode) => {
      invalidate();
      const verb = mode === 'asap' ? 'compacted' : 'tidied';
      toast.success(res.moved.length ? `Schedule ${verb} — ${res.moved.length} task${res.moved.length === 1 ? '' : 's'} moved` : 'Schedule already consistent');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to tidy schedule'),
  });
  const tidySchedule = async (mode: 'push' | 'asap') => {
    const preview = await api.post<AutoScheduleResult>(`${base}/reschedule?dryRun=1&mode=${mode}`, {}).catch((e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to preview'); return null;
    });
    if (!preview) return;
    if (preview.cyclic) { toast.error('Dependencies form a cycle — resolve it before tidying.'); return; }
    if (preview.moved.length === 0) { toast.success('Schedule already consistent — nothing to move.'); return; }
    const asap = mode === 'asap';
    const message = (
      <div className="space-y-2">
        <p>{asap
          ? 'These tasks will move to the earliest working-day dates their dependencies allow (gaps are closed; some tasks may move earlier):'
          : 'These tasks will shift forward to the earliest working-day dates that keep every dependency legal:'}</p>
        <ul className="max-h-40 space-y-0.5 overflow-auto text-xs">
          {preview.moved.slice(0, 8).map((m: AutoMoveRow) => (
            <li key={m.id}><span className="font-medium">{m.wbsCode} {m.name}</span> → {formatDate(new Date(m.toStart))}</li>
          ))}
          {preview.moved.length > 8 && <li className="text-slate-400">…and {preview.moved.length - 8} more</li>}
        </ul>
      </div>
    );
    if (await confirm({
      title: `${asap ? 'Compact' : 'Tidy'} schedule — move ${preview.moved.length} task${preview.moved.length === 1 ? '' : 's'}?`,
      message,
      confirmLabel: asap ? 'Compact schedule' : 'Tidy schedule',
      container: modalContainer,
    })) rescheduleAll.mutate(mode);
  };

  // Indent / outdent (MS-Project style) — re-parent a task within the WBS hierarchy via patchTask.
  // canIndent: has a previous sibling (which becomes the new parent). canOutdent: has a parent
  // (promotes to sit just after that parent under the grandparent). Blocked once the baseline locks.
  const prevSibling = (node: GanttNode): GanttNode | null => {
    const sibs = nav.kidsOf.get(nav.parentOf.get(node.id) ?? null) ?? [];
    const i = sibs.findIndex((s) => s.id === node.id);
    return i > 0 ? sibs[i - 1] : null;
  };
  const canIndent = (node: GanttNode) => !!prevSibling(node);
  const canOutdent = (node: GanttNode) => (nav.parentOf.get(node.id) ?? null) !== null;
  const indentTask = (node: GanttNode) => {
    const parent = prevSibling(node);
    if (!parent) return;
    patchTask.mutate({ node, patch: { parentTaskId: parent.id, sortOrder: parent.children?.length ?? 0 } });
  };
  const outdentTask = (node: GanttNode) => {
    const parentId = nav.parentOf.get(node.id) ?? null;
    if (!parentId) return;
    const parent = nav.nodeById.get(parentId);
    const grandparent = nav.parentOf.get(parentId) ?? null;
    patchTask.mutate({ node, patch: { parentTaskId: grandparent, sortOrder: (parent?.sortOrder ?? 0) + 1 } });
  };

  // Chart interactions: drag a bar to reschedule; click a link handle then another bar to connect them.
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'start' | 'end'; dx: number } | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  // Dependency editor popover: which link is being edited + where to anchor it.
  const [editDep, setEditDep] = useState<{ id: string; x: number; y: number } | null>(null);
  // "Tidy schedule" mode menu (push vs compact) — anchored at the click point, fullscreen-safe.
  const [tidyMenu, setTidyMenu] = useState<{ x: number; y: number } | null>(null);
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
  }, [deps, visibleRows, rolled, axis, scale, fullscreen, expanded, geomTick, drag]);

  if (ganttQ.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;

  // Slip-vs-baseline summary. Rendered inline on the LEFT of the header control row (non-fullscreen)
  // so it doesn't cost a dedicated row above the table — letting the Gantt sit right under the
  // controls. In fullscreen it stays above the timeline instead (the control row is a scroll row).
  const slipBanner = slip.baselined > 0 ? (
    <div className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${slip.late > 0 ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'}`}>
      {slip.late > 0
        ? <>⚠ {slip.late} of {slip.baselined} tasks late vs baseline · worst +{slip.worst}d</>
        : <>✓ All {slip.baselined} baselined tasks on or ahead of schedule</>}
      {criticalIds.size > 0 && <span className="ml-1 text-red-600 dark:text-red-400">· {criticalIds.size} on the critical path</span>}
    </div>
  ) : null;

  // Dependency links touching the hovered row — those connectors pop (brand, thicker) while the
  // rest fade, so a PM can trace a task's predecessors/successors at a glance.
  const activeDepIds = hoverRow
    ? new Set(deps.filter((d) => d.predecessorId === hoverRow || d.successorId === hoverRow).map((d) => d.id))
    : null;
  const isolateCritical = highlightCritical && criticalIds.size > 0;

  return (
    <div ref={fsRef} className={fullscreen ? 'fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col overflow-hidden bg-slate-50 p-3 dark:bg-slate-950 sm:p-5' : ''}>
    {/* In full view the card is a flex column: header stays put, the timeline gets ALL remaining
        height (no magic max-h that breaks when the toolbar wraps or a banner appears). */}
    <Card className={fullscreen ? 'flex min-h-0 flex-1 flex-col' : ''}>
    {importOpen && (
      <ImportTasksModal
        projectId={projectId}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          qc.invalidateQueries({ queryKey: ['gantt', projectId] });
          qc.invalidateQueries({ queryKey: ['cpm', projectId] });
          qc.invalidateQueries({ queryKey: ['evm', base] });
          qc.invalidateQueries({ queryKey: ['next-steps', projectId] });
        }}
      />
    )}
    {weightsOpen && (
      <WeightEditorModal
        base={base}
        phases={ganttQ.data?.tree ?? []}
        baselined={!!baselinedAt}
        onClose={() => setWeightsOpen(false)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['gantt', projectId] });
          qc.invalidateQueries({ queryKey: ['evm', base] });
          qc.invalidateQueries({ queryKey: ['next-steps', projectId] });
        }}
      />
    )}
    {stepsFor && (
      <StepsModal
        base={base}
        taskId={stepsFor.id}
        taskName={stepsFor.name}
        canEdit={canEdit}
        onClose={() => setStepsFor(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['task-steps', stepsFor.id] });
          qc.invalidateQueries({ queryKey: ['gantt', projectId] });
          qc.invalidateQueries({ queryKey: ['evm', base] });
          qc.invalidateQueries({ queryKey: ['next-steps', projectId] });
        }}
      />
    )}
      {/* iOS (and any platform where orientation-lock isn't available) can't auto-rotate — nudge
          the user to turn the device so the timeline gets the full landscape width. */}
      {fullscreen && isTouch && portrait && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <span aria-hidden>↻</span> Rotate your device to landscape for the full timeline.
        </div>
      )}
      <div className={`flex flex-wrap items-center gap-2 ${fullscreen ? 'justify-between mb-2' : 'mb-1'}`}>
        {/* Slip summary on the left (non-fullscreen) — shares the row with the right-aligned
            controls so the table rises directly beneath the buttons instead of a row lower. */}
        {!fullscreen && slipBanner}
        {/* In full view the title block is dropped so the header chrome stays short — on a
            landscape PHONE (~390px tall) it otherwise eats the whole height and collapses the
            timeline to nothing. */}
        {/* The "Work Breakdown Structure" title was dropped (redundant with the Schedule tab).
            Full screen + Today stay visible as one-tap controls; every other control (view toggles,
            timeline scale/zoom, baseline) tucks into a single "Options" popover so the header stays
            one line instead of wrapping into 2–3 rows. */}
        <div className={`flex min-w-0 items-center gap-3 ${fullscreen ? 'w-full' : 'ml-auto flex-wrap'}`}>
        <div className={`flex min-w-0 items-center gap-2 ${fullscreen ? 'min-w-0 flex-nowrap overflow-x-auto pb-1 [&>*]:shrink-0' : 'flex-wrap'}`}>
          {/* Standalone quick actions — Generate-AI + Select stay in the row; every other control
              lives in the consolidated ☰ Menu (below) to keep this toolbar tidy. */}
          {canPlan && (
            <AiTimelineGenerate base={base} projectId={projectId} hasTasks={rows.length > 0} onApplied={invalidate} className={CTRL_BTN} />
          )}
          {canPlan && rows.length > 0 && (
            <button onClick={() => (selectMode ? exitSelect() : setSelectMode(true))} title="Select multiple tasks to delete" className={`${CTRL_BTN} ${selectMode ? '!border-brand-400 !text-brand-700 dark:!text-brand-300' : ''}`}>
              ☑ {selectMode ? 'Selecting…' : 'Select'}
            </button>
          )}
          {rows.length > 0 && (
            <OptionsMenu container={modalContainer}>
              {(close) => (
                <>
                  <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">View</div>
                  <button type="button" onClick={() => { close(); toggleFullscreen(); }} className={OPT_ROW}>
                    <span aria-hidden>⛶</span><span className="flex-1 text-left">{fullscreen ? 'Exit full screen' : 'Full screen'}</span>
                  </button>
                  {showGantt && axis?.todayPct != null && (
                    <button type="button" onClick={() => { close(); scrollToToday(); }} className={OPT_ROW}>
                      <span aria-hidden>↦</span><span className="flex-1 text-left">Scroll to today</span>
                    </button>
                  )}
                  {allParentIds.length > 0 && (
                    <button type="button" onClick={() => setCollapsed((c) => (c.size > 0 ? new Set() : new Set(allParentIds)))} className={OPT_ROW}>
                      <span aria-hidden>{collapsed.size > 0 ? '⊞' : '⊟'}</span><span className="flex-1 text-left">{collapsed.size > 0 ? 'Expand all' : 'Collapse all'}</span>
                    </button>
                  )}
                  {showGantt && (
                    <button type="button" onClick={() => setShowLegend((v) => !v)} className={OPT_ROW}>
                      <span aria-hidden>🏷️</span><span className="flex-1 text-left">{showLegend ? 'Hide legend' : 'Show legend'}</span>
                    </button>
                  )}
                  {showGantt && (
                    <button type="button" disabled={exporting} onClick={() => { close(); downloadGantt(); }} className={`${OPT_ROW} disabled:opacity-50`}>
                      <span aria-hidden>⬇</span><span className="flex-1 text-left">{exporting ? 'Rendering image…' : 'Download as image'}</span>
                    </button>
                  )}
                  {/* Timeline — scale + zoom + row density (kept open so several tweaks are one visit). */}
                  {showGantt && (
                    <>
                      <div className="mb-1 mt-3 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Timeline</div>
                      <div className="flex flex-wrap items-center gap-1.5 px-1">
                        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-700/60">
                          {SCALE_OPTS.map((s) => (
                            <button key={s} type="button" onClick={() => { setScale(s); if (s !== 'fit' && s !== 'width') setZoom(1); }}
                              title={s === 'width' ? 'Fit the whole timeline to the screen width' : s === 'fit' ? `Auto-pick a legible scale for the span${axis?.effScale ? ` (currently ${axis.effScale})` : ''}` : `Scale: ${SCALE_LABEL[s]}`}
                              className={`rounded-md px-2 py-1 text-xs font-medium transition ${scale === s ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-white'}`}>
                              {SCALE_LABEL[s]}
                            </button>
                          ))}
                        </div>
                        <div className="inline-flex items-center overflow-hidden rounded-lg border border-slate-200 dark:border-slate-600">
                          <button type="button" onClick={() => zoomBy(1 / 1.25)} disabled={scale === 'width'} title="Zoom out" className="px-2 py-1 text-sm font-semibold leading-none text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700">−</button>
                          <button type="button" onClick={() => { captureCenter(); setZoom(1); }} disabled={scale === 'width' || Math.abs(zoom - 1) < 0.01} title="Reset zoom to 100%" className="min-w-[3rem] border-l border-slate-200 px-2 py-1 text-[11px] font-semibold leading-none tabular-nums text-slate-500 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">{scale === 'width' ? '—' : `${Math.round(zoom * 100)}%`}</button>
                          <button type="button" onClick={() => zoomBy(1.25)} disabled={scale === 'width'} title="Zoom in" className="border-l border-slate-200 px-2 py-1 text-sm font-semibold leading-none text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">+</button>
                        </div>
                      </div>
                      {criticalIds.size > 0 && (
                        <button type="button" onClick={() => setHighlightCritical((v) => !v)} className={`${OPT_ROW} ${highlightCritical ? '!text-red-600 dark:!text-red-400' : ''}`}>
                          <span aria-hidden>🎯</span><span className="flex-1 text-left">{highlightCritical ? 'Show all tasks' : 'Isolate critical path'}</span>
                        </button>
                      )}
                      <button type="button" onClick={() => setShowBarLabels((v) => !v)} className={OPT_ROW}>
                        <span aria-hidden>🔖</span><span className="flex-1 text-left">{showBarLabels ? 'Hide bar labels' : 'Show bar labels'}</span>
                      </button>
                      {hasFloat && (
                        <button type="button" onClick={() => setShowFloat((v) => !v)} className={`${OPT_ROW} ${showFloat ? '!text-emerald-600 dark:!text-emerald-400' : ''}`}>
                          <span aria-hidden>⇥</span><span className="flex-1 text-left">{showFloat ? 'Hide slack (float)' : 'Show slack (float)'}</span>
                        </button>
                      )}
                    </>
                  )}
                  <button type="button" onClick={() => setDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'))} className={OPT_ROW}>
                    <span aria-hidden>{density === 'compact' ? '≡' : '≣'}</span><span className="flex-1 text-left">{density === 'compact' ? 'Comfortable rows' : 'Compact rows'}</span>
                  </button>
                  {/* Plan — edit actions (write + unlocked baseline). */}
                  {canPlan && (
                    <>
                      <div className="mb-1 mt-3 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Plan</div>
                      <button type="button" onClick={() => { close(); setImportOpen(true); }} className={OPT_ROW}>
                        <span aria-hidden>⬆</span><span className="flex-1 text-left">Import tasks…</span>
                      </button>
                      {(undoState?.canUndo || undoState?.canRedo) && (
                        <>
                          <button type="button" disabled={!undoState?.canUndo || undo.isPending} onClick={() => { close(); undo.mutate(); }} className={`${OPT_ROW} disabled:opacity-40`}>
                            <span aria-hidden>↶</span><span className="flex-1 text-left">{undoState?.undoLabel ? `Undo: ${undoState.undoLabel}` : 'Undo'}</span>
                          </button>
                          <button type="button" disabled={!undoState?.canRedo || redo.isPending} onClick={() => { close(); redo.mutate(); }} className={`${OPT_ROW} disabled:opacity-40`}>
                            <span aria-hidden>↷</span><span className="flex-1 text-left">{undoState?.redoLabel ? `Redo: ${undoState.redoLabel}` : 'Redo'}</span>
                          </button>
                        </>
                      )}
                      {rows.length > 0 && (
                        <button type="button" onClick={() => setWeightsOpen(true)} className={OPT_ROW}>
                          <span aria-hidden>⚖</span><span className="flex-1 text-left">Phase weights…</span>
                        </button>
                      )}
                      {deps.length > 0 && (
                        <button type="button" disabled={rescheduleAll.isPending} onClick={(e) => { const x = e.clientX, y = e.clientY; close(); setTidyMenu({ x, y }); }} className={`${OPT_ROW} disabled:opacity-40`}>
                          <span aria-hidden>🧹</span><span className="flex-1 text-left">Tidy schedule…</span>
                        </button>
                      )}
                      {rows.length > 0 && (
                        <button type="button" onClick={async () => { close(); if (await confirm({ title: 'Clear the whole timeline?', message: <>Delete <strong>all {rows.length} rows</strong> from this schedule? This removes every task and dependency. This cannot be undone.</>, confirmLabel: 'Clear timeline', danger: true, container: modalContainer })) clearAll.mutate(); }} className={`${OPT_ROW} text-red-600 dark:text-red-400`}>
                          <span aria-hidden>🗑</span><span className="flex-1 text-left">Clear timeline…</span>
                        </button>
                      )}
                    </>
                  )}
                  {/* Export — the whole timeline charted horizontally. */}
                  <div className="mb-1 mt-3 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Export</div>
                  <button type="button" disabled={ganttExporting !== null} onClick={() => { close(); exportGantt('pdf'); }} className={`${OPT_ROW} disabled:opacity-40`}>
                    <span aria-hidden>⬇</span><span className="flex-1 text-left">{ganttExporting === 'pdf' ? 'Exporting PDF…' : 'Gantt PDF'}</span>
                  </button>
                  <button type="button" disabled={ganttExporting !== null} onClick={() => { close(); exportGantt('excel'); }} className={`${OPT_ROW} disabled:opacity-40`}>
                    <span aria-hidden>⬇</span><span className="flex-1 text-left">{ganttExporting === 'excel' ? 'Exporting Excel…' : 'Gantt Excel'}</span>
                  </button>
                  {/* Columns — show/hide each column (also: right-click a column header to hide it). */}
                  <div className="mb-1 mt-3 flex items-center justify-between px-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Columns</span>
                    <span className="flex items-center gap-2">
                      {Object.keys(colWidths).length > 0 && <button type="button" onClick={() => setColWidths({})} className="text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400" title="Drag a header's right edge to resize; this resets them">Reset widths</button>}
                      {hiddenCols.size > 0 && <button type="button" onClick={showAllCols} className="text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400">Show all</button>}
                    </span>
                  </div>
                  <p className="px-1 pb-1 text-[10px] leading-tight text-slate-400 dark:text-slate-500">Tip: drag a column header's right edge to resize (double-click to reset).</p>
                  {HIDEABLE_COLS.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">
                      <input type="checkbox" checked={show(c.key)} onChange={() => toggleCol(c.key)} className="h-3.5 w-3.5 accent-brand-600" />
                      <span className="flex-1 text-left">{c.label}</span>
                    </label>
                  ))}
                  <div className="mb-1 mt-3 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Baseline</div>
                  <div className="flex items-center justify-between gap-2 px-1">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{baselinedAt ? `Baselined ${formatDate(baselinedAt)}` : 'No baseline set'}</span>
                    {canEdit && rows.length > 0 && (
                      <Button data-tour="schedule-baseline" variant="secondary" disabled={baseline.isPending} onClick={async () => { close(); if (await confirm({ title: baselinedAt ? 'Re-capture baseline?' : 'Set schedule baseline?', message: baselinedAt ? 'Re-capture the schedule baseline from the current plan dates? This overwrites the existing baseline used for variance.' : 'Capture the current plan dates as the schedule baseline?', confirmLabel: baselinedAt ? 'Re-baseline' : 'Set baseline', container: modalContainer })) baseline.mutate(); }}>
                        {baseline.isPending ? 'Saving…' : baselinedAt ? 'Re-baseline' : 'Set Baseline'}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </OptionsMenu>
          )}
        </div>
        {!fullscreen && rows.length > 0 && isWeighted && (
          <button
            type="button"
            onClick={() => canPlan && setWeightsOpen(true)}
            title={`Project % is steered by manual phase weights${weightsBaselined ? ', frozen at the baseline' : ''}.${canPlan ? ' Click to edit.' : ''}`}
            className={`inline-flex shrink-0 items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 dark:border-brand-900/50 dark:bg-brand-900/20 dark:text-brand-300 ${canPlan ? 'hover:bg-brand-100 dark:hover:bg-brand-900/40' : 'cursor-default'}`}
          >
            ⚖ Weighted{weightsBaselined ? ' · baseline' : ''}
          </button>
        )}
        {!fullscreen && rows.length > 0 && <ProgressBadge pct={overallPct} health={evmQ.data?.health} loading={evmQ.isLoading} />}
        </div>
      </div>

      {/* Multi-select action bar — appears while picking tasks to delete. */}
      {selectMode && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900/50 dark:bg-brand-900/15">
          <span className="font-medium text-brand-800 dark:text-brand-200">{selectedIds.size} selected</span>
          <div className="flex-1" />
          {showGantt && <button onClick={fitToSelection} disabled={!selectedIds.size} title="Zoom the timeline to frame the selected tasks" className={`${CTRL_BTN} disabled:opacity-40`}>⤢ Fit to view</button>}
          <button onClick={() => setSelectedIds(new Set())} disabled={!selectedIds.size} className={`${CTRL_BTN} disabled:opacity-40`}>Clear selection</button>
          <Button
            variant="danger" className="!py-1 text-xs"
            disabled={!selectedIds.size || bulkDelete.isPending}
            onClick={async () => {
              const n = selectedIds.size;
              if (await confirm({ title: 'Delete selected tasks?', message: <>Delete the <strong>{n}</strong> selected task{n === 1 ? '' : 's'} and all of their subtasks? This cannot be undone.</>, confirmLabel: `Delete ${n}`, danger: true, container: modalContainer })) bulkDelete.mutate([...selectedIds]);
            }}>
            🗑 {bulkDelete.isPending ? 'Deleting…' : 'Delete selected'}
          </Button>
          <button onClick={exitSelect} className={CTRL_BTN}>Done</button>
        </div>
      )}

      {!rows.length ? (
        <div className="py-6">
          {canEdit && draft && draft.parentId === null ? (
            // First task: an inline draft row (same monday.com-style editor as add-subtask) — no popup.
            <table className="w-full text-sm"><tbody>
              <DraftRow
                draft={draft} depth={0} colCount={4} resources={resources} saving={createSub.isPending} topLevel
                onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
                onCancel={() => setDraft(null)}
                onSave={() => { if (draft.name.trim()) createSub.mutate({ ...draft, sortOrder: 0 }); }}
              />
            </tbody></table>
          ) : (
            <>
              <p className="text-center text-slate-500 dark:text-slate-400">No work packages yet.</p>
              {canEdit && (
                <div className="mt-3 flex justify-center">
                  <button
                    data-tour="add-task"
                    onClick={() => { const s = nextTaskStart(rows, null) ?? new Date(); setDraft({ parentId: null, name: '', picResourceId: '', planStart: formatDateInput(s), planEnd: formatDateInput(new Date(s.getTime() + DEFAULT_TASK_DAYS * day)) }); }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 transition hover:bg-brand-100 dark:border-brand-700 dark:bg-brand-900/20 dark:text-brand-300 dark:hover:bg-brand-900/40">
                    + Add first task
                  </button>
                </div>
              )}
              {canEdit && (
                <div className="mt-3 flex justify-center">
                  <AiTimelineGenerate base={base} projectId={projectId} hasTasks={false} onApplied={invalidate} />
                </div>
              )}
              {canEdit && <TemplateStarter base={base} onApplied={invalidate} />}
            </>
          )}
        </div>
      ) : (
        <>
        {/* Non-fullscreen shows the slip summary inline in the header row (above); in fullscreen the
            control row is a full-width scroll row, so keep it here above the timeline instead. */}
        {fullscreen && slipBanner && <div className="mb-2">{slipBanner}</div>}
        {/* Timeline legend — a compact key for what the bars encode (toggle in ⚙ Options → View).
            Keeps the dense tracking Gantt self-explanatory without a manual. */}
        {showLegend && showGantt && (
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-5 rounded-full bg-slate-300/70 ring-1 ring-inset ring-black/5 dark:bg-slate-600/50" />Plan track</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-5 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600" />Actual (on&nbsp;track)</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-5 rounded-full bg-gradient-to-b from-amber-300 to-amber-500" />In&nbsp;progress</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-5 rounded-full bg-gradient-to-b from-rose-400 to-red-600" />Late</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-1.5 w-5 rounded-full bg-slate-300/80 dark:bg-slate-600/70" />Baseline</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-sm bg-slate-700 dark:bg-slate-200" />Summary</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px] bg-gradient-to-br from-brand-400 to-brand-600" />Milestone</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full ring-2 ring-inset ring-red-500/70" />Critical&nbsp;path</span>
            {showFloat && hasFloat && (
              <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-5 rounded-full bg-[repeating-linear-gradient(45deg,rgba(16,185,129,0.5)_0,rgba(16,185,129,0.5)_2px,transparent_2px,transparent_5px)] ring-1 ring-inset ring-emerald-500/40" />Slack&nbsp;(float)</span>
            )}
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-px bg-brand-500 shadow-[0_0_6px_rgba(59,130,246,0.55)]" />Today</span>
          </div>
        )}
        {/* Row filter — quick name search + status chips. Narrows long WBS lists; keeps ancestors
            of matches so the hierarchy still reads (see visibleRows). */}
        {rows.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">🔍</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks…"
                aria-label="Search tasks"
                className="w-48 rounded-lg border border-slate-200 bg-white py-1 pl-7 pr-6 text-xs text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
              {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200">×</button>}
            </div>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-700/60">
              {([['all', 'All'], ['late', 'Late'], ['active', 'Active'], ['done', 'Done'], ['todo', 'To-do']] as [StatusFilter, string][]).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setStatusFilter(k)}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition ${statusFilter === k ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>
            {filterActive && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {visibleRows.length} of {rows.length}
                <button type="button" onClick={() => { setSearch(''); setStatusFilter('all'); }} className="ml-2 font-medium text-brand-600 hover:underline dark:text-brand-400">Clear</button>
              </span>
            )}
          </div>
        )}
        <div className={`relative w-full min-w-0 ${fullscreen ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
        {/* w-full clamps the scroll box to the viewport so the wide table scrolls INSIDE it (never
            pushes the page); in full view flex-1/min-h-0 fills the remaining height robustly — a %
            `h-full` resolved to 0 inside the native-fullscreen element on mobile, so a rotate left
            the timeline collapsed/stuck. */}
        <div ref={scrollRef}
          style={!fullscreen && panelH ? { height: panelH } : undefined}
          className={`touch-pan-x touch-pan-y w-full overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 ${fullscreen ? 'min-h-0 flex-1' : panelH ? '' : 'max-h-[78vh]'}`}>
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
                {arrows.map((a) => {
                  const on = activeDepIds?.has(a.id);
                  const stroke = a.bad
                    ? 'stroke-red-400'
                    : on
                      ? 'stroke-brand-500 dark:stroke-brand-400'
                      : activeDepIds
                        ? 'stroke-slate-300/40 dark:stroke-slate-700/50'
                        : 'stroke-slate-400 dark:stroke-slate-500';
                  return <path key={a.id} d={a.d} markerEnd={`url(#arrow-${uid})`} className={`fill-none ${stroke} transition-colors`} strokeWidth={on ? 2.5 : 1.5} />;
                })}
              </svg>
              {/* Edit handles — a small chip at each connector's midpoint. Click to open the
                  dependency editor (type FS/SS/FF/SF, lag, delete). Shows the current type. */}
              {canPlan && arrows.map((a) => {
                const dep = deps.find((d) => d.id === a.id);
                return (
                  <button key={a.id} type="button" title="Edit dependency (type / lag)"
                    onClick={() => setEditDep({ id: a.id, x: a.mx, y: a.my })}
                    className="absolute z-[9] grid h-4 min-w-[1.1rem] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-slate-300 bg-white px-1 text-[8px] font-semibold leading-none text-slate-500 opacity-0 shadow-sm transition hover:border-brand-400 hover:text-brand-600 group-hover:opacity-70 hover:!opacity-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"
                    style={{ left: a.mx, top: a.my }}>{dep?.type ?? 'FS'}</button>
                );
              })}
              {/* Dependency editor popover (anchored to the connector midpoint). */}
              {editDep && (() => {
                const dep = deps.find((d) => d.id === editDep.id);
                if (!dep) return null;
                return (
                  <>
                    <div className="fixed inset-0 z-[40]" onClick={() => setEditDep(null)} />
                    <div className="absolute z-[41] w-56 -translate-x-1/2 translate-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800"
                      style={{ left: editDep.x, top: editDep.y }} onClick={(e) => e.stopPropagation()}>
                      <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">Dependency</div>
                      <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">Type</label>
                      <Select value={dep.type} onChange={(e) => updateDep.mutate({ depId: dep.id, type: e.target.value as DependencyType, lagDays: dep.lagDays })} className="mb-2 w-full text-sm">
                        <option value="FS">Finish → Start (FS)</option>
                        <option value="SS">Start → Start (SS)</option>
                        <option value="FF">Finish → Finish (FF)</option>
                        <option value="SF">Start → Finish (SF)</option>
                      </Select>
                      <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">Lag / lead (working days)</label>
                      <Input type="number" defaultValue={dep.lagDays} className="mb-3 w-full text-sm"
                        onBlur={(e) => { const v = parseInt(e.target.value, 10) || 0; if (v !== dep.lagDays) updateDep.mutate({ depId: dep.id, type: dep.type, lagDays: v }); }} />
                      <div className="flex items-center justify-between">
                        <button type="button" className="text-xs font-medium text-red-500 hover:underline"
                          onClick={async () => { if (await confirm({ title: 'Remove dependency?', message: 'Delete this task link?', confirmLabel: 'Remove', danger: true, container: modalContainer })) removeDep.mutate(dep.id); }}>Remove link</button>
                        <button type="button" className="text-xs text-slate-500 hover:underline dark:text-slate-400" onClick={() => setEditDep(null)}>Close</button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </>
          )}
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              {/* Row 1 — ✓/WBS/Task are frozen (sticky-left). Plan & Actual groups + Dur/Budget
                  appear only in the "Show dates" spreadsheet view; the spanning cells span 2 rows
                  then (rowSpan=hrs), 1 otherwise. */}
              <tr className="text-center text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100 [&>th]:sticky [&>th]:top-0 [&>th]:z-20 [&>th]:bg-slate-200 [&>th]:dark:bg-slate-800 [&>th]:py-2 [&>th]:px-2 [&>th]:border-slate-300 [&>th]:border-r [&>th]:border-r-slate-300/80 dark:[&>th]:border-r-slate-700 [&>th:last-child]:border-r-0">
                <th rowSpan={showDates ? 2 : 1} style={frozenLeft(0, { width: 40, minWidth: 40, maxWidth: 40 })} className={`border-b-4 border-b-rose-400 text-center align-bottom ${frozenTh}`} title={selectMode ? 'Select all' : 'Mark task / subtask complete'}>
                  {selectMode ? (
                    <input
                      type="checkbox" aria-label="Select all tasks"
                      checked={visibleRows.length > 0 && visibleRows.every((r) => selectedIds.has(r.node.id))}
                      onChange={(e) => setSelectedIds(e.target.checked ? new Set(visibleRows.map((r) => r.node.id)) : new Set())}
                      className="h-4 w-4 accent-brand-600"
                    />
                  ) : <span className="text-slate-300 dark:text-slate-600">✓</span>}
                </th>
                <th rowSpan={showDates ? 2 : 1} style={frozenLeft(40, { width: 48, minWidth: 48, maxWidth: 48 })} className={`border-b-4 border-b-rose-400 align-bottom ${frozenTh}`}>WBS</th>
                <th rowSpan={showDates ? 2 : 1} style={frozenLeft(88, colStyle('task'))} className={`relative ${colWidths.task ? '' : 'min-w-[14rem]'} border-b-4 border-b-rose-400 text-center align-bottom ${frozenTh} ${frozenEdge}`}>Task<ColGrip col="task" /></th>
                {/* Data columns — each hideable via right-click (restore in ⚙ Options → Columns). */}
                {show('owner') && <th rowSpan={showDates ? 2 : 1} style={colStyle('owner')} onContextMenu={(e) => openColMenu('owner', 'Owner', e)} className="relative cursor-context-menu border-b-4 border-b-rose-400 align-bottom" title="Owner (PIC) — right-click to hide">Owner<ColGrip col="owner" /></th>}
                {show('planDates') && (
                  <th colSpan={2} onContextMenu={(e) => openColMenu('planDates', 'Plan dates', e)} className="cursor-context-menu border-b-2 border-slate-800 !bg-slate-700 !py-1 text-center text-[11px] font-bold uppercase tracking-wide !text-white dark:border-slate-900 dark:!bg-slate-700" title="Planned (baseline plan) dates — right-click to hide">Plan</th>
                )}
                {show('actualDates') && (
                  <th colSpan={2} onContextMenu={(e) => openColMenu('actualDates', 'Actual dates', e)} className="cursor-context-menu border-b-2 border-teal-800 !bg-teal-700 !py-1 text-center text-[11px] font-bold uppercase tracking-wide !text-white dark:border-teal-900 dark:!bg-teal-700" title="Actual start & finish (tracking) — right-click to hide">Actual</th>
                )}
                {show('dur') && <th rowSpan={showDates ? 2 : 1} style={colStyle('dur')} onContextMenu={(e) => openColMenu('dur', 'Duration', e)} className="relative cursor-context-menu border-b-4 border-b-amber-400 align-bottom !bg-amber-800 !text-white" title="Duration — right-click to hide">Dur<ColGrip col="dur" /></th>}
                {show('budget') && <th rowSpan={showDates ? 2 : 1} style={colStyle('budget')} onContextMenu={(e) => openColMenu('budget', 'Budget', e)} className="relative cursor-context-menu border-b-4 border-b-amber-400 align-bottom !bg-amber-800 !text-white" title="Linked Direct Cost (the EVM budget weight) — right-click to hide">Budget<ColGrip col="budget" /></th>}
                {show('weight') && <th rowSpan={showDates ? 2 : 1} style={colStyle('weight')} onContextMenu={(e) => openColMenu('weight', 'Weight', e)} className="relative cursor-context-menu border-b-4 border-b-amber-400 align-bottom !bg-amber-800 !text-white" title="Manual work-package weight steers the % roll-up — right-click to hide">Weight<ColGrip col="weight" /></th>}
                {show('pct') && <th rowSpan={showDates ? 2 : 1} style={colStyle('pct')} onContextMenu={(e) => openColMenu('pct', '% complete', e)} className="relative cursor-context-menu border-b-4 border-b-violet-400 text-center align-bottom !bg-blue-800 !text-white" title="% complete — right-click to hide"><span className="inline-flex flex-col items-center leading-tight"><span className="text-[9px] font-semibold uppercase tracking-wide text-blue-200">Progress</span><span>%</span></span><ColGrip col="pct" /></th>}
                {show('status') && <th rowSpan={showDates ? 2 : 1} style={colStyle('status')} onContextMenu={(e) => openColMenu('status', 'Status', e)} className="relative cursor-context-menu border-b-4 border-b-violet-400 align-bottom !bg-blue-800 !text-white" title="Status — right-click to hide">Status<ColGrip col="status" /></th>}
                {show('var') && <th rowSpan={showDates ? 2 : 1} style={colStyle('var')} onContextMenu={(e) => openColMenu('var', 'Variance', e)} className="relative cursor-context-menu border-b-4 border-b-violet-400 align-bottom !bg-blue-800 !text-white" title="Finish variance vs baseline (days) — right-click to hide">Var<ColGrip col="var" /></th>}
                {/* Timeline header — dynamic ticks for the chosen scale + a Today marker */}
                {showGantt && (
                  <th ref={timelineRef} rowSpan={showDates ? 2 : 1} onContextMenu={(e) => openColMenu('timeline', 'Timeline (Gantt)', e)} className="cursor-context-menu border-b border-slate-200 align-bottom dark:border-slate-800" title="Timeline — right-click to hide">
                    <div className="relative h-4" style={{ width: axis?.width }}>
                      {axis?.ticks.map((t) => (
                        <span key={t.key} className={`absolute -top-1 whitespace-nowrap normal-case ${t.major ? 'rounded bg-slate-300 px-1 py-px text-[10px] font-bold text-slate-800 dark:bg-slate-700 dark:text-slate-100' : 'top-0 text-[9px] font-medium text-slate-400 dark:text-slate-500'}`} style={{ left: `${t.leftPct}%` }}>{t.label}</span>
                      ))}
                      {axis?.todayPct != null && (
                        <span className="absolute -top-0.5 z-10 -translate-x-1/2 rounded bg-brand-600 px-1 text-[9px] font-semibold normal-case text-white" style={{ left: `${axis.todayPct}%` }}>Today</span>
                      )}
                    </div>
                  </th>
                )}
              </tr>
              {/* Row 2 — the Start/Finish sub-labels under each VISIBLE date group. */}
              {showDates && (
                <tr className="text-center text-[11px] uppercase tracking-wide text-slate-700 dark:text-slate-200 [&>th]:sticky [&>th]:top-[25px] [&>th]:z-20 [&>th]:bg-slate-200 [&>th]:dark:bg-slate-800 [&>th]:border-b [&>th]:border-slate-300 [&>th]:dark:border-slate-800 [&>th]:py-1 [&>th]:px-2 [&>th]:text-center [&>th]:font-bold [&>th]:border-r [&>th]:border-r-slate-300/80 dark:[&>th]:border-r-slate-700">
                  {show('planDates') && <><th className="!bg-slate-600 !text-slate-100 !border-b-4 !border-b-sky-400 dark:!bg-slate-600 dark:!text-slate-100">Start</th><th className="!bg-slate-600 !text-slate-100 !border-b-4 !border-b-sky-400 dark:!bg-slate-600 dark:!text-slate-100">Finish</th></>}
                  {show('actualDates') && <><th className="!bg-emerald-600 !text-emerald-50 !border-b-4 !border-b-emerald-400 dark:!bg-emerald-600 dark:!text-emerald-50">Start</th><th className="!bg-emerald-600 !text-emerald-50 !border-b-4 !border-b-emerald-400 dark:!bg-emerald-600 dark:!text-emerald-50">Finish</th></>}
                </tr>
              )}
            </thead>
            <tbody>
              {filterActive && visibleRows.length === 0 && (
                <tr><td colSpan={99} className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">No tasks match your search / filter.</td></tr>
              )}
              {visibleRows.map(({ node, depth, wbs }, rowIdx) => {
                const r = rolled.get(node.id) ?? { start: +new Date(node.planStart), end: +new Date(node.planEnd), dur: node.durationDays, wt: node.effectiveWeightPct || node.durationDays || 0, pct: node.progressPct, budget: node.budgetCost, isParent: false, baseStart: null, baseEnd: null, actualStart: ts(node.actualStart), actualFinish: ts(node.actualFinish) };
                const st = statusOf(r.pct);
                // Zebra striping — the opaque frozen cells carry the same bg so the stripe + hover
                // read continuously across the frozen/scroll boundary.
                const alt = rowIdx % 2 === 1;
                // Zebra bg MUST be opaque: these classes land on the sticky/frozen cells, and a
                // translucent fill let the horizontally-scrolled columns bleed THROUGH the frozen
                // Task/WBS panel. Opaque slate-50 keeps the zebra subtle while sealing the bleed.
                const rowBg = alt ? 'bg-slate-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-900';
                const rowHover = 'group-hover:bg-slate-100 dark:group-hover:bg-slate-800';
                const hasKids = !!node.children?.length;
                const isCollapsed = collapsed.has(node.id);
                const isCritical = criticalIds.has(node.id);
                // "Late/overdue" = unfinished and past its planned finish DATE (whole days, so a task
                // due today isn't flagged until tomorrow) → red bar + badge.
                const overdue = r.pct < 100 && Math.floor(r.end / day) < Math.floor(Date.now() / day);
                const inProgress = r.pct > 0 && r.pct < 100;
                const bar = BAR[overdue ? 'red' : st.color] ?? BAR.slate;
                const leftPct = axis ? ((r.start - axis.min) / axis.span) * 100 : 0;
                const widthPct = axis ? Math.max(axis.minBarPct, ((r.end - r.start) / axis.span) * 100) : 0;
                // Slack ghost — total float (days) trailing the plan bar, for non-critical leaves only.
                const floatDays = showFloat && !r.isParent && !node.isMilestone && !isCritical ? (floatById.get(node.id) ?? 0) : 0;
                const floatPct = axis && floatDays > 0 ? (floatDays * day / axis.span) * 100 : 0;
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
                // Variance connector: a short line from the BASELINE finish to the current/actual
                // finish, drawn under the bar (red = late, green = early). Leaf tasks that slipped.
                const baseEndPct = axis && r.baseEnd != null ? ((r.baseEnd - axis.min) / axis.span) * 100 : null;
                const finishPct = axis ? ((finishMs - axis.min) / axis.span) * 100 : null;
                const showVarConnector = !node.isMilestone && !r.isParent && varDays != null && varDays !== 0 && baseEndPct != null && finishPct != null;
                const hasDict = !!(node.description || node.deliverable || node.acceptanceCriteria || node.picResource || node.pic);
                const isOpen = expanded.has(node.id);
                const togglingId = progress.isPending && progress.variables?.id === node.id;
                return (
                  <Fragment key={node.id}>
                  <tr
                    data-task-row={node.id}
                    onMouseEnter={() => setHoverRow(node.id)}
                    onMouseLeave={() => setHoverRow((h) => (h === node.id ? null : h))}
                    onContextMenu={(e) => {
                      // Right-click a task row → the action menu. Skip when the target is a form field
                      // (date/owner/% inline editors) so their native context menu still works.
                      if (!canEdit || (e.target as HTMLElement).closest('input,select,textarea')) return;
                      e.preventDefault();
                      openRowMenu(node, e.clientX, e.clientY);
                    }}
                    className={`group [&>td]:border-b [&>td]:border-slate-200 [&>td]:dark:border-slate-800 ${density === 'compact' ? '[&>td]:py-1.5' : '[&>td]:py-3'} [&>td]:px-2 [&>td]:text-center [&>td]:transition-colors ${depth === 0 && rowIdx > 0 ? '[&>td]:!border-t-2 [&>td]:!border-t-slate-300 dark:[&>td]:!border-t-slate-700' : ''} ${alt ? 'bg-slate-50 dark:bg-slate-800' : ''} hover:bg-slate-100 dark:hover:bg-slate-800 ${node.id === flashId ? '[&>td]:!bg-amber-100 dark:[&>td]:!bg-amber-900/40' : ''}`}>
                    <td style={frozenLeft(0, { width: 40, minWidth: 40, maxWidth: 40 })} className={`text-center ${frozenTd} ${rowBg} ${rowHover}`}>
                      <div className="flex justify-center">
                        {selectMode ? (
                          <input type="checkbox" aria-label={`Select ${node.name}`} checked={selectedIds.has(node.id)} onChange={() => toggleSel(node.id)} className="h-4 w-4 accent-brand-600" />
                        ) : (
                          <CircleCheck pct={r.pct} readOnly={!canEdit || r.isParent || node.stepCount > 0} busy={togglingId} onSet={(v) => progress.mutate({ id: node.id, pct: v })} />
                        )}
                      </div>
                    </td>
                    <td style={frozenLeft(40, { width: 48, minWidth: 48, maxWidth: 48 })} className={`font-mono text-xs text-slate-600 dark:text-slate-300 ${frozenTd} ${rowBg} ${rowHover}`}>{wbs}</td>
                    <td style={frozenLeft(88)} className={`!text-left ${frozenTd} ${stickyCol ? '' : 'relative'} group-hover:z-[25] ${rowBg} ${rowHover} ${frozenEdge} ${NAME_ACCENT[overdue ? 'red' : st.color] ?? ''}`}>
                      <span style={{ paddingLeft: `${depth * 18}px` }} className="flex items-center gap-1">
                        {hasKids && (
                          <button onClick={() => toggleCollapse(node.id)} aria-label={isCollapsed ? 'Expand subtasks' : 'Collapse subtasks'} title={isCollapsed ? 'Expand subtasks' : 'Collapse subtasks'} className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-sm text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100">
                            <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="currentColor" aria-hidden><path d="M7 5l6 5-6 5V5z" /></svg>
                          </button>
                        )}
                        {SHOW_WBS_DICTIONARY && (
                          <button onClick={() => toggle(node.id)} title={canPlan ? 'WBS dictionary — click to view / edit' : 'WBS dictionary'} className={`grid h-4 w-4 shrink-0 place-items-center rounded text-[10px] ${hasDict ? 'text-brand-600' : 'text-slate-300 dark:text-slate-600'} hover:bg-slate-200 dark:hover:bg-slate-700`}>
                            {isOpen ? '▾' : 'ⓘ'}
                          </button>
                        )}
                        {node.isMilestone && <span className="text-brand-600" title="Milestone">◆</span>}
                        <InlineName value={node.name} editable={canPlan} done={r.pct >= 100} depthZero={depth === 0} onSave={(name) => patchTask.mutate({ node, patch: { name } })} />
                        {/* Compact view: surface each phase's weighted share here since the Weight column
                            is hidden. Parents only, and only when weighting is actually in effect. */}
                        {isWeighted && !showDates && hasKids && (
                          <span title={`Weighted share of the project %${weightsBaselined ? ' (baseline)' : ''}`} className="shrink-0 rounded bg-brand-50 px-1 text-[10px] font-medium tabular-nums text-brand-600 dark:bg-brand-900/20 dark:text-brand-300">
                            ⚖ {node.effectiveWeightPct}%
                          </span>
                        )}
                        {isCollapsed && hasKids && <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">⋯</span>}
                        {isCritical && <span className="shrink-0 text-[10px] font-bold text-red-500" title="On the critical path — a slip here delays the whole project">▲ CP</span>}
                        {canEdit && (
                          // Actions affordance: opens the same menu as right-click. Always visible on
                          // touch (no right-click there); hover-reveal on desktop to keep the row clean.
                          <button type="button" title="Task actions — or right-click the row"
                            onClick={(e) => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); openRowMenu(node, rect.left, rect.bottom + 4); }}
                            className={`ml-auto grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200 ${isTouch ? '' : 'opacity-0 focus:opacity-100 group-hover:opacity-100'}`}>⋮</button>
                        )}
                      </span>
                      {/* Inline insert: a "+" straddling the row's bottom edge (in the Task column) —
                          hover-reveal; click to add a task right after this row (same level). The td
                          is sticky (=positioned) so this absolute button anchors to it. */}
                      {canPlan && (
                        <button type="button" title="Add a task here"
                          onClick={(e) => { e.stopPropagation(); insertAfter(node, r.end); }}
                          style={{ left: 6 + depth * 18 }}
                          className={`absolute -bottom-2.5 z-30 grid h-5 w-5 place-items-center text-lg font-bold leading-none text-slate-600 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 ${isTouch ? '' : 'opacity-0 focus:opacity-100 group-hover:opacity-100'}`}>+</button>
                      )}
                    </td>
                    {show('owner') && <td className="!text-left">{canEdit
                      ? <OwnerPopover owners={orderedOwners(node)} node={node} editable resources={resources} container={modalContainer} onSave={(patch) => patchTask.mutate({ node, patch })} />
                      : <OwnerCell owners={orderedOwners(node)} />}</td>}
                    {show('planDates') && (
                      <>
                        {/* Plan Start — rolls up (read-only) on summary rows; leaf is click-to-edit
                            whenever the baseline is UNLOCKED (canPlan). Drag-reschedule is separately
                            frozen once a baseline exists (canDrag), but click-editing plan dates must
                            work after a change request unlocks the baseline — else an approved CR
                            can't actually be applied. */}
                        <td className="whitespace-nowrap text-center">
                          {r.isParent
                            ? <span className="text-xs font-bold text-slate-600 dark:text-slate-300" title="Rolls up from subtasks">{formatDate(new Date(r.start))}</span>
                            : <InlineDate value={node.planStart} editable={canPlan} onSave={(v) => v && editPlanStart(node, v)} title={canPlan ? 'Plan start — click to edit (keeps duration, shifts finish)' : 'Baseline locked — approve a change request (or unlock the baseline) to edit plan dates'} />}
                        </td>
                        {/* Plan Finish */}
                        <td className="whitespace-nowrap text-center">
                          {r.isParent
                            ? <span className="text-xs font-bold text-slate-600 dark:text-slate-300" title="Rolls up from subtasks">{formatDate(new Date(r.end))}</span>
                            : <InlineDate value={node.planEnd} editable={canPlan} onSave={(v) => v && editPlanEnd(node, v)} title={canPlan ? 'Plan finish — click to edit' : 'Baseline locked — approve a change request (or unlock the baseline) to edit plan dates'} />}
                        </td>
                      </>
                    )}
                    {show('actualDates') && (
                      <>
                        {/* Actual Start — leaf tasks; always editable while tracking (auto-stamp fills it only if empty). */}
                        <td className="whitespace-nowrap text-center">
                          {r.isParent
                            ? (r.actualStart != null
                                ? <span className="text-xs font-bold text-slate-600 dark:text-slate-300" title="Rolls up: earliest actual start of subtasks">{formatDate(new Date(r.actualStart))}</span>
                                : <span className="text-slate-300 dark:text-slate-600">—</span>)
                            : <InlineDate value={node.actualStart} editable={canEdit} onSave={(v) => setActuals.mutate({ id: node.id, patch: { actualStart: v } })} title="Actual start — click to set (blank to clear)" />}
                        </td>
                        {/* Actual Finish */}
                        <td className="whitespace-nowrap text-center">
                          {r.isParent
                            ? (r.actualFinish != null
                                ? <span className="text-xs font-bold text-slate-600 dark:text-slate-300" title="Rolls up: latest actual finish (all subtasks complete)">{formatDate(new Date(r.actualFinish))}</span>
                                : <span className="text-slate-300 dark:text-slate-600">—</span>)
                            : <InlineDate value={node.actualFinish} editable={canEdit} onSave={(v) => setActuals.mutate({ id: node.id, patch: { actualFinish: v } })} title="Actual finish — click to set (blank to clear)" />}
                        </td>
                      </>
                    )}
                    {show('dur') && <td className="text-center tabular-nums text-xs text-slate-600 dark:text-slate-300">{r.dur}d</td>}
                    {show('budget') && (
                        <td className={`text-center tabular-nums text-xs ${r.isParent ? 'font-medium text-slate-600 dark:text-slate-300' : 'text-slate-600 dark:text-slate-300'}`} title={r.isParent ? 'Rolled up from subtasks' : 'Linked Direct Cost'}>
                          {r.budget > 0 ? formatIdrShort(r.budget) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                        </td>
                    )}
                    {show('weight') && (
                        /* Manual work-package weight (Model B) + the effective project share it resolves to. */
                        <td className="whitespace-nowrap text-center">
                          {canPlan ? (
                            <input
                              type="number" min={0} step="any" defaultValue={node.weight ?? ''} key={`w-${node.weight}`}
                              placeholder="auto" aria-label={`Weight for ${node.name}`}
                              title="Manual weight — set on a Main Task to steer the % roll-up. Blank = auto (cost/duration)."
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                const v = raw === '' ? null : Math.max(0, Number(raw));
                                if (v !== (node.weight ?? null)) patchTask.mutate({ node, patch: { weight: v } });
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              className="w-14 rounded border border-transparent bg-slate-50 px-1 py-0.5 text-center text-xs tabular-nums text-slate-700 transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-400 dark:bg-slate-800/60 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-slate-600"
                            />
                          ) : node.weight != null ? (
                            <span className="tabular-nums text-xs text-slate-600 dark:text-slate-300">{node.weight}</span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">auto</span>
                          )}
                          <span className="ml-1 tabular-nums text-[10px] text-slate-400 dark:text-slate-500" title="Effective share of the whole project this task/phase carries">{r.wt > 0 ? `${node.effectiveWeightPct}%` : ''}</span>
                        </td>
                    )}
                    {show('pct') && (
                    <td className="text-right">
                      {node.stepCount > 0 && !r.isParent ? (
                        // Derived from weighted steps → read-only; click to view/edit the steps.
                        <button type="button" onClick={() => setStepsFor(node)}
                          title={`Derived from ${node.stepCount} weighted step${node.stepCount === 1 ? '' : 's'} — click to view/edit`}
                          className="inline-flex items-center gap-0.5 tabular-nums text-xs text-brand-700 hover:underline dark:text-brand-300">
                          {r.pct}% <span className="text-[9px]" aria-hidden>☑{node.stepCount}</span>
                        </button>
                      ) : canEdit && !r.isParent ? (
                        <input
                          type="number" min={0} max={100} defaultValue={node.progressPct} key={node.progressPct}
                          aria-label={`Percent complete for ${node.name}`}
                          style={{ background: pctFillBg(node.progressPct) }}
                          onChange={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); e.currentTarget.style.background = pctFillBg(v); }}
                          onBlur={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value))); e.currentTarget.style.background = pctFillBg(v); if (v !== node.progressPct) progress.mutate({ id: node.id, pct: v }); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className="w-16 rounded-lg border border-slate-200/70 px-1 py-0.5 text-center text-xs font-normal tabular-nums text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.12)] transition [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/50 dark:border-slate-700 dark:text-white"
                        />
                      ) : (
                        <span className={`tabular-nums text-xs ${r.isParent ? 'font-bold text-slate-600 dark:text-slate-300' : ''}`} title={r.isParent ? 'Rolled up from subtasks' : undefined}>
                          {r.pct}%
                        </span>
                      )}
                    </td>
                    )}
                    {show('status') && <td><Badge color={overdue ? 'red' : st.color}>{overdue ? 'Overdue' : st.label}</Badge></td>}
                    {show('var') && (
                    <td className="text-center tabular-nums text-xs">
                      {varDays == null ? (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      ) : (
                        <span title={`${varIsActual ? 'Actual' : 'Forecast'} finish vs baseline (${formatDate(new Date(r.baseEnd!))})`} className={varDays > 0 ? 'font-medium text-red-600 dark:text-red-400' : varDays < 0 ? 'font-medium text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}>
                          {varDays > 0 ? `+${varDays}d` : varDays < 0 ? `${varDays}d` : '0'}{varIsActual && <span className="ml-0.5 text-slate-400 dark:text-slate-500" title="Based on the confirmed actual finish">✓</span>}
                        </span>
                      )}
                    </td>
                    )}
                    {showGantt && (
                    <td>
                      <div
                        ref={(el) => { if (el) barRefs.current.set(node.id, el); else barRefs.current.delete(node.id); }}
                        data-left={node.isMilestone ? msLeft : leftPct}
                        data-width={node.isMilestone ? 0 : widthPct}
                        onClick={() => { if (linkFrom && linkFrom !== node.id) { addDep.mutate({ predecessorId: linkFrom, successorId: node.id }); setLinkFrom(null); } }}
                        className={`group/bar relative h-8 transition-opacity ${isolateCritical && !isCritical ? 'opacity-25' : ''} ${linkFrom && linkFrom !== node.id ? 'cursor-crosshair rounded ring-1 ring-inset ring-brand-400/50 hover:bg-brand-500/5' : ''}`}
                        style={{ width: axis?.width }}
                      >
                        {/* Past-shading — a whisper-faint wash over everything before Today so the
                            "now" boundary reads instantly without hunting for the marker line. */}
                        {axis?.todayPct != null && axis.todayPct > 0 && (
                          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 bg-slate-500/[0.035] dark:bg-slate-950/25" style={{ width: `${axis.todayPct}%` }} />
                        )}
                        {/* Weekend columns (day zoom only) — faint band behind bars/gridlines */}
                        {axis?.weekends.map((w) => (
                          <div key={w.key} aria-hidden className="pointer-events-none absolute inset-y-0 bg-slate-200/45 dark:bg-slate-700/30" style={{ left: `${w.leftPct}%`, width: `${w.widthPct}%` }} />
                        ))}
                        {/* month/period gridlines + today marker for orientation */}
                        {axis?.ticks.filter((t) => t.major).map((t) => (
                          <div key={t.key} className="absolute inset-y-0 w-px bg-slate-200/70 dark:bg-slate-700/50" style={{ left: `${t.leftPct}%` }} />
                        ))}
                        {axis?.todayPct != null && (
                          <div className="absolute inset-y-0 z-10 w-px bg-brand-500/80 shadow-[0_0_6px_rgba(59,130,246,0.55)]" style={{ left: `${axis.todayPct}%` }} />
                        )}
                        {/* Variance connector — baseline finish → current/actual finish (red late, green early). */}
                        {showVarConnector && (
                          <>
                            <div className="pointer-events-none absolute top-[24px] z-[3] h-[7px] w-px bg-slate-400/70 dark:bg-slate-500/70" style={{ left: `${baseEndPct}%` }} title={`Baseline finish · ${formatDate(new Date(r.baseEnd!))}`} />
                            <div
                              className="pointer-events-none absolute top-[26px] z-[3] h-[3px] rounded-full"
                              style={{ left: `${Math.min(baseEndPct!, finishPct!)}%`, width: `${Math.max(0.4, Math.abs(finishPct! - baseEndPct!))}%`, backgroundColor: varDays! > 0 ? '#ef4444' : '#22c55e' }}
                              title={`${varDays! > 0 ? `+${varDays}` : varDays}d vs baseline (${formatDate(new Date(r.baseEnd!))} → ${formatDate(new Date(finishMs))})`}
                            />
                          </>
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
                              className={`absolute top-1/2 z-[5] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] shadow-md ring-2 ring-white dark:ring-slate-900 ${SHEEN} ${draggable ? 'cursor-grab touch-none active:cursor-grabbing' : ''} ${dragging ? 'ring-brand-400' : ''} ${overdue ? BAR.red.fill : r.pct >= 100 ? bar.fill : 'bg-gradient-to-br from-brand-400 to-brand-600'}`}
                              style={{ left: `${dragging ? msLeft + dShiftPct : msLeft}%` }}
                              title={r.pct >= 100 && node.actualFinish ? `Milestone reached · ${formatDate(new Date(node.actualFinish))}` : `Milestone (planned) · ${formatDate(new Date(r.end))}`}
                            />
                            {/* milestone date label — a quiet marker so exec readers get the date without a hover */}
                            <span className="pointer-events-none absolute top-1/2 z-[6] -translate-y-1/2 whitespace-nowrap text-[9px] font-medium tabular-nums text-slate-500 dark:text-slate-400" style={{ left: `calc(${Math.min(msLeft, 94)}% + 11px)` }}>
                              {formatDate(new Date(msMs))}
                            </span>
                          </>
                        ) : r.isParent ? (
                          <>
                            {/* Summary (parent/phase) bracket — MS-Project style: a slim charcoal
                                spine spanning its children with down-turned end caps + an inner RAG
                                progress fill. Instantly signals "rolled-up phase", not a work package. */}
                            {baseLeft != null && baseWidth != null && (
                              <div className="absolute top-2 h-1 rounded-full bg-slate-300/70 dark:bg-slate-600/60" style={{ left: `${baseLeft}%`, width: `${baseWidth}%` }} title={`Baseline: ${formatDate(new Date(r.baseStart!))} → ${formatDate(new Date(r.baseEnd!))}`} />
                            )}
                            <div
                              className={`absolute top-[13px] h-[7px] overflow-hidden rounded-sm bg-slate-700 shadow-sm dark:bg-slate-200 ${SHEEN}`}
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              title={`${node.name}: ${formatDate(new Date(r.start))} → ${formatDate(new Date(r.end))} · ${r.pct}%`}
                            >
                              <div className={`h-full ${overdue ? 'bg-red-500' : st.color === 'green' ? 'bg-emerald-500' : st.color === 'amber' ? 'bg-amber-500' : 'bg-slate-400 dark:bg-slate-500'}`} style={{ width: `${r.pct}%` }} />
                            </div>
                            {/* down-turned end caps (the classic summary "rooftop" tabs) */}
                            <div aria-hidden className="pointer-events-none absolute top-[13px] h-[9px] w-[9px] bg-slate-700 dark:bg-slate-200" style={{ left: `${leftPct}%`, clipPath: 'polygon(0 0, 100% 0, 0 100%)' }} />
                            <div aria-hidden className="pointer-events-none absolute top-[13px] h-[9px] w-[9px] -translate-x-full bg-slate-700 dark:bg-slate-200" style={{ left: `${leftPct + widthPct}%`, clipPath: 'polygon(100% 0, 0 0, 100% 100%)' }} />
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
                              className={`group/track absolute top-3 h-[15px] overflow-hidden rounded-full ${isCritical ? 'ring-2 ring-red-500/70' : 'ring-1 ring-inset ring-black/5 dark:ring-white/10'} ${bar.track} ${draggable ? 'cursor-grab touch-none active:cursor-grabbing' : ''} ${dragging ? 'ring-2 ring-brand-400' : ''}`}
                              style={{ left: `${pLeft}%`, width: `${pWidth}%` }}
                              title={dragging ? 'Release to reschedule' : `Plan: ${formatDate(new Date(r.start))} → ${formatDate(new Date(r.end))}`}
                            >
                              {/* resize handles (leaf, editable) */}
                              {draggable && <span onPointerDown={(e) => startDrag(e, node, 'start')} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize touch-none rounded-l-full bg-black/25 opacity-0 group-hover/track:opacity-100 dark:bg-white/25" />}
                              {draggable && <span onPointerDown={(e) => startDrag(e, node, 'end')} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none rounded-r-full bg-black/25 opacity-0 group-hover/track:opacity-100 dark:bg-white/25" />}
                            </div>
                            {/* slack ghost — total float trailing the plan bar (faded green hatch); how far
                                this task can slip before it hits the critical path. Hidden while dragging. */}
                            {floatPct > 0 && !dragging && (
                              <div
                                aria-hidden
                                className="pointer-events-none absolute top-3 h-[15px] rounded-r-full bg-[repeating-linear-gradient(45deg,rgba(16,185,129,0.5)_0,rgba(16,185,129,0.5)_2px,transparent_2px,transparent_5px)] ring-1 ring-inset ring-emerald-500/30"
                                style={{ left: `${leftPct + widthPct}%`, width: `${floatPct}%` }}
                                title={`Slack: ${floatDays} day${floatDays === 1 ? '' : 's'} of float before this task becomes critical`}
                              />
                            )}
                            {/* actual bar — vivid, at REAL dates, overlaid on the plan track (leaf tasks that started) */}
                            {started && (
                              <div
                                className={`pointer-events-none absolute top-[13px] z-[6] h-[13px] rounded-full shadow-sm ${SHEEN} ${bar.fill} ${r.pct < 100 ? 'opacity-95' : ''}`}
                                style={{ left: `${actLeft}%`, width: `${actWidth}%` }}
                                title={`${r.pct >= 100 ? 'Actual' : 'Actual so far'}: ${formatDate(new Date(actStart))} → ${r.pct >= 100 ? formatDate(new Date(actEnd)) : 'today'} · ${r.pct}%`}
                              />
                            )}
                            {/* in-progress pulse at the leading (today) edge */}
                            {started && inProgress && axis && (
                              <span className={`pointer-events-none absolute top-[15px] z-[7] h-[9px] w-[9px] -translate-x-1/2 animate-pulse rounded-full ring-2 ring-white dark:ring-slate-900 ${overdue ? 'bg-red-400' : 'bg-amber-400'}`} style={{ left: `${actLeft + actWidth}%` }} />
                            )}
                            {/* % label for in-progress leaves (wide bars only) — sits just past the leading edge */}
                            {started && inProgress && actWidth > 3 && (
                              <span className="pointer-events-none absolute top-[10px] z-[7] text-[9px] font-semibold leading-none tabular-nums text-slate-500 dark:text-slate-300" style={{ left: `calc(${Math.min(actLeft + actWidth, 92)}% + 12px)` }}>{r.pct}%</span>
                            )}
                            {/* optional in-bar label — the task name trailing its bar, so the timeline
                                reads on its own (toggle in ⚙ Options → Timeline → Bar labels). */}
                            {showBarLabels && (
                              <span className="pointer-events-none absolute top-1/2 z-[5] max-w-[38%] -translate-y-1/2 truncate whitespace-nowrap text-[10px] font-medium text-slate-600 dark:text-slate-300" style={{ left: `calc(${Math.min(leftPct + widthPct, 88)}% + ${started && inProgress ? 34 : 8}px)` }}>{node.name}</span>
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
                  {SHOW_WBS_DICTIONARY && isOpen && (
                    <tr>
                      <td colSpan={colCount} className="border-b border-slate-100 bg-slate-50/60 px-3 py-3 dark:border-slate-800 dark:bg-slate-800/30">
                        {canPlan
                          ? <DictionaryEditor node={node} resources={resources} onSave={(patch) => patchTask.mutate({ node, patch })} />
                          : <DictionaryView node={node} />}
                      </td>
                    </tr>
                  )}
                  {/* Subtask draft (right-click → Add subtask): renders as this node's first child. */}
                  {draft?.parentId === node.id && !draft.afterId && (
                    <DraftRow
                      draft={draft} depth={depth + 1} colCount={colCount} resources={resources} saving={createSub.isPending}
                      onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
                      onCancel={() => setDraft(null)}
                      onSave={() => { if (draft.name.trim()) createSub.mutate({ ...draft, sortOrder: node.children.length }); }}
                    />
                  )}
                  {/* Inline "+" insert: renders right AFTER this row, as a same-level sibling. */}
                  {draft?.afterId === node.id && (
                    <DraftRow
                      draft={draft} depth={depth} colCount={colCount} resources={resources} saving={createSub.isPending} topLevel={draft.parentId === null}
                      onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
                      onCancel={() => setDraft(null)}
                      onSave={() => { if (draft.name.trim()) createSub.mutate({ ...draft, sortOrder: (node.sortOrder ?? 0) + 1 }); }}
                    />
                  )}
                  </Fragment>
                );
              })}
            </tbody>
            {/* Pinned totals footer — a stable, at-a-glance project roll-up that stays put while the
                rows scroll. Sticky bottom so it reads like a spreadsheet summary bar. */}
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={99} className="sticky bottom-0 z-20 border-t border-slate-300 bg-slate-100/95 px-3 py-1.5 text-left text-[11px] font-medium text-slate-600 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95 dark:text-slate-300">
                    <span className="tabular-nums">{totals.count}</span> task{totals.count === 1 ? '' : 's'}
                    <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span><span className="tabular-nums text-emerald-600 dark:text-emerald-400">{totals.done} done</span>
                    {totals.late > 0 && <><span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span><span className="tabular-nums text-red-600 dark:text-red-400">{totals.late} late</span></>}
                    {totals.ms > 0 && <><span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span><span className="tabular-nums">◆ {totals.ms} milestone{totals.ms === 1 ? '' : 's'}</span></>}
                    {totals.budget > 0 && <><span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>Σ&nbsp;<span className="tabular-nums">{formatIdrShort(totals.budget)}</span></>}
                    <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>overall&nbsp;<span className="tabular-nums font-semibold text-slate-700 dark:text-slate-100">{Math.round(overallPct)}%</span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
          </div>
        </div>
        {/* Right-edge fade — dissolves any partially-scrolled column into the card edge so the
            horizontal cut-off reads as intentional, not ragged. z-40 so it sits ABOVE the sticky
            header (th are z-20/z-30) — otherwise the header column would clip hard while the body
            faded. pointer-events-none so it never blocks the scrollbar or a bar drag. */}
        {overflowX && <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-40 w-16 rounded-r-xl bg-gradient-to-l from-white via-white/85 to-transparent dark:from-slate-900 dark:via-slate-900/85" />}
        </div>
          {/* Full-screen toggle placed directly BELOW the Gantt — a second, obvious entry point to
              the immersive timeline (the toolbar keeps its own compact toggle). */}
          {rows.length > 0 && (
            <div className={`mt-2 flex justify-center sm:justify-end ${fullscreen ? 'hidden' : ''}`}>
              <button onClick={toggleFullscreen} title={fullscreen ? 'Exit full screen (Esc)' : 'View the Gantt full screen'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-700 dark:hover:bg-brand-900/20 dark:hover:text-brand-300">
                {fullscreen ? <><CollapseIcon /> Exit full screen</> : <><ExpandIcon /> Full screen</>}
              </button>
            </div>
          )}
          {/* Drag handle — grow/shrink the timeline box in the normal view (fullscreen already fills
              the screen). Height persists per project; double-click resets to the default cap. */}
          {!fullscreen && rows.length > 0 && (
            <div
              onPointerDown={startResize}
              onDoubleClick={() => { setPanelH(null); localStorage.removeItem(HKEY); }}
              role="separator" aria-orientation="horizontal" aria-label="Resize the timeline height"
              title="Drag to resize the timeline · double-click to reset"
              className="group mt-1 flex h-3.5 cursor-row-resize touch-none select-none items-center justify-center"
            >
              <span className="h-1 w-10 rounded-full bg-slate-300 transition group-hover:bg-brand-400 dark:bg-slate-600 dark:group-hover:bg-brand-500" />
            </div>
          )}
          {/* Tracking-Gantt legend — outside the scroll box (kept in the card) so it stays visible
              without scrolling the table. Hidden in full view: it's tall (2 rows) and would steal
              the height the timeline needs on a landscape phone. */}
          {/* Two-tier legend: the visual KEY (colour swatches) reads as a tidy row; the interaction
              TIPS + governance notes drop to a smaller, muted second line so the key isn't buried in
              prose. Both hidden in full view (the immersive timeline keeps its chrome minimal). */}
          <div className={`mt-3 border-t border-slate-100 pt-2.5 dark:border-slate-800 ${fullscreen ? 'hidden' : 'block'}`}>
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-5 rounded-full bg-slate-300/80 dark:bg-slate-600/70" />Baseline</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-full bg-slate-300/50 ring-1 ring-inset ring-black/5 dark:bg-slate-600/40 dark:ring-white/10" />Plan</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-emerald-500" />Actual · done</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-amber-500" />In progress</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-red-500" />Late / overdue</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px] bg-brand-500" />Milestone</span>
              <span className="flex items-center gap-1.5"><span className="h-[3px] w-5 rounded-full bg-red-500" />Slip vs baseline</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-full ring-2 ring-red-500/70" />Critical path</span>
              <span className="flex items-center gap-1.5"><svg width="26" height="8" className="overflow-visible"><line x1="1" y1="4" x2="20" y2="4" className="stroke-slate-400 dark:stroke-slate-500" strokeWidth="1.5" markerEnd={`url(#arrow-${uid})`} /></svg>Dependency</span>
            </div>
            {(canDrag || canPlan || canEdit || baselineLocked) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-slate-400 dark:text-slate-500">
                {canDrag && <span>Drag a bar to reschedule</span>}
                {canPlan && <span>· ⛓ handle to link tasks</span>}
                {canEdit && <span>· right-click a task (or ⋮) for subtask / indent / delete</span>}
                {canPlan && baselinedAt && <span className="text-amber-600 dark:text-amber-400">· schedule baselined — reschedule via a change request</span>}
                {baselineLocked && <span className="text-amber-600 dark:text-amber-400">· baseline locked — unlock to edit the schedule</span>}
              </div>
            )}
          </div>
        </>
      )}

      {del.isError && <p className="mt-2 text-sm text-red-600">{(del.error as Error).message}</p>}

      {menu && (
        <RowMenu
          x={menu.x} y={menu.y} container={modalContainer} onClose={() => setMenu(null)}
          items={(() => {
            const n = menu.node;
            return [
              { label: 'Add subtask', icon: '＋', disabled: !canPlan, onClick: () => setDraft({ parentId: n.id, name: '', picResourceId: '', planStart: formatDateInput(new Date(n.planStart)), planEnd: formatDateInput(new Date(n.planEnd)) }) },
              // Progress steps only make sense on a leaf work package (a parent's % rolls up from its children).
              ...(!n.children?.length ? [{ label: n.stepCount > 0 ? `Progress steps (${n.stepCount})` : 'Progress steps', icon: '☑', onClick: () => setStepsFor(n) }] : []),
              ...(SHOW_WBS_DICTIONARY ? [{ label: expanded.has(n.id) ? 'Close details' : 'Edit details', icon: '✎', onClick: () => toggle(n.id) }] : []),
              { separator: true },
              { label: 'Indent', icon: '⇥', hint: 'make subtask', disabled: !canPlan || !canIndent(n), onClick: () => indentTask(n) },
              { label: 'Outdent', icon: '⇤', hint: 'promote', disabled: !canPlan || !canOutdent(n), onClick: () => outdentTask(n) },
              { separator: true },
              { label: 'Delete', icon: '🗑', danger: true, disabled: !canPlan, onClick: async () => { if (await confirm({ title: 'Delete task?', message: <>Delete <strong>{n.name}</strong> and all of its subtasks? This cannot be undone.</>, confirmLabel: 'Delete', danger: true, container: modalContainer })) del.mutate(n.id); } },
            ];
          })()}
        />
      )}
      {/* Tidy-schedule mode chooser — push (settle) vs asap (compact). Portaled → fullscreen-safe. */}
      {tidyMenu && (
        <RowMenu
          x={tidyMenu.x} y={tidyMenu.y} container={modalContainer} onClose={() => setTidyMenu(null)}
          items={[
            { label: 'Settle links', icon: '🔗', hint: 'push only', onClick: () => tidySchedule('push') },
            { label: 'Compact', icon: '🧹', hint: 'pull earlier', onClick: () => tidySchedule('asap') },
          ]}
        />
      )}
      {/* Right-click-a-column-header menu — hide that column (restore via ⚙ Options → Columns). */}
      {colMenu && (
        <RowMenu
          x={colMenu.x} y={colMenu.y} container={modalContainer} onClose={() => setColMenu(null)}
          items={[
            { label: `Hide “${colMenu.label}”`, icon: '🚫', onClick: () => hideCol(colMenu.key) },
          ]}
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
      <Item label="Owner (PIC)" value={orderedOwners(node).map((o) => o.name).join(', ') || undefined} />
      <Item label="Deliverable" value={node.deliverable} />
      <div className="sm:col-span-2"><Item label="Description / Scope" value={node.description} /></div>
      <div className="sm:col-span-2"><Item label="Acceptance criteria" value={node.acceptanceCriteria} /></div>
    </div>
  );
}

// Inline add-task / add-subtask row (monday.com style) — editable name / owner / plan dates
// in-column; Enter saves & keeps the row open for the next sibling, Esc cancels. The Save/Cancel
// buttons sit RIGHT NEXT TO the name (in the Task cell) so the confirm action is where the eye is.
function DraftRow({ draft, depth, colCount, resources, saving, topLevel, onChange, onCancel, onSave }: {
  draft: { name: string; picResourceId: string; planStart: string; planEnd: string };
  depth: number; colCount: number; resources: ResourceItem[]; saving: boolean;
  topLevel?: boolean; // a new top-level task (via "+ Add Task") vs a subtask (via "+ Sub")
  onChange: (patch: Partial<{ name: string; picResourceId: string; planStart: string; planEnd: string }>) => void;
  onCancel: () => void; onSave: () => void;
}) {
  const inp = 'rounded border border-brand-300 bg-white px-1.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400 dark:border-brand-600 dark:bg-slate-800 dark:text-slate-100';
  const kind = topLevel ? 'Task' : 'Subtask';
  return (
    <tr className="bg-brand-50/40 dark:bg-brand-900/10 [&>td]:border-b [&>td]:border-slate-100 [&>td]:dark:border-slate-800 [&>td]:py-1.5 [&>td]:pr-3">
      <td className="text-center text-brand-500">＋</td>
      <td className="font-mono text-[10px] uppercase text-brand-500">new</td>
      <td>
        <span style={{ paddingLeft: `${depth * 18}px` }} className="flex items-center gap-1">
          <input autoFocus value={draft.name} placeholder={`${kind} name…`} aria-label={`${kind} name`}
            onChange={(e) => onChange({ name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSave(); } else if (e.key === 'Escape') onCancel(); }}
            className={`${inp} min-w-[6rem] flex-1`} />
          {/* Save/Cancel right beside the name — the confirm action is near the task, not off-screen. */}
          <button disabled={!draft.name.trim() || saving} onClick={onSave} title="Save (Enter)"
            className="shrink-0 rounded bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={onCancel} title="Cancel (Esc)"
            className="shrink-0 rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800" aria-label="Cancel">✕</button>
        </span>
      </td>
      {/* Owner + plan dates live inline in ONE trailing cell, so the draft row stays correct no matter
          which data columns are currently hidden (they'd otherwise misalign under the wrong headers). */}
      <td colSpan={Math.max(1, colCount - 3)} className="whitespace-nowrap text-left text-[11px] text-slate-400 dark:text-slate-500">
        <span className="mr-2 inline-flex flex-wrap items-center gap-1 align-middle">
          <select value={draft.picResourceId} onChange={(e) => onChange({ picResourceId: e.target.value })} className={`${inp} max-w-[9rem]`} aria-label={`${kind} owner`}>
            <option value="">— owner —</option>
            {resources.map((r) => <option key={r.id} value={r.id}>{r.name}{r.roleTitle ? ` · ${r.roleTitle}` : ''}</option>)}
          </select>
          <input type="date" value={draft.planStart} onChange={(e) => onChange({ planStart: e.target.value })} className={`${inp} w-32 text-right`} aria-label={`${kind} plan start`} title="Plan start" />
          <span className="text-slate-400">→</span>
          <input type="date" value={draft.planEnd} onChange={(e) => onChange({ planEnd: e.target.value })} className={`${inp} w-32 text-right`} aria-label={`${kind} plan finish`} title="Plan finish" />
        </span>
        <span className="hidden sm:inline">Enter = save · Esc = cancel</span>
      </td>
    </tr>
  );
}

// Editable WBS dictionary — shown when an editor expands a row (the ⓘ / "Details" toggle). Owner &
// Milestone commit immediately (selects/checkbox); the free-text fields (Deliverable / Description /
// Acceptance) commit on blur when changed. No popup — every field is filled straight under the row.
// Multi-owner picker for a work package: tick everyone assigned; ★ marks the LEAD (picResourceId).
// Each change commits the FULL set (ownerResourceIds) plus the lead in one PUT — the server replaces
// the owner links and always keeps the lead inside the set.
function OwnerPicker({ node, resources, onSave }: {
  node: GanttNode; resources: ResourceItem[]; onSave: (patch: Record<string, unknown>) => void;
}) {
  const selected = new Set((node.owners ?? []).map((o) => o.id));
  const lead = node.picResourceId ?? null;
  const label = 'text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';
  const emit = (ids: string[], newLead: string | null) => onSave({ ownerResourceIds: ids, picResourceId: newLead });
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    const ids = [...next];
    emit(ids, lead && next.has(lead) ? lead : (ids[0] ?? null)); // keep lead if still selected, else first / none
  };
  const makeLead = (id: string) => { const next = new Set(selected); next.add(id); emit([...next], id); };
  return (
    <div className="block sm:col-span-2">
      <span className={label}>Owners (PIC) <span className="font-normal normal-case text-slate-400 dark:text-slate-500">— tick everyone assigned; ★ marks the lead</span>
        <InfoTip text="Tick to assign an owner, untick to remove. Click ★ to set the lead; unticking the lead promotes the next owner. Add people in Resources first." />
      </span>
      <div className="mt-1 max-h-44 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
        {resources.length === 0 && <p className="px-2.5 py-2 text-xs text-slate-400 dark:text-slate-500">No resources in the master yet — add people under Resources first.</p>}
        {resources.map((r) => {
          const on = selected.has(r.id);
          const isLead = lead === r.id;
          return (
            <div key={r.id} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <input type="checkbox" checked={on} onChange={() => toggle(r.id)} className="accent-brand-600" aria-label={`Assign ${r.name}`} />
              <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{r.name}{r.roleTitle ? <span className="text-slate-400 dark:text-slate-500"> · {r.roleTitle}</span> : ''}</span>
              <button type="button" onClick={() => makeLead(r.id)} disabled={isLead}
                title={isLead ? 'Lead owner' : 'Make lead owner'} aria-label={isLead ? `${r.name} is the lead owner` : `Make ${r.name} the lead owner`}
                className={`text-sm leading-none ${isLead ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400 dark:text-slate-600 dark:hover:text-amber-400'}`}>{isLead ? '★' : '☆'}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DictionaryEditor({ node, resources, onSave }: {
  node: GanttNode; resources: ResourceItem[]; onSave: (patch: Record<string, unknown>) => void;
}) {
  const [deliverable, setDeliverable] = useState(node.deliverable ?? '');
  const [description, setDescription] = useState(node.description ?? '');
  const [acceptance, setAcceptance] = useState(node.acceptanceCriteria ?? '');
  const label = 'text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';
  const inp = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
  // Commit a free-text field only when it actually changed (blank → null so it clears cleanly).
  const commit = (field: string, value: string, current: string | null | undefined) => {
    const v = value.trim() || null;
    if (v !== (current ?? null)) onSave({ [field]: v });
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <OwnerPicker node={node} resources={resources} onSave={onSave} />
      <label className="flex items-end gap-2 pb-1.5 text-sm text-slate-600 dark:text-slate-300 sm:col-span-2">
        <input type="checkbox" checked={node.isMilestone} onChange={(e) => onSave({ isMilestone: e.target.checked })} className="mb-0.5 accent-brand-600" />
        <span>Milestone <span className="text-slate-400 dark:text-slate-500">(zero-duration marker ◆)</span></span>
      </label>
      <label className="block sm:col-span-2">
        <span className={label}>Deliverable</span>
        <input value={deliverable} onChange={(e) => setDeliverable(e.target.value)} onBlur={() => commit('deliverable', deliverable, node.deliverable)}
          placeholder="e.g. Signed-off design document" className={inp} />
      </label>
      <label className="block sm:col-span-2">
        <span className={label}>Description / scope</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => commit('description', description, node.description)}
          rows={2} placeholder="What this work package covers" className={`${inp} resize-y`} />
      </label>
      <label className="block sm:col-span-2">
        <span className={label}>Acceptance criteria</span>
        <textarea value={acceptance} onChange={(e) => setAcceptance(e.target.value)} onBlur={() => commit('acceptanceCriteria', acceptance, node.acceptanceCriteria)}
          rows={2} placeholder="Definition of done" className={`${inp} resize-y`} />
      </label>
    </div>
  );
}

