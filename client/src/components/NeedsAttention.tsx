import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Card } from './ui';

interface AttentionItem {
  projectId: string;
  projectCode: string;
  projectName: string;
  type: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  tab: string;
  message: string;
}

const SEV_DOT: Record<string, string> = { HIGH: 'bg-red-500', MEDIUM: 'bg-amber-400', LOW: 'bg-slate-400' };
const AREA_COLOR: Record<string, string> = {
  Schedule: 'bg-brand-100 text-brand-700 dark:bg-brand-600/25 dark:text-brand-100',
  Risk: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Cost: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  'Change Req': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
};

// Action panel: overdue tasks, high risks, budget signals & pending change
// requests across the caller's projects, surfaced for quick triage.
export default function NeedsAttention() {
  const { data } = useQuery({
    queryKey: ['attention'],
    queryFn: () => api.get<{ items: AttentionItem[]; total: number; high: number }>('/notifications/attention'),
    refetchInterval: 60_000,
  });
  if (!data) return null;

  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Needs attention</span>
        {data.total > 0 && (
          <span className={`grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-xs font-bold text-white ${data.high > 0 ? 'bg-red-600' : 'bg-amber-500'}`}>{data.total}</span>
        )}
        {data.high > 0 && <span className="text-xs text-slate-400 dark:text-slate-500">{data.high} high priority</span>}
      </div>
      {data.total === 0 ? (
        <p className="py-3 text-center text-sm text-slate-400 dark:text-slate-500">Nothing needs your attention — all clear 🎉</p>
      ) : (
        <ul className="space-y-0.5">
          {data.items.map((it, i) => (
            <li key={i}>
              <Link to={`/projects/${it.projectId}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">
                <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[it.severity] ?? 'bg-slate-400'}`} title={it.severity} />
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${AREA_COLOR[it.tab] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{it.tab}</span>
                <span className="truncate text-sm text-slate-700 dark:text-slate-200">{it.message}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-slate-400 dark:text-slate-500">{it.projectCode}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
