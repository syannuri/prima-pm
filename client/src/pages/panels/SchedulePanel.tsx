import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Card, SectionTitle } from '../../components/ui';
import { formatNum } from '../../lib/format';
import WbsPanel from './WbsPanel';
import CriticalPathPanel from './CriticalPathPanel';

export default function SchedulePanel({ projectId }: { projectId: string }) {
  const base = `/projects/${projectId}/schedule`;
  const syncQ = useQuery({ queryKey: ['mp-sync', projectId], queryFn: () => api.get<{ rows: ManpowerSyncRow[] }>(`${base}/manpower-sync`) });

  return (
    <div className="space-y-5">
      {/* Project Health (EVM) moved to its own Monitoring → Health tab + the header strip.
          Anchor ids let the header "More → Jump to" menu deep-link to these sections. */}
      <div id="section-wbs" className="scroll-mt-24"><WbsPanel projectId={projectId} /></div>
      <div id="section-cpm" className="scroll-mt-24"><CriticalPathPanel projectId={projectId} /></div>
      <div id="section-manpower" className="scroll-mt-24"><ManpowerSync rows={syncQ.data?.rows ?? []} /></div>
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
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
            <th className="py-2">Task</th><th className="text-right">Sched. days</th><th className="text-right">Mandays</th>
            <th className="text-right">Variance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.taskId} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-2">{r.taskName}</td>
              <td className="text-right">{r.scheduleWorkingDays}</td>
              <td className="text-right">{formatNum(r.linkedPlanMandays)}</td>
              <td className="text-right">{formatNum(r.variance)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="py-3 text-center text-slate-500 dark:text-slate-400">No tasks.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

