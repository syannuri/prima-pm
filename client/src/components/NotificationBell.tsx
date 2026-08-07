import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
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
  key: string; // dismissal signature — POST to follow it up
}

// Small ✓ "followed up" action shared by both lists — hides the item (re-appears for a live alert
// only if it changes).
function FollowUpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      title="Mark as followed up"
      aria-label="Mark as followed up"
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-emerald-100 hover:text-emerald-600 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-400"
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 10.5l4 4 8-9" />
      </svg>
    </button>
  );
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
  // Follow up (✓) ONE "For you" item — it's marked done and won't return.
  const followUpInbox = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/inbox/${id}/read`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  });
  // Follow up (✓) ONE "Needs attention" alert — hidden until it changes (new signature).
  const followUpAttn = useMutation({
    mutationFn: (signature: string) => api.post('/notifications/attention/dismiss', { signature }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attention'] }),
  });

  const alertTotal = attn?.total ?? 0;
  const high = attn?.high ?? 0;
  const unread = isAdminPmo ? changes?.unread ?? 0 : 0;
  const inboxUnread = inbox?.unread ?? 0;
  const total = alertTotal + unread + inboxUnread;

  // Dropdown filter tabs + a one-click "mark all read" (clears the changes feed + follows up every
  // "For you" item; live "Needs attention" signals are left — they clear themselves as they resolve).
  const [filter, setFilter] = useState<'all' | 'inbox' | 'attn' | 'changes'>('all');
  const markAllRead = () => {
    if (unread > 0 && !markSeen.isPending) markSeen.mutate();
    inbox?.items.forEach((n) => followUpInbox.mutate(n.id));
  };

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
      // The "Recent changes" feed still clears its unread badge on open; the "For you" inbox no
      // longer auto-clears — items stay until each is followed up (✓).
      if (next && unread > 0 && !markSeen.isPending) markSeen.mutate();
      return next;
    });
  }

  // The dropdown is PORTALED to <body> so it escapes the app-shell stacking context — the header
  // is only z-10, so the sticky project tab strip (z-[31]) painted OVER an in-header dropdown no
  // matter its own z-index (same reason AvatarMenu portals). Portaled + z-[61] it sits in the root
  // layer. Position = fixed coords from the bell's rect: a right-anchored w-80 card on sm+, a
  // full-width sheet pinned under the header on phones.
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const gap = 8, m = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    const maxHeight = vh - (r.bottom + gap) - m;
    setPos(window.matchMedia('(min-width: 640px)').matches
      ? { position: 'fixed', top: r.bottom + gap, right: Math.max(m, vw - r.right), width: '20rem', maxHeight }
      : { position: 'fixed', top: r.bottom + gap, left: m, right: m, maxHeight });
  }, [open]);

  // Keyboard dismissal + close on resize/orientation change (the fixed coords would go stale).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white"
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
          {alertTotal} {alertTotal === 1 ? 'alert' : 'alerts'}{high > 0 ? ` · ${high} high` : ''}
        </button>
      )}

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          {/* Portaled to <body> + fixed coords (see btnRef effect): a right-anchored w-80 card on
              sm+, a full-width sheet under the header on phones — sits above the sticky tab strip. */}
          <div style={pos} className="prima-toast z-[61] overflow-y-auto rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-xl backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/90">
            {/* Filter tabs + one-click mark-all-read */}
            <div className="mb-2 flex items-center gap-1 border-b border-slate-200/70 pb-2 dark:border-slate-800/70">
              {([['all', 'All'], ['inbox', 'For you'], ['attn', 'Attention'], ['changes', 'Changes']] as const)
                .filter(([k]) => (k !== 'changes' || isAdminPmo) && (k !== 'inbox' || !!inbox?.items.length))
                .map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setFilter(k)}
                    aria-pressed={filter === k}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition ${filter === k ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'}`}
                  >
                    {label}
                  </button>
                ))}
              {(inboxUnread > 0 || unread > 0) && (
                <button onClick={markAllRead} className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-900/20">
                  Mark all read
                </button>
              )}
            </div>
            {/* Personal inbox — assignment & other discrete events */}
            {(filter === 'all' || filter === 'inbox') && !!inbox?.items.length && (
              <div className="mb-3">
                <div className="mb-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">For you</div>
                <ul className="space-y-0.5">
                  {inbox.items.slice(0, 6).map((n) => {
                    const inner = (
                      <div className="rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-100/70 dark:hover:bg-slate-800/70">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{n.title}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-slate-500 dark:text-slate-400">{formatDate(n.createdAt)}</span>
                        </div>
                        {n.body && <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{n.body}</div>}
                      </div>
                    );
                    return (
                      <li key={n.id} className="flex items-center gap-1">
                        <div className="min-w-0 flex-1">
                          {n.type === 'ORG_SIGNUP_PENDING'
                            ? <Link to="/admin/tenants" onClick={() => setOpen(false)} className="block">{inner}</Link>
                            : n.projectId ? <Link to={`/projects/${n.projectId}${n.type === 'ACTIVATION_READY' ? '?review=activation' : ''}`} onClick={() => setOpen(false)} className="block">{inner}</Link> : inner}
                        </div>
                        <FollowUpButton onClick={() => followUpInbox.mutate(n.id)} />
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-2 border-t border-slate-200/70 dark:border-slate-800/70" />
              </div>
            )}
            {(filter === 'all' || filter === 'attn') && (
            <>
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
                  <li key={it.key ?? i} className="flex items-center gap-1">
                    <Link
                      to={`/projects/${it.projectId}`}
                      onClick={() => setOpen(false)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-100/70 dark:hover:bg-slate-800/70"
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[it.severity] ?? 'bg-slate-400'}`} title={it.severity} />
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${ATTN_AREA[it.tab] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{it.tab}</span>
                      <span className="truncate text-sm text-slate-700 dark:text-slate-200" title={it.message}>{it.message}</span>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-slate-500 dark:text-slate-400">{it.projectCode}</span>
                    </Link>
                    <FollowUpButton onClick={() => followUpAttn.mutate(it.key)} />
                  </li>
                ))}
              </ul>
            )}
            </>
            )}

            {(filter === 'all' || filter === 'changes') && isAdminPmo && (
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
        </>,
        document.body,
      )}
    </div>
  );
}
