import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { MyApproval } from '../api/types';
import { Badge, Button, Card, Spinner, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';
import { formatDate } from '../lib/format';

// The signed-in user's pending approvals — Change Requests routed to them by an approval workflow's
// current step. Approve/reject with an optional comment; a reject closes the whole request.
export default function ApprovalsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-approvals'],
    queryFn: () => api.get<{ approvals: MyApproval[] }>('/approvals/mine'),
    refetchInterval: 60_000,
  });
  const approvals = data?.approvals ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-12">
      <header className="border-b border-slate-200 pb-4 dark:border-slate-800">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">My approvals</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Change requests waiting on your decision.</p>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : approvals.length === 0 ? (
        <Card><p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Nothing awaiting your approval. 🎉</p></Card>
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => <ApprovalRow key={a.id} a={a} />)}
        </div>
      )}
    </div>
  );
}

function ApprovalRow({ a }: { a: MyApproval }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const cr = a.changeRequest;

  const decide = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED') => api.post(`/approvals/${a.id}/decide`, { decision, comment: comment.trim() || null }),
    onSuccess: (_r, decision) => {
      qc.invalidateQueries({ queryKey: ['my-approvals'] });
      qc.invalidateQueries({ queryKey: ['my-approvals-count'] });
      toast.success(decision === 'APPROVED' ? 'Approved' : 'Rejected');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not record your decision'),
  });

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{cr?.title ?? 'Change request'}</span>
            {cr?.magnitude === 'MAJOR' && <Badge color="amber">Major</Badge>}
            {cr?.chargeable && <Badge color="blue">Chargeable</Badge>}
          </div>
          {a.project && (
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              <Link to={`/projects/${a.project.id}`} className="hover:underline">{a.project.name}{a.project.code ? ` (${a.project.code})` : ''}</Link>
              <span className="text-slate-400"> · raised {formatDate(a.createdAt)}</span>
            </div>
          )}
        </div>
        <Badge color="slate">Step {a.stepOrder}/{a.totalSteps} · {a.stepName}</Badge>
      </div>

      {cr?.description && <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{cr.description}</p>}
      {cr?.chargeable && cr.amountIdr != null && (
        <p className="text-sm text-slate-600 dark:text-slate-300">Amount: <span className="font-medium">Rp {cr.amountIdr.toLocaleString('id-ID')}</span></p>
      )}

      <div className="text-xs text-slate-400">{a.mode === 'ALL' ? 'This step needs every listed approver.' : 'Any one approver clears this step.'}</div>

      {a.alreadyVoted ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">You have already decided on this step — waiting on the other approver(s).</p>
      ) : (
        <>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment…" rows={2} maxLength={500} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="danger" onClick={() => decide.mutate('REJECTED')} disabled={decide.isPending}>Reject</Button>
            <Button type="button" onClick={() => decide.mutate('APPROVED')} disabled={decide.isPending}>{decide.isPending ? 'Saving…' : 'Approve'}</Button>
          </div>
        </>
      )}
    </Card>
  );
}
