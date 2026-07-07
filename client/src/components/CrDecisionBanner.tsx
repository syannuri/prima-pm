import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AppNotification } from '../api/types';

// Surfaces change-request decisions (approved / rejected) for the PM right on the project
// page — not just in the bell. Driven by the personal inbox: shows the unread CR-decision
// notifications for THIS project (only the requester has them), with the next step for an
// approval (apply the change, then re-lock). Dismissing marks the inbox seen.
export default function CrDecisionBanner({ projectId, onJump }: { projectId: string; onJump: (tab: string) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.get<{ items: AppNotification[]; unread: number }>('/notifications/inbox'),
  });
  const seen = useMutation({
    mutationFn: () => api.post('/notifications/inbox/seen', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox'] }),
  });

  const decisions = (data?.items ?? []).filter(
    (n) => n.projectId === projectId && (n.type === 'CR_APPROVED' || n.type === 'CR_REJECTED') && !n.readAt,
  );
  if (!decisions.length) return null;

  return (
    <div className="space-y-1.5">
      {decisions.map((n) => {
        const approved = n.type === 'CR_APPROVED';
        return (
          <div
            key={n.id}
            className={`rounded-lg border px-3 py-2 text-sm ${
              approved
                ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/40 dark:bg-green-900/15 dark:text-green-200'
                : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-900/15 dark:text-red-200'
            }`}
          >
            <div className="flex items-start gap-2">
              <span className="text-base leading-5">{approved ? '✅' : '⛔'}</span>
              <div className="flex-1">
                <div className="font-medium">{n.title}</div>
                <div className="text-[13px] opacity-90">{n.body}</div>
                {approved && (
                  <div className="mt-0.5 text-xs opacity-80">Apply the change on the Cost / Schedule tab, then re-lock the baseline.</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => { onJump('Change Req'); seen.mutate(); }}
                  className="rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:brightness-95"
                >
                  Open Change Req →
                </button>
                <button onClick={() => seen.mutate()} title="Dismiss" className="px-1 text-sm opacity-60 hover:opacity-100">✕</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
