import { Fragment, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { CostSummary, DirectCost, Evm, GanttNode, ResourceItem } from '../../api/types';
import { Button, Card, FormError, Input, MoneyInput, Select, PanelLoading } from '../../components/ui';
import RebaselineReminder from '../../components/RebaselineReminder';
import CostSummaryPanel from '../../components/CostSummaryPanel';
import { KpiIcon, accentSurface, type Accent, type IconName } from '../../components/KpiIcon';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useProjectWrite } from '../../lib/useProjectWrite';
import ImportCostModal from '../../components/ImportCostModal';
import { formatDateInput, formatIdr, formatIdrShort, formatNum } from '../../lib/format';

// Sentinel description of the auto-derived "labour from timesheet" AC entry (mirrors the server).
const LABOUR_AC_DESC = 'Labour actual (from timesheet)';

const DIRECT_TYPES = [
  { value: 'TECHNOLOGY_ONPREM', label: 'Technology — On-Premise' },
  { value: 'TECHNOLOGY_CLOUD', label: 'Technology — Cloud' },
  { value: 'HARDWARE_LICENSE', label: 'Hardware License' },
  { value: 'HARDWARE_EQUIPMENT', label: 'Hardware / Equipment' },
  { value: 'SOFTWARE_LICENSE', label: 'Software License' },
  { value: 'SUBCONTRACTOR', label: 'Subcontractor / Prof. Services' },
  { value: 'TRAINING_CERTIFICATION', label: 'Training & Certification' },
  { value: 'SUPPORT_MAINTENANCE', label: 'Support & Maintenance (AMC)' },
  { value: 'MANPOWER', label: 'Manpower' },
  { value: 'OTHER', label: 'Other' },
];
const INDIRECT_TYPES = [
  { value: 'TRANSPORTATION', label: 'Transportation' },
  { value: 'ACCOMMODATION', label: 'Accommodation' },
  { value: 'MEALS_PERDIEM', label: 'Meals & Per Diem' },
  { value: 'COMMUNICATION', label: 'Communication' },
  { value: 'OFFICE_SUPPLIES', label: 'Office Supplies (ATK)' },
  { value: 'MEETING_VENUE', label: 'Meeting & Venue' },
  { value: 'ENTERTAINMENT', label: 'Entertainment' },
  { value: 'OTHER', label: 'Other' },
];

// Cost families — group the direct types into readable categories (Manpower on its own, then
// Hardware, Software/Licenses, Technology, Services, Other). Grouping is derived from `type`, so
// no per-line category field is needed; the order here is the display order of the sections.
const DIRECT_FAMILIES = [
  { key: 'MANPOWER', label: 'Manpower', icon: '👷', types: ['MANPOWER'] },
  { key: 'HARDWARE', label: 'Hardware & Equipment', icon: '🖥️', types: ['HARDWARE_EQUIPMENT', 'HARDWARE_LICENSE'] },
  { key: 'SOFTWARE', label: 'Software & Licenses', icon: '💿', types: ['SOFTWARE_LICENSE'] },
  { key: 'TECHNOLOGY', label: 'Technology / Infrastructure', icon: '☁️', types: ['TECHNOLOGY_CLOUD', 'TECHNOLOGY_ONPREM'] },
  { key: 'SERVICES', label: 'Services', icon: '🤝', types: ['SUBCONTRACTOR', 'TRAINING_CERTIFICATION', 'SUPPORT_MAINTENANCE'] },
  { key: 'OTHER', label: 'Other', icon: '📦', types: ['OTHER'] },
] as const;
const FAMILY_OF: Record<string, string> = Object.fromEntries(DIRECT_FAMILIES.flatMap((f) => f.types.map((t) => [t, f.key])));
const familyOf = (type: string) => FAMILY_OF[type] ?? 'OTHER';

// Enum value → friendly label lookup (falls back to a humanized enum for any unknown/legacy value).
const DIRECT_LABEL: Record<string, string> = Object.fromEntries(DIRECT_TYPES.map((t) => [t.value, t.label]));
const INDIRECT_LABEL: Record<string, string> = Object.fromEntries(INDIRECT_TYPES.map((t) => [t.value, t.label]));
const humanize = (v: string) => v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
// Render a type as its friendly label, appending the free-text sub-category for OTHER lines.
const typeLabel = (map: Record<string, string>, type: string, subCategory?: string | null) => {
  const base = map[type] ?? humanize(type);
  return type === 'OTHER' && subCategory ? `${base} · ${subCategory}` : base;
};

// Flatten a gantt tree to its leaf tasks (work packages manpower is assigned to).
function flattenLeaves(nodes: GanttNode[]): GanttNode[] {
  return nodes.flatMap((n) => (n.children?.length ? flattenLeaves(n.children) : [n]));
}

