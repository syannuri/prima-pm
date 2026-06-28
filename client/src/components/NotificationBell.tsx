import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/format';

interface BellData {
  total: number;
  high: number;
  projects: { projectId: string; code: string; name: string; total: number; high: number }[];
}
interface ChangeItem { id: string; area: string; action: string; projectId: string | null; projectCode: string; projectName: string; by: string; byRole: string | null; at: string; isNew: boolean }

const AREA_COLOR: Record<string, string> = {
  WBS: 'bg-brand-100 text-brand-700 dark:bg-brand-600/25 dark:text-brand-100',
  Cost: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  Risk: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};
const ACTION_LABEL: Record<string, string> = { CREATE: 'added', UPDATE: 'edited', DELETE: 'removed' };

export default function NotificationBell() {
  const { user } = useAuth();
  const isAdminPmo = !!user && ['ADMIN', 'PMO'].includes(user.role);
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<BellData>('/notifications'),
    refetchInterval: 60_000,
  });
  const { data: changes } = useQuery({
    queryKey: ['changes'],
    queryFn: () => api.get<{ changes: ChangeItem[]; unread: number }>('/notifications/changes'),
    enabled: isAdminPmo,
    refetchInterval: 60_000,
  });

  const markSeen = useMutation({
    mutationFn: () => api.post('/notifications/changes/seen', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['changes'] }),
  });

  const alertTotal = data?.total ?? 0;
  const high = data?.high ?? 0;
  const unread = isAdminPmo ? changes?.unread ?? 0 : 0;
  const total = alertTotal + unread;

  function toggle() {
    setOpen((o) => {
      const next = !o;
      // Opening the panel marks the change feed as read.
      if (next && unread > 0 && !markSeen.isPending) markSeen.mutate();
      return next;
    });
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-lg hover:bg-slate-100 dark:hover:bg-slate-800"
        title="Notifications"
      >
        🔔
        {total > 0 && (
          <span className={`absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-xs font-bold text-white ${high > 0 ? 'bg-red-600' : 'bg-amber-500'}`}>
            {total}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-lg">
            <div className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Alerts {alertTotal > 0 && <span className="text-slate-400 dark:text-slate-500">({alertTotal}, {high} high)</span>}
            </div>
            {!data?.projects.length ? (
              <p className="py-3 text-center text-sm text-slate-400 dark:text-slate-500">No active alerts 🎉</p>
            ) : (
              <ul className="space-y-1">
                {data.projects.map((p) => (
                  <li key={p.projectId}>
                    <Link
                      to={`/projects/${p.projectId}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="truncate text-sm text-slate-700 dark:text-slate-200">
                        <span className="font-mono text-xs text-slate-400 dark:text-slate-500">{p.code}</span> {p.name}
                      </span>
                      <span className="ml-2 flex shrink-0 gap-1">
                        {p.high > 0 && <span className="rounded-full bg-red-100 px-1.5 text-xs text-red-700">{p.high}</span>}
                        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 text-xs text-slate-600 dark:text-slate-300">{p.total}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {isAdminPmo && (
              <div className="mt-3 border-t border-slate-100 pt-2 dark:border-slate-800">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">
                  Recent changes (WBS · Cost · Risk)
                  {unread > 0 && <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold normal-case text-white">{unread} new</span>}
                </div>
                {!changes?.changes.length ? (
                  <p className="py-2 text-center text-xs text-slate-400 dark:text-slate-500">No recent changes</p>
                ) : (
                  <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                    {changes.changes.map((c) => (
                      <li key={c.id}>
                        <Link to={`/projects/${c.projectId}`} onClick={() => setOpen(false)} className={`block rounded-lg px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800 ${c.isNew ? 'bg-brand-50 dark:bg-brand-600/15' : ''}`}>
                          <div className="flex items-center gap-1.5 text-xs">
                            {c.isNew && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" title="New" />}
                            <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${AREA_COLOR[c.area] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{c.area}</span>
                            <span className="text-slate-500 dark:text-slate-400">{ACTION_LABEL[c.action] ?? c.action.toLowerCase()}</span>
                            <span className="ml-auto shrink-0 text-[10px] text-slate-400 dark:text-slate-500">{formatDate(c.at)}</span>
                          </div>
                          <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                            <span className="font-mono">{c.projectCode}</span> · by {c.by}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
