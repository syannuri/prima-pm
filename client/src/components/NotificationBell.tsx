import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
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
  // Personal inbox — discrete events for this user (e.g. being assigned as PM).
  const { data: inbox } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.get<{ items: import('../api/types').AppNotification[]; unread: number }>('/notifications/inbox'),
    refetchInterval: 60_000,
  });

  const markSeen = useMutation({
    mutationFn: () => api.post('/notifications/changes/seen', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['changes'] }),
  });
  const markInboxSeen = useMutation({
    mutationFn: () => api.post('/notifications/inbox/seen', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  });

  const alertTotal = attn?.total ?? 0;
  const high = attn?.high ?? 0;
  const unread = isAdminPmo ? changes?.unread ?? 0 : 0;
  const inboxUnread = inbox?.unread ?? 0;
  const total = alertTotal + unread + inboxUnread;

  // Gentle, faint reminder that fades in → holds → fades out — shown every time the
  // user opens the dashboard (the bell lives in the persistent layout, so we re-arm on
  // each navigation back to the dashboard route).
  const REMIND_MS = 8000;
  const onDashboard = useLocation().pathname === '/';
  const [remind, setRemind] = useState(false);
  const [fireKey, setFireKey] = useState(0);
  const armedRef = useRef(onDashboard);

  useEffect(() => {
    if (onDashboard) armedRef.current = true;
    else setRemind(false); // hide when leaving the dashboard
  }, [onDashboard]);

  useEffect(() => {
    if (!armedRef.current || (attn?.total ?? 0) === 0) return;
    armedRef.current = false; // consume for this visit
    setFireKey((k) => k + 1); // restart the fade animation
    setRemind(true);
  }, [attn, onDashboard]);

  useEffect(() => {
    if (!remind) return;
    const t = setTimeout(() => setRemind(false), REMIND_MS);
    return () => clearTimeout(t);
  }, [remind]);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next && unread > 0 && !markSeen.isPending) markSeen.mutate();
      if (next && inboxUnread > 0 && !markInboxSeen.isPending) markInboxSeen.mutate();
      return next;
    });
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        title="Notifications"
        aria-label={`Notifications${total > 0 ? ` (${total})` : ''}`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {total > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-slate-500 px-1 text-xs font-bold text-white ring-2 ring-white dark:bg-slate-600 dark:ring-slate-900">
            {total}
          </span>
        )}
      </button>

      {/* Faint, self-dismissing reminder — nudges you toward the bell without nagging. */}
      {remind && !open && (
        <button
          key={fireKey}
          onClick={() => { setRemind(false); setOpen(true); }}
          style={{ ['--remind-ms' as string]: `${REMIND_MS}ms` }}
          className="prima-remind absolute right-0 top-full z-20 mt-2 flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-full border border-amber-300/40 bg-amber-50/70 px-3 py-1.5 text-xs font-medium text-amber-800 shadow-lg backdrop-blur-md dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200 sm:whitespace-nowrap"
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
          {/* Mobile: pinned below the header, full width with margins (a right-anchored w-80 ran off-screen left). sm+: dropdown under the bell. */}
          <div className="prima-toast fixed inset-x-2 top-[calc(3.5rem+env(safe-area-inset-top))] z-20 max-h-[75vh] w-auto overflow-y-auto rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-xl backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/90 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[80vh] sm:w-80">
            {/* Personal inbox — assignment & other discrete events */}
            {!!inbox?.items.length && (
              <div className="mb-3">
                <div className="mb-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">For you</div>
                <ul className="space-y-0.5">
                  {inbox.items.slice(0, 6).map((n) => {
                    const isNew = !n.readAt && inboxUnread > 0;
                    const inner = (
                      <div className={`rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-100/70 dark:hover:bg-slate-800/70 ${isNew ? 'bg-brand-50/70 dark:bg-brand-600/15' : ''}`}>
                        <div className="flex items-center gap-1.5">
                          {isNew && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" title="New" />}
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{n.title}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-slate-500 dark:text-slate-400">{formatDate(n.createdAt)}</span>
                        </div>
                        {n.body && <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{n.body}</div>}
                      </div>
                    );
                    return (
                      <li key={n.id}>
                        {n.projectId ? <Link to={`/projects/${n.projectId}`} onClick={() => setOpen(false)} className="block">{inner}</Link> : inner}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-2 border-t border-slate-200/70 dark:border-slate-800/70" />
              </div>
            )}
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Needs attention</span>
              {alertTotal > 0 && (
                <span className={`grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-xs font-bold text-white ${high > 0 ? 'bg-red-600' : 'bg-amber-500'}`}>{alertTotal}</span>
              )}
              {high > 0 && <span className="text-xs text-slate-500 dark:text-slate-400">{high} high</span>}
            </div>

            {!attn?.items.length ? (
              <p className="py-3 text-center text-sm text-slate-500 dark:text-slate-400">All clear — nothing needs attention 🎉</p>
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
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-slate-500 dark:text-slate-400">{it.projectCode}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {isAdminPmo && (
              <div className="mt-3 border-t border-slate-200/70 pt-2 dark:border-slate-800/70">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Recent changes (WBS · Cost · Risk)
                  {unread > 0 && <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold normal-case text-white">{unread} new</span>}
                </div>
                {!changes?.changes.length ? (
                  <p className="py-2 text-center text-xs text-slate-500 dark:text-slate-400">No recent changes</p>
                ) : (
                  <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                    {changes.changes.map((c) => (
                      <li key={c.id}>
                        <Link to={`/projects/${c.projectId}`} onClick={() => setOpen(false)} className={`block rounded-lg px-2 py-1 hover:bg-slate-100/70 dark:hover:bg-slate-800/70 ${c.isNew ? 'bg-brand-50/70 dark:bg-brand-600/15' : ''}`}>
                          <div className="flex items-center gap-1.5 text-xs">
                            {c.isNew && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" title="New" />}
                            <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${AREA_COLOR[c.area] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{c.area}</span>
                            <span className="text-slate-500 dark:text-slate-400">{ACTION_LABEL[c.action] ?? c.action.toLowerCase()}</span>
                            <span className="ml-auto shrink-0 text-[10px] text-slate-500 dark:text-slate-400">{formatDate(c.at)}</span>
                          </div>
                          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
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
