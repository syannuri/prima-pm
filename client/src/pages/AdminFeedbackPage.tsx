import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Card, Badge, Button, SectionTitle, PanelLoading } from '../components/ui';
import { formatDate } from '../lib/format';

interface FeedbackItem {
  id: string;
  type: 'BUG' | 'IDEA' | 'OTHER';
  message: string;
  pageUrl: string | null;
  role: string | null;
  release: string | null;
  status: 'OPEN' | 'REVIEWED' | 'CLOSED';
  createdAt: string;
  user: { name: string | null; email: string } | null;
}

const STATUSES = ['ALL', 'OPEN', 'REVIEWED', 'CLOSED'] as const;
const TYPE_META: Record<string, { color: string; icon: string }> = {
  BUG: { color: 'red', icon: '🐞' },
  IDEA: { color: 'amber', icon: '💡' },
  OTHER: { color: 'slate', icon: '💬' },
};
const STATUS_COLOR: Record<string, string> = { OPEN: 'amber', REVIEWED: 'sky', CLOSED: 'green' };

export default function AdminFeedbackPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('OPEN');
  const q = useQuery({
    queryKey: ['admin-feedback', status],
    queryFn: () => api.get<{ items: FeedbackItem[] }>(`/admin/feedback?status=${status}`),
  });
  const setStatusM = useMutation({
    mutationFn: (v: { id: string; status: FeedbackItem['status'] }) => api.patch(`/admin/feedback/${v.id}`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-feedback'] }),
  });

  return (
    <Card>
      <SectionTitle sub="Bug reports, ideas and comments sent from inside the app">Feedback inbox</SectionTitle>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              status === s
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <PanelLoading />
      ) : !q.data?.items.length ? (
        <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">No feedback here yet.</p>
      ) : (
        <div className="space-y-3">
          {q.data.items.map((f) => {
            const tm = TYPE_META[f.type] ?? TYPE_META.OTHER;
            return (
              <div key={f.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <Badge color={tm.color}>{tm.icon} {f.type}</Badge>
                  <Badge color={STATUS_COLOR[f.status]}>{f.status}</Badge>
                  <span className="text-slate-500 dark:text-slate-400">
                    {f.user?.email ?? 'unknown'}{f.role ? ` · ${f.role}` : ''} · {formatDate(new Date(f.createdAt))}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">{f.message}</p>
                {(f.pageUrl || f.release) && (
                  <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                    {f.pageUrl && <>Page: <span className="font-mono">{f.pageUrl}</span></>}
                    {f.pageUrl && f.release && ' · '}
                    {f.release && <>Release: <span className="font-mono">{f.release}</span></>}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  {f.status !== 'REVIEWED' && (
                    <Button variant="secondary" onClick={() => setStatusM.mutate({ id: f.id, status: 'REVIEWED' })} disabled={setStatusM.isPending}>Mark reviewed</Button>
                  )}
                  {f.status !== 'CLOSED' && (
                    <Button variant="secondary" onClick={() => setStatusM.mutate({ id: f.id, status: 'CLOSED' })} disabled={setStatusM.isPending}>Close</Button>
                  )}
                  {f.status !== 'OPEN' && (
                    <Button variant="secondary" onClick={() => setStatusM.mutate({ id: f.id, status: 'OPEN' })} disabled={setStatusM.isPending}>Reopen</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
