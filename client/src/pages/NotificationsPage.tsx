import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AppNotification, NotifCategory } from '../api/types';
import { Button, Card, EmptyState, Spinner } from '../components/ui';
import { useLang } from '../context/LanguageContext';
import { formatDate } from '../lib/format';
import { notificationHref } from '../lib/notificationLink';

type Filter = 'all' | NotifCategory;
interface HistoryPage { items: AppNotification[]; nextCursor: string | null }

const CAT_CHIP: Record<NotifCategory, string> = {
  approvals: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  assignments: 'bg-brand-100 text-brand-700 dark:bg-brand-600/25 dark:text-brand-100',
  account: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  other: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

// Full notification history with category filtering + read/unread — the "Pusat Notifikasi". The
// header bell keeps its live unread-only view; this is the archive. Reached from the bell's
// "See all" link and the AvatarMenu.
export default function NotificationsPage() {
  const { lang } = useLang();
  const id = lang === 'id';
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');

  const t = {
    title: id ? 'Notifikasi' : 'Notifications',
    subtitle: id ? 'Riwayat lengkap pemberitahuanmu — approval, penugasan, akun.' : 'Your full notification history — approvals, assignments, account.',
    markAll: id ? 'Tandai semua dibaca' : 'Mark all read',
    empty: id ? 'Belum ada notifikasi di kategori ini.' : 'No notifications in this category.',
    more: id ? 'Muat lebih banyak' : 'Load more',
  };
  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: id ? 'Semua' : 'All' },
    { key: 'approvals', label: id ? 'Approval' : 'Approvals' },
    { key: 'assignments', label: id ? 'Penugasan' : 'Assignments' },
    { key: 'account', label: id ? 'Akun' : 'Account' },
    { key: 'other', label: id ? 'Lainnya' : 'Other' },
  ];
  const CAT_LABEL: Record<NotifCategory, string> = {
    approvals: id ? 'Approval' : 'Approvals',
    assignments: id ? 'Penugasan' : 'Assignments',
    account: id ? 'Akun' : 'Account',
    other: id ? 'Lainnya' : 'Other',
  };

  const q = useInfiniteQuery({
    queryKey: ['notif-history', filter],
    queryFn: ({ pageParam }) =>
      api.get<HistoryPage>(`/notifications/history?category=${filter}&limit=25${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const hasUnread = items.some((n) => !n.readAt);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notif-history'] });
    qc.invalidateQueries({ queryKey: ['inbox'] }); // keep the bell badge in sync
  };
  const markOne = useMutation({ mutationFn: (nid: string) => api.post(`/notifications/inbox/${nid}/read`, {}), onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: () => api.post('/notifications/inbox/seen', {}), onSuccess: invalidate });

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{t.title}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t.subtitle}</p>
        </div>
        {hasUnread && <Button variant="secondary" onClick={() => markAll.mutate()} disabled={markAll.isPending}>{t.markAll}</Button>}
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition ${
              filter === f.key ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <Card><EmptyState icon="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 0 1-6 0v-1m6 0H9" title={t.empty} /></Card>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const href = notificationHref(n);
            const cat = n.category ?? 'other';
            const inner = (
              <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition ${
                n.readAt ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900' : 'border-brand-200 bg-brand-50/40 dark:border-brand-800/60 dark:bg-brand-900/10'
              } ${href ? 'hover:border-brand-300 hover:shadow-sm dark:hover:border-brand-700' : ''}`}>
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-brand-500'}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CAT_CHIP[cat]}`}>{CAT_LABEL[cat]}</span>
                    <span className={`text-sm ${n.readAt ? 'font-medium text-slate-700 dark:text-slate-200' : 'font-semibold text-slate-800 dark:text-slate-100'}`}>{n.title}</span>
                  </div>
                  {n.body && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-slate-400">{formatDate(n.createdAt)}</p>
                </div>
                {!n.readAt && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); markOne.mutate(n.id); }}
                    title={id ? 'Tandai dibaca' : 'Mark read'}
                    aria-label={id ? 'Tandai dibaca' : 'Mark read'}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-emerald-100 hover:text-emerald-600 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-400"
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 10.5l4 4 8-9" /></svg>
                  </button>
                )}
              </div>
            );
            return href ? <Link key={n.id} to={href} className="block">{inner}</Link> : <div key={n.id}>{inner}</div>;
          })}

          {q.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button variant="secondary" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                {q.isFetchingNextPage ? (id ? 'Memuat…' : 'Loading…') : t.more}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
