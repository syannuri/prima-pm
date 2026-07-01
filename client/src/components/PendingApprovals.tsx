import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { PendingApproval } from '../api/types';
import { Badge, Button, Card } from './ui';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/format';

// PMO/Admin dashboard panel: change requests awaiting a decision, with inline
// Approve/Reject. Only rendered (for approvers) when something is pending.
export default function PendingApprovals() {
  const { user } = useAuth();
  const isApprover = !!user && ['ADMIN', 'PMO'].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const { data } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: () => api.get<{ items: PendingApproval[]; count: number }>('/notifications/pending-approvals'),
    enabled: isApprover,
    refetchInterval: 60_000,
  });

  const decide = useMutation({
    mutationFn: ({ cr, decision }: { cr: PendingApproval; decision: 'APPROVED' | 'REJECTED' }) =>
      api.patch(`/projects/${cr.project.id}/charter/change-requests/${cr.id}`, { decision }),
    onSuccess: (_d, v) => {
      ['pending-approvals', 'charter-crs', 'notifications', 'inbox', 'projects', 'portfolio', 'charter'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      toast.success(`Change request ${v.decision === 'APPROVED' ? 'approved' : 'rejected'}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to decide'),
  });

  if (!isApprover || !data?.count) return null;

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Change requests awaiting approval</span>
        <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-amber-500 px-1 text-xs font-bold text-white">{data.count}</span>
      </div>
      <ul className="space-y-2">
        {data.items.map((cr) => (
          <li key={cr.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-100 p-2.5 dark:border-slate-800">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{cr.title}</span>
                <Badge color={cr.magnitude === 'MAJOR' ? 'red' : 'slate'}>{cr.magnitude}</Badge>
                {cr.chargeable && <Badge color="amber">Chargeable</Badge>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400 dark:text-slate-500">
                <Link to={`/projects/${cr.project.id}`} className="font-mono hover:underline">{cr.project.code}</Link>
                <span className="truncate">{cr.project.name}</span>
                <span>· by {cr.requester?.name ?? '—'}</span>
                <span>· {formatDate(cr.createdAt)}</span>
                {cr.impactAreas.length > 0 && <span>· impact: {cr.impactAreas.join(', ')}</span>}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                onClick={() => decide.mutate({ cr, decision: 'APPROVED' })}
                disabled={decide.isPending}
              >
                Approve
              </Button>
              <Button
                variant="danger"
                disabled={decide.isPending}
                onClick={async () => {
                  if (await confirm({ title: 'Reject change request?', message: <>Reject <strong>{cr.title}</strong> on {cr.project.code}?</>, confirmLabel: 'Reject', danger: true }))
                    decide.mutate({ cr, decision: 'REJECTED' });
                }}
              >
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
