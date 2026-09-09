import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Card, SectionTitle } from '../../components/ui';
import { formatNum } from '../../lib/format';
import WbsPanel from './WbsPanel';
import CriticalPathPanel from './CriticalPathPanel';
import { useSidebarAutoCollapse } from '../../context/SidebarContext';

// The Schedule tab is a single-view workspace with a segmented switcher: the Gantt is the primary
// canvas (default, full height), and the Critical Path (CPM) and Resources (manpower↔schedule)
// read-outs are sibling views — one at a time, each full width — instead of a long vertical stack
// that buried them under the Gantt. The active view persists (localStorage) and is deep-link-able
// via ?sview=; a task deep-link (?focus → focusTaskId) always resolves to the Gantt.
type SView = 'gantt' | 'cpm' | 'resources';
const SVIEWS: SView[] = ['gantt', 'cpm', 'resources'];

export default function SchedulePanel({ projectId, focusTaskId, focusKey }: { projectId: string; focusTaskId?: string | null; focusKey?: number; onNavigateTab?: (tab: string) => void }) {
  // Collapse the workspace sidebar while the Timeline is open; restore on leaving (see the hook).
  useSidebarAutoCollapse();
  const base = `/projects/${projectId}/schedule`;
  const syncQ = useQuery({ queryKey: ['mp-sync', projectId], queryFn: () => api.get<{ rows: ManpowerSyncRow[] }>(`${base}/manpower-sync`) });

  const [params, setParams] = useSearchParams();
  const urlView = params.get('sview');
  const [stored, setStored] = useState<SView>(() => {
    if (urlView && SVIEWS.includes(urlView as SView)) return urlView as SView;
    const s = localStorage.getItem('prima_schedule_view');
    return s && SVIEWS.includes(s as SView) ? (s as SView) : 'gantt';
  });
  // React to a deep-link / "Jump to" that arrives while already mounted (?sview changes).
  useEffect(() => {
    if (urlView && SVIEWS.includes(urlView as SView)) setStored(urlView as SView);
  }, [urlView]);
  // A task deep-link inherently targets the Gantt, so force it there while a focus is active.
  const view: SView = focusTaskId ? 'gantt' : stored;
  const setView = (v: SView) => {
    setStored(v);
    localStorage.setItem('prima_schedule_view', v);
    if (urlView) { params.delete('sview'); setParams(params, { replace: true }); }
  };

  // Resource attention: any manpower row that isn't reconciled with the schedule.
  const syncRows = syncQ.data?.rows ?? [];
  const resourceAlerts = syncRows.filter((r) => r.status !== 'OK').length;

  return (
    <div className="space-y-4">
      <ViewSwitcher value={view} onChange={setView} resourceAlerts={resourceAlerts} />
      {view === 'gantt' && (
        <div id="section-wbs" className="scroll-mt-24"><WbsPanel projectId={projectId} focusTaskId={focusTaskId} focusKey={focusKey} /></div>
      )}
      {view === 'cpm' && (
        <div id="section-cpm" className="scroll-mt-24"><CriticalPathPanel projectId={projectId} /></div>
      )}
      {view === 'resources' && (
        <div id="section-manpower" className="scroll-mt-24"><ManpowerSync rows={syncRows} /></div>
      )}
    </div>
  );
}

// Segmented view switcher — Gantt (canvas) · Critical Path · Resources. A small amber badge on
// Resources flags manpower rows that don't reconcile with the schedule, so the check is visible
// without opening the view.
function ViewSwitcher({ value, onChange, resourceAlerts }: { value: SView; onChange: (v: SView) => void; resourceAlerts: number }) {
  const items: { id: SView; label: string; icon: string; badge?: number }[] = [
    { id: 'gantt', label: 'Gantt', icon: '▦' },
    { id: 'cpm', label: 'Critical Path', icon: '⇄' },
    { id: 'resources', label: 'Resources', icon: '👷', badge: resourceAlerts },
  ];
  return (
    <div role="tablist" aria-label="Schedule view" className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              active
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <span aria-hidden className="text-[13px] leading-none">{it.icon}</span>
            {it.label}
            {it.badge ? (
              <span className={`ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${active ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'}`}>
                {it.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

interface ManpowerSyncRow {
  taskId: string; taskName: string; scheduleWorkingDays: number; linkedPlanMandays: number; variance: number;
  status: 'OK' | 'OVER_ALLOCATED' | 'UNDER_ALLOCATED' | 'NO_MANPOWER';
}

function ManpowerSync({ rows }: { rows: ManpowerSyncRow[] }) {
  return (
    <Card>
      <SectionTitle sub="Reconcile Cost manpower mandays against schedule duration">Manpower ↔ Schedule Sync</SectionTitle>
      <table className="prima-rows w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
            <th className="py-2">Task</th><th className="text-right tabular-nums">Sched. days</th><th className="text-right tabular-nums">Mandays</th>
            <th className="text-right tabular-nums">Variance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.taskId} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-2">{r.taskName}</td>
              <td className="text-right tabular-nums">{r.scheduleWorkingDays}</td>
              <td className="text-right tabular-nums">{formatNum(r.linkedPlanMandays)}</td>
              <td className="text-right tabular-nums">{formatNum(r.variance)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="py-3 text-center text-slate-500 dark:text-slate-400">No tasks.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}