// Accordion section header: chevron + title + line count on the left, total on the right. When a
// `spent`/`budget` pair is given, a thin spent-vs-budget mini-bar is shown beneath so a COLLAPSED
// section still communicates its drawdown status at a glance. Always visible; clicking it toggles.
function AccordionHeader({ title, count, total, open, onToggle, icon, accent, spent, budget }: { title: string; count: number; total: string; open: boolean; onToggle: () => void; icon?: IconName; accent?: Accent; spent?: number; budget?: number }) {
  const showBar = typeof spent === 'number' && typeof budget === 'number' && budget > 0;
  const pct = showBar ? Math.min(100, (spent! / budget!) * 100) : 0;
  const over = showBar && spent! > budget!;
  const fill = over ? 'bg-red-500' : pct >= 90 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <button onClick={onToggle} aria-expanded={open} className="-m-1 flex w-full flex-col gap-1.5 rounded-lg p-1 text-left">
      <span className="flex w-full items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          {icon && accent && <KpiIcon name={icon} accent={accent} className="h-6 w-6" />}
          <span className="font-bold text-slate-900 dark:text-white">{title}</span>
          <span className="text-xs text-slate-400">{count} {count === 1 ? 'line' : 'lines'}</span>
        </span>
        <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900 dark:text-white">{total}</span>
      </span>
      {showBar && (
        <span className="flex items-center gap-2 pl-6">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <span className={`block h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-slate-400" title={`Spent ${formatIdr(spent!)} of ${formatIdr(budget!)}`}>
            {formatIdrShort(spent!)} spent{over ? ' · over' : ''}
          </span>
        </span>
      )}
    </button>
  );
}

export default function CostPanel({ projectId, onNavigateTab, focusId, focusKey }: { projectId: string; onNavigateTab?: (tab: string) => void; focusId?: string | null; focusKey?: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState({ direct: true, indirect: false, actual: false });
  const toggle = (k: 'direct' | 'indirect' | 'actual') => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const base = `/projects/${projectId}/cost`;
  // Attribution target for the Actual Cost form, lifted here so a per-line "+ Record AC"
  // button (in the Direct/Indirect tables) can preset it, expand the AC section, and scroll
  // to the form — booking spend in-context against the line the user is looking at.
  const [acTarget, setAcTarget] = useState('gen:DIRECT');
  const actualRef = useRef<HTMLDivElement>(null);
  const bookToLine = (t: string) => {
    setAcTarget(t);
    setOpen((o) => ({ ...o, actual: true }));
    // Let the section expand before scrolling the now-visible form into view.
    setTimeout(() => actualRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  const { data, isLoading } = useQuery({
    queryKey: ['cost', projectId],
    queryFn: () => api.get<CostSummary>(base),
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cost', projectId] });
    qc.invalidateQueries({ queryKey: ['project', projectId] });
    qc.invalidateQueries({ queryKey: ['evm'] }); // Cost-tab EV/AC/CV/CPI strip + Schedule-tab EvmPanel
    qc.invalidateQueries({ queryKey: ['forecast'] }); // Forecast tab (EAC/ETC/VAC)
    qc.invalidateQueries({ queryKey: ['portfolio'] }); // dashboard CPI/AC rollup
    qc.invalidateQueries({ queryKey: ['gantt', projectId] }); // WBS mandays/budget + Owner prefilled from a manpower resource
  };

  // Deep-link from a budget notification or an Anett citation (?focus=). Three targets:
  //  • 'baseline' / 'spent' — summary anchors (charter↔baseline banner / drawdown tiles).
  //  • a budget-line id     — an Anett [[cite:CODE|Cost|<id>]]; open the accordion holding it and flash
  //    the row (DirectCosts also expands the line's collapsed family). An unknown id is a no-op — the
  //    tab still opened, so it's never a dead link.
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId || !data) return;
    const isKeyword = focusId === 'baseline' || focusId === 'spent';
    const isDirect = data.directCosts.some((d) => d.id === focusId);
    const isIndirect = data.indirectCosts.some((i) => i.id === focusId);
    if (!isKeyword && !isDirect && !isIndirect) return;
    if (isDirect) setOpen((o) => ({ ...o, direct: true }));
    if (isIndirect) setOpen((o) => ({ ...o, indirect: true }));
    setFlash(focusId);
    // A line citation needs the accordion (and DirectCosts' family) to expand first — give it a beat.
    const s = setTimeout(() => document.querySelector(`[data-cost-focus="${focusId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), isKeyword ? 150 : 260);
    const c = setTimeout(() => setFlash(null), 2800);
    return () => { clearTimeout(s); clearTimeout(c); };
  }, [focusId, focusKey, data]);

  if (isLoading) return <PanelLoading />;
  const b = data?.baseline;
  // Budget composition + drawdown now live in <CostSummaryPanel> (it derives spend/remaining from the
  // same summary), so this panel no longer computes those totals inline.

  return (
    <div className="space-y-5">
      {/* Budget/drawdown summary — full width. Baseline setup/lock moved to the project-header gate
          chip; the summary carries a compact lock-status pill (near BAC/PMB) so "is the baseline
          frozen?" is answerable while reading the budget. Keeps the ?focus=spent deep-link anchor. */}
      <div className={`rounded-xl transition-all ${flash === 'spent' ? 'p-2 ring-2 ring-amber-400' : ''}`}>
        <CostSummaryPanel summary={data!} projectId={projectId} />
      </div>
      {/* Nudge to re-lock after a change opened the baseline (e.g. an approved CR). */}
      <RebaselineReminder projectId={projectId} />
      {data?.highLevelCharterCost != null && b && (
        <div data-cost-focus="baseline" className={`rounded-xl transition-all ${flash === 'baseline' ? 'ring-2 ring-amber-400' : ''}`}><CharterVariance charter={data.highLevelCharterCost} bac={Number(b.costBaseline)} /></div>
      )}

      {/* Cost lines as collapsible accordion sections (header + total always visible). */}
      <DirectCosts data={data!} base={base} projectId={projectId} onChange={invalidate} open={open.direct} onToggle={() => toggle('direct')} onBookAc={bookToLine} onNavigateTab={onNavigateTab} flashId={flash} />
      <IndirectCosts data={data!} base={base} projectId={projectId} onChange={invalidate} open={open.indirect} onToggle={() => toggle('indirect')} onBookAc={bookToLine} flashId={flash} />
      <div ref={actualRef}>
        <ActualCosts data={data!} base={base} projectId={projectId} onChange={invalidate} open={open.actual} onToggle={() => toggle('actual')} target={acTarget} setTarget={setAcTarget} />
      </div>
    </div>
  );
}

function ActualCosts({ data, base, projectId, onChange, open, onToggle, target, setTarget }: { data: CostSummary; base: string; projectId: string; onChange: () => void; open: boolean; onToggle: () => void; target: string; setTarget: (t: string) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const canWrite = useProjectWrite(projectId, ['FINANCE']);
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  // Attribution target ('gen:DIRECT' / 'gen:INDIRECT' = no line, or 'd:<id>' / 'i:<id>' = a
  // specific line) is owned by the parent so a per-line "+ Record AC" button can preset it.
  const isGeneral = target.startsWith('gen:');

  // Budget lines pickable for per-component attribution + a label lookup for the entry list.
  // Manpower lines draw their actual from the timesheet, so only material lines are attributable.
  const directLineOptions = data.directCosts.filter((d) => d.type !== 'MANPOWER');
  const lineLabel = new Map<string, string>();
  for (const d of data.directCosts) lineLabel.set(d.id, d.label);
  for (const i of data.indirectCosts) lineLabel.set(i.id, i.description);

  // Turn the picked target into the request payload (line id + derived category).
  const targetPayload = (): { category: 'DIRECT' | 'INDIRECT'; directLineId?: string; indirectLineId?: string } => {
    if (target.startsWith('d:')) return { category: 'DIRECT', directLineId: target.slice(2) };
    if (target.startsWith('i:')) return { category: 'INDIRECT', indirectLineId: target.slice(2) };
    return { category: target === 'gen:INDIRECT' ? 'INDIRECT' : 'DIRECT' };
  };

  // Pull EV/AC/CPI so the user can see how Actual Cost relates to Earned Value.
  const scheduleBase = base.replace(/\/cost$/, '/schedule');
  const evmQ = useQuery({ queryKey: ['evm', scheduleBase, '', formatDateInput(new Date())], queryFn: () => api.get<Evm>(`${scheduleBase}/evm?statusDate=${formatDateInput(new Date())}`) });
  const e = evmQ.data;

  // Has the labour-from-timesheet AC entry already been filled, and is it up to date?
  const syncedEntry = data.actualCosts.find((a) => a.description === LABOUR_AC_DESC);
  const syncedInAc = syncedEntry ? Math.round(Number(syncedEntry.amount)) === Math.round(data.labourActual) : false;

  const fill = useMutation({
    mutationFn: () => api.post(`${base}/actuals/fill-from-timesheet`),
    onSuccess: () => { onChange(); toast.success('Actual Cost filled from timesheet'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to fill from timesheet'),
  });
  const confirmFill = async () => {
    const ok = await confirm({
      title: syncedEntry ? 'Update AC from timesheet?' : 'Fill AC from timesheet?',
      message: (
        <>Set the <strong>“{LABOUR_AC_DESC}”</strong> Actual Cost entry to <strong>{formatIdr(data.labourActual)}</strong> ({formatNum(data.labourConsumedMandays, 1)} md).
          {' '}This replaces the previous auto entry (no double-counting) and affects CPI. Your manual entries are unaffected.
          {' '}If you also recorded labour manually, remove it to avoid double-counting.</>
      ),
      confirmLabel: syncedEntry ? 'Update AC' : 'Fill AC',
    });
    if (ok) fill.mutate();
  };

  // Auto-post toggle: when on, the server re-syncs the labour AC on every man-day change, so
  // the manual "Fill AC" control is replaced by an "✓ Auto" state.
  const autoToggle = useMutation({
    mutationFn: (enabled: boolean) => api.patch(`${base}/auto-post-labour`, { enabled }),
    onSuccess: (_r, enabled) => { onChange(); toast.success(enabled ? 'Auto-post on — labour AC now tracks timesheets' : 'Auto-post off — labour AC is manual again'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to update auto-post'),
  });

  const add = useMutation({
    mutationFn: () => api.post(`${base}/actuals`, { date, amount: Number(amount), description: description || undefined, ...targetPayload() }),
    onSuccess: () => { setAmount(''); setDescription(''); onChange(); toast.success('Actual cost recorded'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to record actual cost'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`${base}/actuals/${id}`),
    onSuccess: () => { onChange(); toast.success('Actual cost entry deleted'); },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to delete entry'),
  });
  const confirmDelete = async (id: string) => {
    if (await confirm({ title: 'Delete actual cost entry?', message: 'This removes the recorded spend and recalculates CPI.', confirmLabel: 'Delete', danger: true })) del.mutate(id);
  };

  return (
    <Card className={accentSurface('slate')}>
      <AccordionHeader title="Actual cost (AC)" count={data.actualCosts.length} total={formatIdr(data.actualCostTotal)} open={open} onToggle={onToggle} icon="outflow" accent="slate" />
      {open && (<div className="mt-3">
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Real money spent — recorded here manually. It is NOT taken from % progress (that drives Earned Value). CPI = EV ÷ AC.</p>

      {/* How AC relates to progress / Earned Value, so AC = 0 isn't mistaken for a bug. */}
      {e && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2.5 text-xs text-slate-600 dark:text-slate-300">
          <span title="Earned Value = % progress × budget (automatic)">Earned (EV): <span className="font-semibold text-slate-800 dark:text-slate-100">{formatIdr(e.ev)}</span></span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span title="Actual Cost = money actually spent (recorded below)">Spent (AC): <span className="font-semibold text-slate-800 dark:text-slate-100">{formatIdr(e.ac)}</span></span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span title="Cost Variance = EV − AC">CV: <span className={`font-semibold ${e.ac > 0 && e.cv < 0 ? 'text-red-600 dark:text-red-400' : e.ac > 0 ? 'text-green-600 dark:text-green-400' : ''}`}>{e.ac > 0 ? formatIdr(e.cv) : '—'}</span></span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span title="Cost Performance Index = EV ÷ AC">CPI: <span className="font-semibold text-slate-800 dark:text-slate-100">{e.ac > 0 ? formatNum(e.cpi, 2) : '—'}</span></span>
          {e.ac === 0 && e.ev > 0 && (
            <span className="text-amber-600 dark:text-amber-400">↳ You’ve earned {formatIdr(e.ev)} of work but recorded Rp 0 spent — add actual spend below to get CPI.</span>
          )}
        </div>
      )}

      {/* Labour cost implied by logged timesheets. Reference by default; one click fills it into AC. */}
      {data.labourActual > 0 && (
        <div className="mb-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-2.5 text-xs text-slate-600 dark:text-slate-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-medium text-slate-700 dark:text-slate-200">🕒 Labour actual from timesheet: {formatIdr(data.labourActual)}</span>
              <span className="text-slate-400"> · {formatNum(data.labourConsumedMandays, 1)} md logged</span>
              {syncedInAc && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">✓ in AC</span>}
            </div>
            {canWrite && (
              <div className="flex items-center gap-2">
                <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300" title="Auto-refresh the labour Actual Cost entry whenever timesheets change">
                  <input type="checkbox" className="accent-brand-500" checked={data.autoPostLabourAc} disabled={autoToggle.isPending} onChange={(ev) => autoToggle.mutate(ev.target.checked)} />
                  Auto-post to AC
                </label>
                {data.autoPostLabourAc ? (
                  <span className="rounded bg-emerald-100 px-2 py-1 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" title="Labour AC is kept in sync with timesheets automatically">✓ Auto</span>
                ) : (
                  <Button variant="secondary" onClick={confirmFill} disabled={fill.isPending || syncedInAc} title={syncedInAc ? 'Actual Cost already matches the timesheet labour' : 'Add/refresh the labour Actual Cost entry from logged timesheets'}>
                    {fill.isPending ? 'Filling…' : syncedEntry ? 'Update AC' : 'Fill AC from timesheet'}
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="mt-0.5 text-slate-400">
            Σ logged man-days × day-rate. {data.autoPostLabourAc
              ? 'Auto-synced from timesheet — updates whenever time is logged. Non-labour spend (materials, licenses) stays manual.'
              : syncedInAc ? 'Reflected in Actual Cost below.' : 'Reference only until you fill it — non-labour spend (materials, licenses) stays manual.'}
          </div>
        </div>
      )}
      {/* Desktop: table. Mobile (< sm): card list below. */}
      <div className="hidden sm:block">
       <div className="prima-grid-frame">
        <div className="overflow-x-auto">
        <table className="prima-grid w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
              <th>Date</th><th>Description</th><th className="text-right">Amount</th><th></th>
            </tr>
          </thead>
        <tbody>
          {data.actualCosts.map((a, ai) => (
            <tr key={a.id} className={ai % 2 === 1 ? 'zebra' : undefined}>
              <td className="text-xs text-slate-500 dark:text-slate-400">{new Date(a.date).toLocaleDateString('en-GB')}</td>
              <td>
                {a.description ?? '—'}
                {a.description === LABOUR_AC_DESC
                  ? <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">auto · timesheet</span>
                  : <><CatBadge category={a.category} /><LineBadge label={lineLabel.get(a.directLineId ?? a.indirectLineId ?? '')} /></>}
              </td>
              <td className="text-right font-medium">{formatIdr(a.amount)}</td>
              <td className="text-right">
                <button onClick={() => confirmDelete(a.id)} className="text-xs text-red-500 hover:underline">delete</button>
              </td>
            </tr>
          ))}
          {!data.actualCosts.length && <tr><td colSpan={4} className="py-3 text-center text-slate-500 dark:text-slate-400">No actual cost recorded yet.</td></tr>}
        </tbody>
      </table>
        </div>
       </div>
      </div>

      {/* Mobile card list — table hidden < sm. */}
      <div className="space-y-2 sm:hidden">
        {data.actualCosts.map((a) => (
          <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-transparent dark:shadow-none">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-slate-700 dark:text-slate-200">
                  {a.description ?? '—'}
                  {a.description === LABOUR_AC_DESC
                    ? <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">auto · timesheet</span>
                    : <><CatBadge category={a.category} /><LineBadge label={lineLabel.get(a.directLineId ?? a.indirectLineId ?? '')} /></>}
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{new Date(a.date).toLocaleDateString('en-GB')}</div>
              </div>
              <div className="shrink-0 font-medium tabular-nums text-slate-900 dark:text-white">{formatIdr(a.amount)}</div>
            </div>
            <div className="mt-1.5"><button onClick={() => confirmDelete(a.id)} className="text-xs text-red-500 hover:underline">delete</button></div>
          </div>
        ))}
        {!data.actualCosts.length && <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">No actual cost recorded yet.</div>}
      </div>

      {/* Phones: date + amount share a row (so the native date picker isn't full-width); the
          "book to line" picker + description + button span both columns. */}
      <div className="mt-4 rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Input type="date" aria-label="Actual cost date" value={date} onChange={(e) => setDate(e.target.value)} />
          <MoneyInput aria-label="Actual cost amount (IDR)" placeholder="Amount" value={amount} onValueChange={setAmount} />
          <label className="col-span-2 md:col-span-2 flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Book to budget line</span>
            <Select aria-label="Book to budget line" title="Book this spend to a specific budget line so its Spent/Remaining updates, or leave it general to the category only" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="gen:DIRECT">— No specific line · Direct —</option>
              <option value="gen:INDIRECT">— No specific line · Indirect —</option>
              {directLineOptions.length > 0 && (
                <optgroup label="Direct lines">
                  {directLineOptions.map((d) => (
                    <option key={d.id} value={`d:${d.id}`}>{d.label} — {formatIdr(d.remaining)} left</option>
                  ))}
                </optgroup>
              )}
              {data.indirectCosts.length > 0 && (
                <optgroup label="Indirect lines">
                  {data.indirectCosts.map((i) => (
                    <option key={i.id} value={`i:${i.id}`}>{i.description} — {formatIdr(i.remaining)} left</option>
                  ))}
                </optgroup>
              )}
            </Select>
          </label>
          <Input className="col-span-2 md:col-span-1 md:self-end" aria-label="Actual cost description" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <Button className="col-span-2 md:col-span-1 md:self-end" onClick={() => add.mutate()} disabled={!date || !amount || add.isPending}>Record AC</Button>
        </div>
        {/* Warn when the spend won't draw down any single line's remaining (goes to the category bucket only). */}
        {isGeneral && (
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
            ⚠ This won’t reduce any line’s Remaining — it rolls up to the {target === 'gen:INDIRECT' ? 'Indirect' : 'Direct'} category total only. Pick a line above to book it per-component.
          </p>
        )}
      </div>
      </div>)}
    </Card>
  );
}

// Direct/Indirect tag on an Actual Cost entry — mirrors the budget it draws down.
function CatBadge({ category }: { category: 'DIRECT' | 'INDIRECT' }) {
  const indirect = category === 'INDIRECT';
  return (
    <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${indirect ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'}`}>
      {indirect ? 'Indirect' : 'Direct'}
    </span>
  );
}

// Shows which budget line an Actual Cost entry is booked to (per-component attribution).
// Renders nothing for a general (unattributed) entry.
function LineBadge({ label }: { label: string | undefined }) {
  if (!label) return null;
  return (
    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300" title={`Booked to: ${label}`}>
      ↳ {label}
    </span>
  );
}

// "Not yet spent" strip above a cost table: how many budget lines have zero spend
// so far, and the total budget still remaining across the whole section.
function UntouchedNote({ count, total, remaining, names }: { count: number; total: number; remaining: number; names: string[] }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2.5 text-xs text-slate-600 dark:text-slate-300">
      <span title={count > 0 ? `No spend yet: ${names.join(', ')}` : undefined}>
        <span className="font-semibold text-slate-800 dark:text-slate-100">Not yet spent:</span> {count} of {total} components
      </span>
      <span className="text-slate-300 dark:text-slate-600">·</span>
      <span>Remaining budget: <span className={`font-semibold ${remaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>{formatIdr(remaining)}</span></span>
    </div>
  );
}

function CharterVariance({ charter, bac }: { charter: number; bac: number }) {
  const variance = bac - charter;
  const over = variance > 0;
  return (
    <Card className="!p-3">
      <span className="text-sm text-slate-600 dark:text-slate-300">
        Charter estimate {formatIdr(charter)} vs Baseline {formatIdr(bac)} ·{' '}
        <span className={over ? 'font-semibold text-red-600' : 'font-semibold text-green-600'}>
          {over ? 'Over' : 'Under'} by {formatIdr(Math.abs(variance))}
        </span>
      </span>
    </Card>
  );
}

function DirectCosts({ data, base, projectId, onChange, open, onToggle, onBookAc, onNavigateTab, flashId }: { data: CostSummary; base: string; projectId: string; onChange: () => void; open: boolean; onToggle: () => void; onBookAc: (target: string) => void; onNavigateTab?: (tab: string) => void; flashId?: string | null }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [importing, setImporting] = useState(false);
  const [type, setType] = useState('TECHNOLOGY_CLOUD');
  const [label, setLabel] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [qty, setQty] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [planMandays, setMandays] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [rateOverride, setRateOverride] = useState('');
  const [taskId, setTaskId] = useState('');
  const [err, setErr] = useState('');
  const isManpower = type === 'MANPOWER';
  const isOther = type === 'OTHER';
  // Per-family UI: which category sub-sections are collapsed, which one has its add-form open, and
  // the row currently being dragged (drag-to-reorder within a family).
  const [collapsedFam, setCollapsedFam] = useState<Set<string>>(new Set());
  const [addingFamily, setAddingFamily] = useState<string | null>(null);
  // An Anett cost-line citation (?focus=<lineId>) may target a line inside a collapsed family — expand
  // that family so the flashed row is in the DOM for CostPanel to scroll to.
  useEffect(() => {
    if (!flashId) return;
    const line = data.directCosts.find((d) => d.id === flashId);
    if (line) setCollapsedFam((s) => { if (!s.has(familyOf(line.type))) return s; const n = new Set(s); n.delete(familyOf(line.type)); return n; });
  }, [flashId, data.directCosts]);
  const [dragId, setDragId] = useState<string | null>(null);
  const toggleFam = (k: string) => setCollapsedFam((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  // Open a family's inline add-form, presetting the type to that family's first (or only) type.
  const openAdd = (fam: typeof DIRECT_FAMILIES[number]) => {
    setType(fam.types[0]); setLabel(''); setSubCategory(''); setUnitCost(''); setQty('1'); setMandays(''); setResourceId(''); setRateOverride(''); setTaskId(''); setErr('');
    setCollapsedFam((s) => { const n = new Set(s); n.delete(fam.key); return n; });
    setAddingFamily(fam.key);
  };

  // Manpower is loaded from the resource master pool (rate & role come from it).
  const resourcesQ = useQuery({ queryKey: ['resources'], queryFn: () => api.get<{ resources: ResourceItem[] }>('/resources') });
  const picked = resourcesQ.data?.resources.find((r) => r.id === resourceId);

  // Leaf tasks for the manpower↔schedule link (assign work to a work package).
  const scheduleBase = base.replace(/\/cost$/, '/schedule');
  const ganttQ = useQuery({ queryKey: ['gantt', scheduleBase], queryFn: () => api.get<{ tree: GanttNode[] }>(`${scheduleBase}/gantt`) });
  const leafTasks = flattenLeaves(ganttQ.data?.tree ?? []);

  const add = useMutation({
    mutationFn: () =>
      api.post(`${base}/direct`, isManpower
        ? { type, label: label || picked?.name || '', resourceId, planMandays: Number(planMandays), unitCostPerManday: rateOverride === '' ? undefined : Number(rateOverride), taskId: taskId || undefined }
        : { type, label, qty: Number(qty), unitCost: Number(unitCost), subCategory: isOther ? subCategory : undefined }),
    onSuccess: () => { setLabel(''); setSubCategory(''); setUnitCost(''); setMandays(''); setResourceId(''); setRateOverride(''); setTaskId(''); setErr(''); onChange(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`${base}/direct/${id}`),
    onSuccess: () => { onChange(); toast.success('Cost line deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete cost line'),
  });
  // Drag-to-reorder: send the full ordered id list; server re-numbers sortOrder.
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.patch(`${base}/direct/reorder`, { ids }),
    onSuccess: onChange,
    onError: (e) => { onChange(); toast.error(e instanceof ApiError ? e.message : 'Failed to reorder'); },
  });
  const confirmDelete = async (d: DirectCost) => {
    if (await confirm({ title: 'Delete cost line?', message: <>Delete <strong>{d.label}</strong> from direct costs? This recalculates the cost baseline.</>, confirmLabel: 'Delete', danger: true })) del.mutate(d.id);
  };
  // Inline reassignment: resend the manpower line pointing at a new resource. Rate &
  // role are re-derived server-side from that resource; taskId preserved so the
  // manpower↔schedule link survives the edit.
  const reassign = useMutation({
    mutationFn: ({ d, resourceId }: { d: DirectCost; resourceId: string }) =>
      api.put(`${base}/direct/${d.id}`, {
        type: 'MANPOWER',
        label: d.label,
        planMandays: Number(d.planMandays),
        taskId: d.taskId ?? undefined,
        resourceId: resourceId || undefined,
        // No resource → keep the existing rate/role so the line stays valid.
        ...(resourceId ? {} : { personnelRole: d.personnelRole, unitCostPerManday: Number(d.unitCostPerManday) }),
      }),
    onSuccess: () => { setErr(''); onChange(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });
  // Inline task (re)assignment: change only the linked work package; rate, role &
  // resource are sent back explicitly so nothing else on the line changes.
  const reassignTask = useMutation({
    mutationFn: ({ d, taskId }: { d: DirectCost; taskId: string }) =>
      api.put(`${base}/direct/${d.id}`, {
        type: 'MANPOWER',
        label: d.label,
        planMandays: Number(d.planMandays),
        taskId: taskId || undefined,
        resourceId: d.resourceId ?? undefined,
        personnelRole: d.personnelRole,
        unitCostPerManday: Number(d.unitCostPerManday),
      }),
    onSuccess: () => { setErr(''); onChange(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });

  // --- Inline edit of an existing direct-cost line ---
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState({ type: 'TECHNOLOGY_CLOUD', label: '', subCategory: '', qty: '1', unitCost: '', mandays: '', rate: '' });
  const startEdit = (d: DirectCost) => {
    setEditId(d.id);
    setEf({
      type: d.type,
      label: d.label,
      subCategory: d.subCategory ?? '',
      qty: d.qty != null ? String(d.qty) : '1',
      unitCost: d.unitCost != null ? String(Math.trunc(Number(d.unitCost))) : '',
      mandays: d.planMandays != null ? String(d.planMandays) : '',
      rate: d.unitCostPerManday != null ? String(Math.trunc(Number(d.unitCostPerManday))) : '',
    });
  };
  const update = useMutation({
    mutationFn: (d: DirectCost) =>
      api.put(`${base}/direct/${d.id}`, d.type === 'MANPOWER'
        ? {
            type: 'MANPOWER', label: ef.label || d.label, planMandays: Number(ef.mandays),
            taskId: d.taskId ?? undefined, unitCostPerManday: Number(ef.rate),
            ...(d.resourceId ? { resourceId: d.resourceId } : { personnelRole: d.personnelRole }),
          }
        : { type: ef.type, label: ef.label, qty: Number(ef.qty), unitCost: Number(ef.unitCost), subCategory: ef.type === 'OTHER' ? ef.subCategory : undefined }),
    onSuccess: () => { setEditId(null); onChange(); toast.success('Cost line updated'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update cost line'),
  });
  // Live amount for the edit row and the add form (qty×unit or rate×mandays).
  const editRow = data.directCosts.find((d) => d.id === editId);
  const efAmount = !editRow ? 0 : editRow.type === 'MANPOWER'
    ? Number(ef.rate || 0) * Number(ef.mandays || 0)
    : Number(ef.qty || 0) * Number(ef.unitCost || 0);
  const addAmount = isManpower
    ? (rateOverride !== '' ? Number(rateOverride) : Number(picked?.unitCostPerManday ?? 0)) * Number(planMandays || 0)
    : Number(qty || 0) * Number(unitCost || 0);
  // Running total of recorded direct lines (matches the per-row Amount cells) so the
  // projected grand total can be previewed before the new line is submitted.
  const directTotal = data.directCosts.reduce((s, d) => s + Number((d.type === 'MANPOWER' ? d.manpowerCost : d.amount) ?? 0), 0);
  const directSpent = data.directCosts.reduce((s, d) => s + d.actualToDate, 0);
  const directRemaining = data.directCosts.reduce((s, d) => s + d.remaining, 0);
  const directAvailable = data.directCosts.reduce((s, d) => s + d.available, 0);
  const directUntouched = data.directCosts.filter((d) => d.actualToDate === 0);

  // Group the lines into their category families (already sorted by sortOrder from the API).
  const grouped: Record<string, DirectCost[]> = Object.fromEntries(DIRECT_FAMILIES.map((f) => [f.key, [] as DirectCost[]]));
  for (const d of data.directCosts) (grouped[familyOf(d.type)] ??= []).push(d);
  const lineAmount = (d: DirectCost) => Number((d.type === 'MANPOWER' ? d.manpowerCost : d.amount) ?? 0);
  const addFamilyDef = DIRECT_FAMILIES.find((f) => f.key === addingFamily) ?? null;

  // Drag-to-reorder within a family: move `fromId` before `toId`, then persist the full new order.
  const moveWithinFamily = (familyKey: string, fromId: string, toId: string) => {
    const ids = (grouped[familyKey] ?? []).map((d) => d.id);
    const from = ids.indexOf(fromId), to = ids.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    const globalIds = DIRECT_FAMILIES.flatMap((f) => (f.key === familyKey ? ids : (grouped[f.key] ?? []).map((d) => d.id)));
    reorder.mutate(globalIds);
  };
  const onRowDrop = (target: DirectCost) => {
    const src = dragId ? data.directCosts.find((x) => x.id === dragId) : null;
    if (src && familyOf(src.type) === familyOf(target.type)) moveWithinFamily(familyOf(target.type), src.id, target.id);
    setDragId(null);
  };
  // Keyboard-accessible reorder (drag alternative): move a line up/down one slot within its family.
  const nudge = (d: DirectCost, dir: -1 | 1) => {
    const fam = grouped[familyOf(d.type)] ?? [];
    const i = fam.findIndex((x) => x.id === d.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= fam.length) return;
    moveWithinFamily(familyOf(d.type), d.id, fam[j].id);
  };
  // Position of a line within its family (for disabling the up/down controls at the ends).
  const famPos = (d: DirectCost) => {
    const fam = grouped[familyOf(d.type)] ?? [];
    const i = fam.findIndex((x) => x.id === d.id);
    return { first: i <= 0, last: i >= fam.length - 1 };
  };

  return (
    <Card className={accentSurface('slate')}>
      <AccordionHeader title="Direct cost" count={data.directCosts.length} total={formatIdr(directTotal)} open={open} onToggle={onToggle} icon="box" accent="slate" spent={directSpent} budget={directTotal} />
      {open && (<div className="mt-3">
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Material (qty × unit cost) and Manpower (rate × mandays)</p>
      {/* Always-visible "add line" toolbar — one chip per family, so ANY family (incl. empty ones
          and a brand-new project) can be added to. Clicking opens the add-form at the top below. */}
      <div data-tour="cost-add-line" className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Add line</span>
        {DIRECT_FAMILIES.map((fam) => (
          <button key={fam.key} onClick={() => openAdd(fam)} title={`Add a ${fam.label} line`}
            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${addingFamily === fam.key ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-900/30 dark:text-brand-200' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
            <span aria-hidden>{fam.icon}</span> {fam.label}
          </button>
        ))}
        <button onClick={() => setImporting(true)} title="Import direct cost lines from Excel/CSV"
          className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          ⬆ Import
        </button>
        {importing && <ImportCostModal projectId={projectId} kind="direct" onClose={() => setImporting(false)} onImported={onChange} />}
      </div>
      {/* Add-line form — rendered at the TOP of the section (right under the header) so it's
          visible immediately when a family's "+ Add" is clicked, instead of hidden below the list. */}
      {addFamilyDef && (<>
      <div className="mb-4 rounded-lg border border-brand-200 bg-slate-50 p-3 dark:border-brand-900/40 dark:bg-slate-800">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"><span aria-hidden>{addFamilyDef.icon}</span> Add {addFamilyDef.label}</span>
        <button onClick={() => setAddingFamily(null)} className="text-xs text-slate-400 hover:underline">close</button>
      </div>
      <div className="grid gap-2 md:grid-cols-8">
        {addFamilyDef.types.length > 1
          ? <Select aria-label="Direct cost type" value={type} onChange={(e) => setType(e.target.value)}>{addFamilyDef.types.map((tv) => <option key={tv} value={tv}>{DIRECT_LABEL[tv]}</option>)}</Select>
          : <div className="hidden md:block" />}
        <Input aria-label="Cost line label" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        {isManpower ? (
          <>
            {/* Wider (2 cols) so the "<name> · <role> · <rate>" option shows without truncating. */}
            <Select className="md:col-span-2" aria-label="Pick resource from pool" value={resourceId} onChange={(e) => setResourceId(e.target.value)} title="Pick from the resource pool">
              <option value="">Resource…</option>
              {resourcesQ.data?.resources.map((r) => (
                <option key={r.id} value={r.id}>{r.name} · {r.roleTitle || (r.personnelRole === 'PM' ? 'Project Manager' : 'Project Personnel')} · {formatIdr(Number(r.unitCostPerManday))}/md</option>
              ))}
            </Select>
            <MoneyInput
              aria-label="Rate override (IDR per manday)"
              placeholder={picked ? `${formatIdr(Number(picked.unitCostPerManday))} (rate)` : 'Rate override'}
              value={rateOverride}
              onValueChange={setRateOverride}
              title="Leave blank to use the resource's rate"
            />
            <Input
              type="number"
              aria-label="Planned mandays"
              placeholder="Plan mandays"
              value={planMandays}
              onChange={(e) => setMandays(e.target.value)}
              title={picked && planMandays ? `= ${formatIdr((rateOverride === '' ? Number(picked.unitCostPerManday) : Number(rateOverride)) * Number(planMandays))}` : 'rate × mandays'}
            />
            <Select aria-label="Link to a task" value={taskId} onChange={(e) => setTaskId(e.target.value)} title="Link to a task (work package)">
              <option value="">Task… (optional)</option>
              {leafTasks.map((t) => (
                <option key={t.id} value={t.id}>{t.wbsCode} {t.name}</option>
              ))}
            </Select>
          </>
        ) : (
          <>
            <Input type="number" aria-label="Quantity" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
            <MoneyInput aria-label="Unit cost (IDR)" placeholder="Unit cost" value={unitCost} onValueChange={setUnitCost} />
            {isOther ? (
              <Input aria-label="Sub-category" placeholder="Specify category *" value={subCategory} onChange={(e) => setSubCategory(e.target.value)} title="Name the kind of cost (e.g. Insurance, Legal)" />
            ) : <div />}
            <div />
            <div />
          </>
        )}
        <Button
          onClick={() => add.mutate()}
          disabled={add.isPending || (isManpower ? !resourceId || !planMandays : !label || (isOther && !subCategory.trim()))}
          title={isManpower ? (!resourceId ? 'Pick a Resource from the pool first' : !planMandays ? 'Enter Plan mandays' : 'Add manpower line') : !label ? 'Enter a label first' : 'Add cost line'}
        >
          Add
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
        <span className="text-slate-500 dark:text-slate-400">Amount (auto): <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatIdr(addAmount)}</span></span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span className="text-slate-500 dark:text-slate-400" title="Recorded direct total + this new line">New Direct total: <span className="font-bold tabular-nums text-slate-900 dark:text-white">{formatIdr(directTotal + addAmount)}</span></span>
      </div>
      <FormError className="mt-2">{err}</FormError>
      </div>
      </>)}
      {data.directCosts.length > 0 && (
        <UntouchedNote count={directUntouched.length} total={data.directCosts.length} remaining={directRemaining} names={directUntouched.map((d) => d.label)} />
      )}
      {/* Desktop: table. Mobile (< sm): a card list below (same handlers/state). */}
      <div className="hidden sm:block">
       <div className="prima-grid-frame">
        <div className="overflow-x-auto">
        <table className="prima-grid w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
              <th>Type</th><th>Item</th><th>Detail</th><th className="text-right">Amount</th><th className="text-right">Spent</th><th className="text-right">Remaining</th><th className="text-right" title="Budget − spent − committed">Available</th><th></th>
            </tr>
          </thead>
          <tbody>
            {DIRECT_FAMILIES.map((fam) => {
              const lines = grouped[fam.key];
              if (!lines.length) return null;
              const famCollapsed = collapsedFam.has(fam.key);
              const subtotal = lines.reduce((s, d) => s + lineAmount(d), 0);
              return (
              <Fragment key={fam.key}>
                <tr className="bg-slate-50/70 dark:bg-slate-800/40">
                  <td colSpan={8} className="py-1.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleFam(fam.key)} aria-expanded={!famCollapsed} className="flex min-w-0 items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                        <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${famCollapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                        <span aria-hidden>{fam.icon}</span>{fam.label}
                        <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">{lines.length}</span>
                      </button>
                      <span className="ml-auto shrink-0 tabular-nums text-xs font-bold text-slate-800 dark:text-slate-100">{formatIdr(subtotal)}</span>
                      <button onClick={() => openAdd(fam)} className="shrink-0 rounded-md border border-brand-200 px-2 py-0.5 text-[11px] font-medium text-brand-600 hover:bg-brand-50 dark:border-brand-900/50 dark:text-brand-300 dark:hover:bg-brand-900/20" title={`Add a ${fam.label} line`}>+ Add</button>
                    </div>
                  </td>
                </tr>
                {!famCollapsed && lines.map((d, di) => {
              const editing = editId === d.id;
              const isMp = d.type === 'MANPOWER';
              return (
              <tr key={d.id} data-cost-focus={d.id} draggable={!editing} onDragStart={() => setDragId(d.id)} onDragOver={(e) => { if (dragId) e.preventDefault(); }} onDrop={() => onRowDrop(d)} onDragEnd={() => setDragId(null)} className={`align-top ${di % 2 === 1 ? 'zebra' : ''} ${dragId === d.id ? 'opacity-40' : ''} ${!editing ? 'cursor-grab active:cursor-grabbing' : ''} ${flashId === d.id ? '[&>td]:!bg-amber-100 dark:[&>td]:!bg-amber-900/40' : ''}`}>
                <td className="py-2 text-xs text-slate-500 dark:text-slate-400">
                  {editing && !isMp ? (
                    <Select aria-label="Type" value={ef.type} onChange={(e) => setEf((p) => ({ ...p, type: e.target.value }))}>
                      {DIRECT_TYPES.filter((t) => t.value !== 'MANPOWER').map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  ) : typeLabel(DIRECT_LABEL, d.type, d.subCategory)}
                </td>
                <td>
                  {editing ? (
                    <>
                      <Input aria-label="Label" value={ef.label} onChange={(e) => setEf((p) => ({ ...p, label: e.target.value }))} placeholder="Label" />
                      {ef.type === 'OTHER' && (
                        <Input aria-label="Sub-category" className="mt-1" value={ef.subCategory} onChange={(e) => setEf((p) => ({ ...p, subCategory: e.target.value }))} placeholder="Specify category *" />
                      )}
                    </>
                  ) : (
                    <>
                      <div>{d.label}</div>
                      {isMp && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          <select
                            value={d.resourceId ?? ''}
                            disabled={reassign.isPending}
                            onChange={(e) => reassign.mutate({ d, resourceId: e.target.value })}
                            title="Assign / change resource"
                            aria-label={`Assign resource to ${d.label}`}
                            className={`rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-1 py-0.5 text-[11px] ${
                              d.resourceId ? 'text-brand-700' : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            <option value="">👤 Unassigned</option>
                            {resourcesQ.data?.resources.map((r) => (
                              <option key={r.id} value={r.id}>👤 {r.name}</option>
                            ))}
                          </select>
                          <select
                            value={d.taskId ?? ''}
                            disabled={reassignTask.isPending}
                            onChange={(e) => reassignTask.mutate({ d, taskId: e.target.value })}
                            title="Link / change task (work package)"
                            aria-label={`Link ${d.label} to a task`}
                            className={`rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-1 py-0.5 text-[11px] ${
                              d.taskId ? 'text-brand-700' : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            <option value="">📋 No task</option>
                            {leafTasks.map((t) => (
                              <option key={t.id} value={t.id}>📋 {t.wbsCode} {t.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td className="text-xs text-slate-500 dark:text-slate-400">
                  {!editing ? (
                    isMp
                      ? `${d.personnelRole} · ${formatIdr(d.unitCostPerManday)}/md × ${d.planMandays} md`
                      : `${d.qty} × ${formatIdr(d.unitCost)}`
                  ) : isMp ? (
                    <div className="flex items-center gap-1">
                      <div className="w-28"><MoneyInput aria-label="Rate per manday" value={ef.rate} onValueChange={(v) => setEf((p) => ({ ...p, rate: v }))} /></div>
                      <span className="whitespace-nowrap">/md ×</span>
                      <div className="w-16"><Input type="number" aria-label="Mandays" value={ef.mandays} onChange={(e) => setEf((p) => ({ ...p, mandays: e.target.value }))} /></div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <div className="w-16"><Input type="number" aria-label="Quantity" value={ef.qty} onChange={(e) => setEf((p) => ({ ...p, qty: e.target.value }))} /></div>
                      <span>×</span>
                      <div className="w-28"><MoneyInput aria-label="Unit cost" value={ef.unitCost} onValueChange={(v) => setEf((p) => ({ ...p, unitCost: v }))} /></div>
                    </div>
                  )}
                </td>
                <td className="text-right font-medium tabular-nums">
                  {formatIdr(editing ? efAmount : (isMp ? d.manpowerCost : d.amount))}
                  {!editing && d.committed > 0 && <div className="text-[10px] font-normal text-indigo-500 dark:text-indigo-400" title="Committed via awarded contracts (Procurement)">⛓ {formatIdr(d.committed)}</div>}
                </td>
                <td className="text-right tabular-nums text-slate-500 dark:text-slate-400" title={isMp ? 'From timesheet (consumed man-days × rate)' : 'Actual Cost booked to this line'}>{formatIdr(d.actualToDate)}</td>
                <td className={`text-right tabular-nums font-medium ${d.remaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`} title={d.remaining < 0 ? 'Over budget' : 'Budget still available'}>{formatIdr(d.remaining)}</td>
                <td className={`text-right tabular-nums ${d.available < 0 ? 'text-red-600 dark:text-red-400' : d.committed > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`} title="Budget − spent − committed (free to commit)">{formatIdr(d.available)}</td>
                <td className="text-right whitespace-nowrap">
                  {editing ? (
                    <>
                      <button onClick={() => update.mutate(d)} disabled={update.isPending} className="mr-2 text-xs font-medium text-brand-600 hover:underline">save</button>
                      <button onClick={() => setEditId(null)} className="text-xs text-slate-400 hover:underline">cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => nudge(d, -1)} disabled={reorder.isPending || famPos(d).first} aria-label={`Move ${d.label} up`} title="Move up" className="mr-0.5 rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-25 dark:hover:bg-slate-800">▲</button>
                      <button onClick={() => nudge(d, 1)} disabled={reorder.isPending || famPos(d).last} aria-label={`Move ${d.label} down`} title="Move down" className="mr-2 rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-25 dark:hover:bg-slate-800">▼</button>
                      {isMp
                        ? (onNavigateTab && d.actualToDate === 0
                            ? <button onClick={() => onNavigateTab('Timesheet')} className="mr-2 text-[11px] font-medium text-amber-600 hover:underline dark:text-amber-400" title="No man-days logged yet — spend stays Rp 0. Log this person's effort in the Timesheet tab to populate Spent.">🕒 Log timesheet →</button>
                            : <button onClick={() => onNavigateTab?.('Timesheet')} disabled={!onNavigateTab} className="mr-2 text-[11px] text-slate-400 hover:underline disabled:no-underline dark:text-slate-500" title="Manpower spend is drawn from the timesheet automatically (consumed man-days × rate) — no manual AC entry needed here.">🕒 timesheet</button>)
                        : <button onClick={() => onBookAc(`d:${d.id}`)} className="mr-2 text-xs text-emerald-600 hover:underline dark:text-emerald-400" title="Record actual spend against this line">+ AC</button>}
                      <button onClick={() => startEdit(d)} className="mr-2 text-xs text-brand-600 hover:underline">edit</button>
                      <button onClick={() => confirmDelete(d)} className="text-xs text-red-500 hover:underline">delete</button>
                    </>
                  )}
                </td>
              </tr>
              );
            })}
              </Fragment>
              );
            })}
            {!data.directCosts.length && <tr><td colSpan={8} className="py-3 text-center text-slate-500 dark:text-slate-400">No direct costs yet.</td></tr>}
          </tbody>
          {data.directCosts.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 text-sm font-semibold dark:border-slate-700">
                <td colSpan={3} className="py-2 text-slate-600 dark:text-slate-300">Total ({data.directCosts.length} {data.directCosts.length === 1 ? 'line' : 'lines'})</td>
                <td className="text-right tabular-nums text-slate-900 dark:text-white">{formatIdr(directTotal)}</td>
                <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{formatIdr(directSpent)}</td>
                <td className={`text-right tabular-nums ${directRemaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>{formatIdr(directRemaining)}</td>
                <td className={`text-right tabular-nums ${directAvailable < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>{formatIdr(directAvailable)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
        </div>
       </div>
      </div>

      {/* Mobile card list — the table above is hidden < sm. Reuses the same edit/reassign/delete handlers. */}
      <div className="space-y-2 sm:hidden">
        {DIRECT_FAMILIES.map((fam) => {
          const lines = grouped[fam.key];
          if (!lines.length) return null;
          const famCollapsed = collapsedFam.has(fam.key);
          const subtotal = lines.reduce((s, d) => s + lineAmount(d), 0);
          return (
          <Fragment key={fam.key}>
            <div className="flex items-center gap-2 pt-2">
              <button onClick={() => toggleFam(fam.key)} aria-expanded={!famCollapsed} className="flex min-w-0 items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${famCollapsed ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                <span aria-hidden>{fam.icon}</span>{fam.label}
                <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">{lines.length}</span>
              </button>
              <span className="ml-auto shrink-0 tabular-nums text-xs font-bold text-slate-800 dark:text-slate-100">{formatIdr(subtotal)}</span>
              <button onClick={() => openAdd(fam)} className="shrink-0 rounded-md border border-brand-200 px-2 py-0.5 text-[11px] font-medium text-brand-600 dark:border-brand-900/50 dark:text-brand-300">+ Add</button>
            </div>
            {!famCollapsed && lines.map((d) => {
          const editing = editId === d.id;
          const isMp = d.type === 'MANPOWER';
          if (editing) return (
            <div key={d.id} className="space-y-2 rounded-lg border border-brand-300 bg-brand-50/50 p-3 dark:border-brand-900/50 dark:bg-brand-900/10">
              {!isMp && (
                <Select aria-label="Type" value={ef.type} onChange={(e) => setEf((p) => ({ ...p, type: e.target.value }))}>
                  {DIRECT_TYPES.filter((t) => t.value !== 'MANPOWER').map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              )}
              <Input aria-label="Label" value={ef.label} onChange={(e) => setEf((p) => ({ ...p, label: e.target.value }))} placeholder="Label" />
              {!isMp && ef.type === 'OTHER' && (
                <Input aria-label="Sub-category" value={ef.subCategory} onChange={(e) => setEf((p) => ({ ...p, subCategory: e.target.value }))} placeholder="Specify category *" />
              )}
              {isMp ? (
                <div className="flex items-center gap-1">
                  <div className="flex-1"><MoneyInput aria-label="Rate per manday" value={ef.rate} onValueChange={(v) => setEf((p) => ({ ...p, rate: v }))} /></div>
                  <span className="whitespace-nowrap text-xs text-slate-500">/md ×</span>
                  <div className="w-20"><Input type="number" aria-label="Mandays" value={ef.mandays} onChange={(e) => setEf((p) => ({ ...p, mandays: e.target.value }))} /></div>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <div className="w-20"><Input type="number" aria-label="Quantity" value={ef.qty} onChange={(e) => setEf((p) => ({ ...p, qty: e.target.value }))} /></div>
                  <span className="text-xs text-slate-500">×</span>
                  <div className="flex-1"><MoneyInput aria-label="Unit cost" value={ef.unitCost} onValueChange={(v) => setEf((p) => ({ ...p, unitCost: v }))} /></div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500 dark:text-slate-400">Amount: <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatIdr(efAmount)}</span></span>
                <div className="flex gap-3">
                  <button onClick={() => update.mutate(d)} disabled={update.isPending} className="text-xs font-medium text-brand-600 hover:underline">save</button>
                  <button onClick={() => setEditId(null)} className="text-xs text-slate-400 hover:underline">cancel</button>
                </div>
              </div>
            </div>
          );
          return (
            <div key={d.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-transparent dark:shadow-none">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="mb-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">{typeLabel(DIRECT_LABEL, d.type, d.subCategory)}</div>
                  <div className="font-medium text-slate-700 dark:text-slate-200">{d.label}</div>
                </div>
                <div className="shrink-0 text-right font-semibold tabular-nums text-slate-900 dark:text-white">
                  {formatIdr(isMp ? d.manpowerCost : d.amount)}
                  {d.committed > 0 && <div className="text-[10px] font-normal text-indigo-500 dark:text-indigo-400" title="Committed via awarded contracts">⛓ {formatIdr(d.committed)}</div>}
                </div>
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {isMp ? `${d.personnelRole} · ${formatIdr(d.unitCostPerManday)}/md × ${d.planMandays} md` : `${d.qty} × ${formatIdr(d.unitCost)}`}
              </div>
              <div className="mt-1 flex gap-4 text-xs">
                <span className="text-slate-500 dark:text-slate-400">Spent: <span className="tabular-nums text-slate-700 dark:text-slate-200">{formatIdr(d.actualToDate)}</span></span>
                <span className="text-slate-500 dark:text-slate-400">Remaining: <span className={`tabular-nums font-medium ${d.remaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>{formatIdr(d.remaining)}</span></span>
                {d.committed > 0 && <span className="text-slate-500 dark:text-slate-400">Available: <span className={`tabular-nums font-medium ${d.available < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatIdr(d.available)}</span></span>}
              </div>
              {isMp && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <select value={d.resourceId ?? ''} disabled={reassign.isPending} onChange={(e) => reassign.mutate({ d, resourceId: e.target.value })} aria-label={`Assign resource to ${d.label}`} className={`w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs dark:border-slate-800 dark:bg-slate-900 ${d.resourceId ? 'text-brand-700' : 'text-slate-500 dark:text-slate-400'}`}>
                    <option value="">👤 Unassigned</option>
                    {resourcesQ.data?.resources.map((r) => (<option key={r.id} value={r.id}>👤 {r.name}</option>))}
                  </select>
                  <select value={d.taskId ?? ''} disabled={reassignTask.isPending} onChange={(e) => reassignTask.mutate({ d, taskId: e.target.value })} aria-label={`Link ${d.label} to a task`} className={`w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs dark:border-slate-800 dark:bg-slate-900 ${d.taskId ? 'text-brand-700' : 'text-slate-500 dark:text-slate-400'}`}>
                    <option value="">📋 No task</option>
                    {leafTasks.map((t) => (<option key={t.id} value={t.id}>📋 {t.wbsCode} {t.name}</option>))}
                  </select>
                </div>
              )}
              <div className="mt-2 flex items-center gap-4">
                {isMp
                  ? (onNavigateTab && d.actualToDate === 0
                      ? <button onClick={() => onNavigateTab('Timesheet')} className="text-xs font-medium text-amber-600 hover:underline dark:text-amber-400" title="No man-days logged yet — spend stays Rp 0. Log this person's effort in the Timesheet tab.">🕒 Log timesheet →</button>
                      : <button onClick={() => onNavigateTab?.('Timesheet')} disabled={!onNavigateTab} className="text-xs text-slate-400 hover:underline disabled:no-underline dark:text-slate-500" title="Manpower spend is drawn from the timesheet automatically (consumed man-days × rate).">🕒 Spent from timesheet</button>)
                  : <button onClick={() => onBookAc(`d:${d.id}`)} className="text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400">+ Record AC</button>}
                <button onClick={() => startEdit(d)} className="text-xs text-brand-600 hover:underline">edit</button>
                <button onClick={() => confirmDelete(d)} className="text-xs text-red-500 hover:underline">delete</button>
                <span className="ml-auto flex items-center gap-1">
                  <button onClick={() => nudge(d, -1)} disabled={reorder.isPending || famPos(d).first} aria-label={`Move ${d.label} up`} title="Move up" className="rounded px-1.5 py-0.5 text-slate-400 disabled:opacity-25">▲</button>
                  <button onClick={() => nudge(d, 1)} disabled={reorder.isPending || famPos(d).last} aria-label={`Move ${d.label} down`} title="Move down" className="rounded px-1.5 py-0.5 text-slate-400 disabled:opacity-25">▼</button>
                </span>
              </div>
            </div>
          );
        })}
          </Fragment>
          );
        })}
        {!data.directCosts.length && <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">No direct costs yet.</div>}
        {data.directCosts.length > 0 && (
          <div className="border-t-2 border-slate-200 pt-2 text-sm font-semibold dark:border-slate-700">
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">Total ({data.directCosts.length} {data.directCosts.length === 1 ? 'line' : 'lines'})</span>
              <span className="tabular-nums text-slate-900 dark:text-white">{formatIdr(directTotal)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs font-normal text-slate-500 dark:text-slate-400">
              <span>Spent {formatIdr(directSpent)}</span>
              <span>Remaining <span className={`font-medium ${directRemaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>{formatIdr(directRemaining)}</span></span>
              <span>Available <span className={`font-medium ${directAvailable < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatIdr(directAvailable)}</span></span>
            </div>
          </div>
        )}
      </div>

      </div>)}
    </Card>
  );
}

function IndirectCosts({ data, base, projectId, onChange, open, onToggle, onBookAc, flashId }: { data: CostSummary; base: string; projectId: string; onChange: () => void; open: boolean; onToggle: () => void; onBookAc: (target: string) => void; flashId?: string | null }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [importing, setImporting] = useState(false);
  const [type, setType] = useState('TRANSPORTATION');
  const [description, setDescription] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState({ type: 'TRANSPORTATION', description: '', subCategory: '', amount: '' });
  const isOther = type === 'OTHER';

  const add = useMutation({
    mutationFn: () => api.post(`${base}/indirect`, { type, description, amount: Number(amount), subCategory: isOther ? subCategory : undefined }),
    onSuccess: () => { setDescription(''); setSubCategory(''); setAmount(''); onChange(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to add indirect cost'),
  });
  const update = useMutation({
    mutationFn: (id: string) => api.put(`${base}/indirect/${id}`, { type: ef.type, description: ef.description, amount: Number(ef.amount), subCategory: ef.type === 'OTHER' ? ef.subCategory : undefined }),
    onSuccess: () => { setEditId(null); onChange(); toast.success('Indirect cost updated'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update indirect cost'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`${base}/indirect/${id}`),
    onSuccess: () => { onChange(); toast.success('Indirect cost deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete'),
  });
  const confirmDelete = async (i: { id: string; description: string }) => {
    if (await confirm({ title: 'Delete indirect cost?', message: <>Delete <strong>{i.description}</strong>?</>, confirmLabel: 'Delete', danger: true })) del.mutate(i.id);
  };
  const startEdit = (i: { id: string; type: string; description: string; subCategory: string | null; amount: string | number }) => {
    setEditId(i.id);
    setEf({ type: i.type, description: i.description, subCategory: i.subCategory ?? '', amount: String(Math.trunc(Number(i.amount))) });
  };
  // Running total of recorded indirect lines, so the projected grand total can be
  // previewed before the new line is submitted.
  const indirectTotal = data.indirectCosts.reduce((s, i) => s + Number(i.amount ?? 0), 0);
  const indirectSpent = data.indirectCosts.reduce((s, i) => s + i.actualToDate, 0);
  const indirectRemaining = data.indirectCosts.reduce((s, i) => s + i.remaining, 0);
  const indirectAvailable = data.indirectCosts.reduce((s, i) => s + i.available, 0);
  const indirectUntouched = data.indirectCosts.filter((i) => i.actualToDate === 0);
  const addAmount = Number(amount || 0);

  return (
    <Card className={accentSurface('slate')}>
      <AccordionHeader title="Indirect cost" count={data.indirectCosts.length} total={formatIdr(indirectTotal)} open={open} onToggle={onToggle} icon="layers" accent="slate" spent={indirectSpent} budget={indirectTotal} />
      {open && (<div className="mt-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">Overhead: transport, accommodation, meals, communication, supplies, venue…</p>
        <button onClick={() => setImporting(true)} title="Import indirect cost lines from Excel/CSV"
          className="shrink-0 rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          ⬆ Import
        </button>
      </div>
      {importing && <ImportCostModal projectId={projectId} kind="indirect" onClose={() => setImporting(false)} onImported={onChange} />}
      {data.indirectCosts.length > 0 && (
        <UntouchedNote count={indirectUntouched.length} total={data.indirectCosts.length} remaining={indirectRemaining} names={indirectUntouched.map((i) => i.description)} />
      )}
      {/* Desktop: table. Mobile (< sm): card list below (same edit/delete handlers). */}
      <div className="hidden sm:block">
       <div className="prima-grid-frame">
        <div className="overflow-x-auto">
        <table className="prima-grid w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
              <th>Type</th><th>Description</th><th className="text-right">Amount</th><th className="text-right">Spent</th><th className="text-right">Remaining</th><th className="text-right" title="Budget − spent − committed">Available</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.indirectCosts.map((i, ii) => {
              const editing = editId === i.id;
              return (
              <tr key={i.id} data-cost-focus={i.id} className={`align-top ${ii % 2 === 1 ? 'zebra' : ''} ${flashId === i.id ? '[&>td]:!bg-amber-100 dark:[&>td]:!bg-amber-900/40' : ''}`}>
                <td className="py-2 text-xs text-slate-500 dark:text-slate-400">
                  {editing ? (
                    <Select aria-label="Type" value={ef.type} onChange={(e) => setEf((p) => ({ ...p, type: e.target.value }))}>
                      {INDIRECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  ) : typeLabel(INDIRECT_LABEL, i.type, i.subCategory)}
                </td>
                <td>
                  {editing ? (
                    <>
                      <Input aria-label="Description" value={ef.description} onChange={(e) => setEf((p) => ({ ...p, description: e.target.value }))} />
                      {ef.type === 'OTHER' && (
                        <Input aria-label="Sub-category" className="mt-1" value={ef.subCategory} onChange={(e) => setEf((p) => ({ ...p, subCategory: e.target.value }))} placeholder="Specify category *" />
                      )}
                    </>
                  ) : i.description}
                </td>
                <td className="text-right font-medium tabular-nums">
                  {editing ? <div className="ml-auto w-32"><MoneyInput aria-label="Amount" value={ef.amount} onValueChange={(v) => setEf((p) => ({ ...p, amount: v }))} /></div> : formatIdr(i.amount)}
                </td>
                <td className="text-right tabular-nums text-slate-500 dark:text-slate-400" title="Actual Cost booked to this line">{formatIdr(i.actualToDate)}</td>
                <td className={`text-right tabular-nums font-medium ${i.remaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`} title={i.remaining < 0 ? 'Over budget' : 'Budget still available'}>{formatIdr(i.remaining)}</td>
                <td className={`text-right tabular-nums ${i.available < 0 ? 'text-red-600 dark:text-red-400' : i.committed > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`} title="Budget − spent − committed (free to commit)">{formatIdr(i.available)}</td>
                <td className="text-right whitespace-nowrap">
                  {editing ? (
                    <>
                      <button onClick={() => update.mutate(i.id)} disabled={update.isPending} className="mr-2 text-xs font-medium text-brand-600 hover:underline">save</button>
                      <button onClick={() => setEditId(null)} className="text-xs text-slate-400 hover:underline">cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => onBookAc(`i:${i.id}`)} className="mr-2 text-xs text-emerald-600 hover:underline dark:text-emerald-400" title="Record actual spend against this line">+ AC</button>
                      <button onClick={() => startEdit(i)} className="mr-2 text-xs text-brand-600 hover:underline">edit</button>
                      <button onClick={() => confirmDelete(i)} className="text-xs text-red-500 hover:underline">delete</button>
                    </>
                  )}
                </td>
              </tr>
              );
            })}
            {!data.indirectCosts.length && <tr><td colSpan={7} className="py-3 text-center text-slate-500 dark:text-slate-400">No indirect costs yet.</td></tr>}
          </tbody>
          {data.indirectCosts.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 text-sm font-semibold dark:border-slate-700">
                <td colSpan={2} className="py-2 text-slate-600 dark:text-slate-300">Total ({data.indirectCosts.length} {data.indirectCosts.length === 1 ? 'line' : 'lines'})</td>
                <td className="text-right tabular-nums text-slate-900 dark:text-white">{formatIdr(indirectTotal)}</td>
                <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{formatIdr(indirectSpent)}</td>
                <td className={`text-right tabular-nums ${indirectRemaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>{formatIdr(indirectRemaining)}</td>
                <td className={`text-right tabular-nums ${indirectAvailable < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>{formatIdr(indirectAvailable)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
        </div>
       </div>
      </div>

      {/* Mobile card list — table hidden < sm. Reuses the same edit/delete handlers. */}
      <div className="space-y-2 sm:hidden">
        {data.indirectCosts.map((i) => {
          const editing = editId === i.id;
          if (editing) return (
            <div key={i.id} className="space-y-2 rounded-lg border border-brand-300 bg-brand-50/50 p-3 dark:border-brand-900/50 dark:bg-brand-900/10">
              <Select aria-label="Type" value={ef.type} onChange={(e) => setEf((p) => ({ ...p, type: e.target.value }))}>
                {INDIRECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
              <Input aria-label="Description" value={ef.description} onChange={(e) => setEf((p) => ({ ...p, description: e.target.value }))} placeholder="Description" />
              {ef.type === 'OTHER' && (
                <Input aria-label="Sub-category" value={ef.subCategory} onChange={(e) => setEf((p) => ({ ...p, subCategory: e.target.value }))} placeholder="Specify category *" />
              )}
              <MoneyInput aria-label="Amount" value={ef.amount} onValueChange={(v) => setEf((p) => ({ ...p, amount: v }))} />
              <div className="flex justify-end gap-3">
                <button onClick={() => update.mutate(i.id)} disabled={update.isPending} className="text-xs font-medium text-brand-600 hover:underline">save</button>
                <button onClick={() => setEditId(null)} className="text-xs text-slate-400 hover:underline">cancel</button>
              </div>
            </div>
          );
          return (
            <div key={i.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-transparent dark:shadow-none">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="mb-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">{typeLabel(INDIRECT_LABEL, i.type, i.subCategory)}</div>
                  <div className="font-medium text-slate-700 dark:text-slate-200">{i.description}</div>
                </div>
                <div className="shrink-0 text-right font-semibold tabular-nums text-slate-900 dark:text-white">{formatIdr(i.amount)}</div>
              </div>
              <div className="mt-1 flex gap-4 text-xs">
                <span className="text-slate-500 dark:text-slate-400">Spent: <span className="tabular-nums text-slate-700 dark:text-slate-200">{formatIdr(i.actualToDate)}</span></span>
                <span className="text-slate-500 dark:text-slate-400">Remaining: <span className={`tabular-nums font-medium ${i.remaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>{formatIdr(i.remaining)}</span></span>
                {i.committed > 0 && <span className="text-slate-500 dark:text-slate-400">Available: <span className={`tabular-nums font-medium ${i.available < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatIdr(i.available)}</span></span>}
              </div>
              <div className="mt-2 flex gap-4">
                <button onClick={() => onBookAc(`i:${i.id}`)} className="text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400">+ Record AC</button>
                <button onClick={() => startEdit(i)} className="text-xs text-brand-600 hover:underline">edit</button>
                <button onClick={() => confirmDelete(i)} className="text-xs text-red-500 hover:underline">delete</button>
              </div>
            </div>
          );
        })}
        {!data.indirectCosts.length && <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">No indirect costs yet.</div>}
        {data.indirectCosts.length > 0 && (
          <div className="border-t-2 border-slate-200 pt-2 text-sm font-semibold dark:border-slate-700">
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">Total ({data.indirectCosts.length} {data.indirectCosts.length === 1 ? 'line' : 'lines'})</span>
              <span className="tabular-nums text-slate-900 dark:text-white">{formatIdr(indirectTotal)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs font-normal text-slate-500 dark:text-slate-400">
              <span>Spent {formatIdr(indirectSpent)}</span>
              <span>Remaining <span className={`font-medium ${indirectRemaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>{formatIdr(indirectRemaining)}</span></span>
              <span>Available <span className={`font-medium ${indirectAvailable < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatIdr(indirectAvailable)}</span></span>
            </div>
          </div>
        )}
      </div>

      <div className={`mt-4 grid gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-3 ${isOther ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
        <Select aria-label="Indirect cost type" value={type} onChange={(e) => setType(e.target.value)}>
          {INDIRECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        {isOther && (
          <Input aria-label="Sub-category" placeholder="Specify category *" value={subCategory} onChange={(e) => setSubCategory(e.target.value)} title="Name the kind of cost (e.g. Insurance, Bank charges)" />
        )}
        <Input aria-label="Indirect cost description" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <MoneyInput aria-label="Indirect cost amount (IDR)" placeholder="Amount" value={amount} onValueChange={setAmount} />
        <Button onClick={() => add.mutate()} disabled={!description || !amount || (isOther && !subCategory.trim()) || add.isPending}>Add</Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
        <span className="text-slate-500 dark:text-slate-400">Amount (auto): <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatIdr(addAmount)}</span></span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span className="text-slate-500 dark:text-slate-400" title="Recorded indirect total + this new line">New Indirect total: <span className="font-bold tabular-nums text-slate-900 dark:text-white">{formatIdr(indirectTotal + addAmount)}</span></span>
      </div>
      </div>)}
    </Card>
  );
}
