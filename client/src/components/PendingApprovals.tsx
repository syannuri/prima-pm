import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { PendingApproval } from '../api/types';
import { Badge, Button, Card } from './ui';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { formatDate, formatIdr } from '../lib/format';
import CrDetailModal from './CrDetailModal';

// PMO/Admin dashboard panel: change requests awaiting a decision, with inline
// Approve/Reject. Only rendered (for approvers) when something is pending.
export default function PendingApprovals() {
  const { user } = useAuth();
  const isApprover = !!user && ['ADMIN', 'PMO'].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [detail, setDetail] = useState<PendingApproval | null>(null);

  const { data } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: () => api.get<{ items: PendingApproval[]; count: number }>('/notifications/pending-approvals'),
    enabled: isApprover,
    refetchInterval: 60_000,
  });

  // Opening the detail marks the CR "under review" (records who/when).
  const review = useMutation({
    mutationFn: (cr: PendingApproval) => api.patch(`/projects/${cr.project.id}/charter/change-requests/${cr.id}/review`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pending-approvals'] }),
  });
  const openReview = (cr: PendingApproval) => { setDetail(cr); if (cr.status === 'SUBMITTED') review.mutate(cr); };

  const decide = useMutation({
    mutationFn: ({ cr, decision, applyToRevenue }: { cr: PendingApproval; decision: 'APPROVED' | 'REJECTED'; applyToRevenue?: boolean }) =>
      api.patch(`/projects/${cr.project.id}/charter/change-requests/${cr.id}`, { decision, applyToRevenue }),
    onSuccess: (_d, v) => {
      ['pending-approvals', 'charter-crs', 'notifications', 'inbox', 'projects', 'portfolio', 'charter'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      toast.success(`Change request ${v.decision === 'APPROVED' ? 'approved' : 'rejected'}${v.applyToRevenue ? ' · revenue updated' : ''}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to decide'),
  });

  // A chargeable CR carrying an agreed amount → confirm adding it to Total Revenue.
  const approve = async (cr: PendingApproval) => {
    const amt = cr.chargeable && cr.amountIdr != null && Number(cr.amountIdr) > 0 ? Number(cr.amountIdr) : 0;
    if (amt > 0) {
      if (await confirm({ title: 'Approve chargeable change?', message: <>This chargeable change is <strong>{formatIdr(amt)}</strong>. Approving will add it to <strong>{cr.project.code}</strong>&rsquo;s Total Revenue.</>, confirmLabel: 'Approve & add to revenue' }))
        decide.mutate({ cr, decision: 'APPROVED', applyToRevenue: true });
    } else {
      decide.mutate({ cr, decision: 'APPROVED' });
    }
  };

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
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
                <Link to={`/projects/${cr.project.id}`} className="font-mono hover:underline">{cr.project.code}</Link>
                <span className="truncate">{cr.project.name}</span>
                <span>· by {cr.requester?.name ?? '—'}</span>
                <span>· {formatDate(cr.createdAt)}</span>
                {cr.impactAreas.length > 0 && <span>· impact: {cr.impactAreas.join(', ')}</span>}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" onClick={() => openReview(cr)}>Review</Button>
              <Button
                onClick={() => approve(cr)}
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
      {detail && <CrDetailModal cr={detail} onClose={() => setDetail(null)} />}
    </Card>
  );
}
