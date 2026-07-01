import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/format';

interface AttentionItem {
  projectId: string;
  projectCode: string;
  projectName: string;
  type: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  tab: string;
  message: string;
}
interface Attention { items: AttentionItem[]; total: number; high: number }
interface ChangeItem { id: string; area: string; action: string; projectId: string | null; projectCode: string; projectName: string; by: string; byRole: string | null; at: string; isNew: boolean }

const SEV_DOT: Record<string, string> = { HIGH: 'bg-red-500', MEDIUM: 'bg-amber-400', LOW: 'bg-slate-400' };
const ATTN_AREA: Record<string, string> = {
  Schedule: 'bg-brand-100 text-brand-700 dark:bg-brand-600/25 dark:text-brand-100',
  Risk: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Cost: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  'Change Req': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
};
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

  // Itemised "needs attention" alerts (overdue tasks, high risks, budget signals,
  // pending change requests) — these used to be a big dashboard banner; now they
  // live in this bell popover.
  const { data: attn } = useQuery({
    queryKey: ['attention'],
    queryFn: () => api.get<Attention>('/notifications/attention'),
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

  const alertTotal = attn?.total ?? 0;
  const high = attn?.high ?? 0;
  const unread = isAdminPmo ? changes?.unread ?? 0 : 0;
  const total = alertTotal + unread;

  // Gentle, faint reminder that fades in → holds → fades out. Shown once per browser
  // session (so it reminds when you open the app, without nagging on every navigation).
  const REMIND_MS = 8000;
  const [remind, setRemind] = useState(false);
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current || !attn || attn.total === 0) return;
    firedRef.current = true;
    try {
      if (sessionStorage.getItem('prima_attn_reminded')) return;
      sessionStorage.setItem('prima_attn_reminded', '1');
    } catch { /* ignore */ }
    setRemind(true);
    const t = setTimeout(() => setRemind(false), REMIND_MS);
    return () => clearTimeout(t);
  }, [attn]);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next && unread > 0 && !markSeen.isPending) markSeen.mutate();
      return next;
    });
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-lg transition hover:bg-slate-100 dark:hover:bg-slate-800"
        title="Notifications"
        aria-label={`Notifications${total > 0 ? ` (${total})` : ''}`}
      >
        🔔
        {total > 0 && (
          <span className={`absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-xs font-bold text-white ${high > 0 ? 'bg-red-600' : 'bg-amber-500'}`}>
            {total}
          </span>
        )}
      </button>

      {/* Faint, self-dismissing reminder — nudges you toward the bell without nagging. */}
      {remind && !open && (
        <button
          onClick={() => { setRemind(false); setOpen(true); }}
          style={{ ['--remind-ms' as string]: `${REMIND_MS}ms` }}
          className="prima-remind absolute right-0 top-full z-20 mt-2 flex items-center gap-2 whitespace-nowrap rounded-full border border-amber-300/40 bg-amber-50/70 px-3 py-1.5 text-xs font-medium text-amber-800 shadow-lg backdrop-blur-md dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <span className="relative flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${high > 0 ? 'bg-red-400' : 'bg-amber-400'}`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${high > 0 ? 'bg-red-500' : 'bg-amber-500'}`} />
          </span>
          {alertTotal} {alertTotal === 1 ? 'item needs' : 'items need'} attention{high > 0 ? ` · ${high} high` : ''}
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="prima-toast absolute right-0 z-20 mt-2 w-80 rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-xl backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/90">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Needs attention</span>
              {alertTotal > 0 && (
                <span className={`grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-xs font-bold text-white ${high > 0 ? 'bg-red-600' : 'bg-amber-500'}`}>{alertTotal}</span>
              )}
              {high > 0 && <span className="text-xs text-slate-400 dark:text-slate-500">{high} high</span>}
            </div>

            {!attn?.items.length ? (
              <p className="py-3 text-center text-sm text-slate-400 dark:text-slate-500">All clear — nothing needs attention 🎉</p>
            ) : (
              <ul className="max-h-72 space-y-0.5 overflow-y-auto">
                {attn.items.map((it, i) => (
                  <li key={i}>
                    <Link
                      to={`/projects/${it.projectId}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-100/70 dark:hover:bg-slate-800/70"
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[it.severity] ?? 'bg-slate-400'}`} title={it.severity} />
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${ATTN_AREA[it.tab] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{it.tab}</span>
                      <span className="truncate text-sm text-slate-700 dark:text-slate-200" title={it.message}>{it.message}</span>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-slate-400 dark:text-slate-500">{it.projectCode}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {isAdminPmo && (
              <div className="mt-3 border-t border-slate-200/70 pt-2 dark:border-slate-800/70">
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
                        <Link to={`/projects/${c.projectId}`} onClick={() => setOpen(false)} className={`block rounded-lg px-2 py-1 hover:bg-slate-100/70 dark:hover:bg-slate-800/70 ${c.isNew ? 'bg-brand-50/70 dark:bg-brand-600/15' : ''}`}>
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
