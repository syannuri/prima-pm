import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AppNotification } from '../api/types';

// A prominent, dismissible banner on the dashboard that surfaces unread "you've been assigned
// as PM" events — the bell badge alone was easy to miss. Shares the ['inbox'] query cache with
// the NotificationBell, so dismissing here also clears the bell's unread count.
export default function AssignmentBanner() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.get<{ items: AppNotification[]; unread: number }>('/notifications/inbox'),
    refetchInterval: 60_000,
  });
  const assigned = (data?.items ?? []).filter((n) => n.type === 'PROJECT_ASSIGNED' && !n.readAt);
  const dismiss = useMutation({
    mutationFn: () => api.post('/notifications/inbox/seen', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox'] }),
  });

  if (!assigned.length) return null;
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-800 dark:bg-brand-900/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-brand-800 dark:text-brand-200">
            🎯 {assigned.length === 1 ? 'You’ve been assigned a new project' : `You’ve been assigned ${assigned.length} new projects`}
          </div>
          <ul className="mt-1.5 space-y-1 text-sm">
            {assigned.map((n) => (
              <li key={n.id} className="truncate">
                {n.projectId ? (
                  <Link to={`/projects/${n.projectId}`} className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
                    {n.body ?? n.title} →
                  </Link>
                ) : (
                  <span className="text-slate-700 dark:text-slate-200">{n.body ?? n.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <button
          onClick={() => dismiss.mutate()}
          disabled={dismiss.isPending}
          className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-60 dark:text-brand-300 dark:hover:bg-brand-800/40"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
