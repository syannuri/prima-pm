import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { ApprovalDelegation, MyApproval } from '../api/types';
import { Badge, Button, Card, Field, Input, Select, Spinner, Textarea } from '../components/ui';
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
  // Deep-link from the approval email (…/approvals?focus=<requestId>) — scroll to & flash that row.
  const [params] = useSearchParams();
  const focusId = params.get('focus');

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-12">
      <header className="border-b border-slate-200 pb-4 dark:border-slate-800">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">My approvals</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Change requests, baseline locks and closures waiting on your decision.</p>
      </header>

      <DelegationCard />

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : approvals.length === 0 ? (
        <Card><p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Nothing awaiting your approval. 🎉</p></Card>
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => <ApprovalRow key={a.id} a={a} focused={a.id === focusId} />)}
        </div>
      )}
    </div>
  );
}

// "While I'm away, X approves on my behalf." One active delegation per user.
function DelegationCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [toUserId, setToUserId] = useState('');
  const [until, setUntil] = useState('');

  const delQ = useQuery({ queryKey: ['my-delegation'], queryFn: () => api.get<{ delegation: ApprovalDelegation | null }>('/approvals/delegation') });
  const membersQ = useQuery({ queryKey: ['approval-members'], queryFn: () => api.get<{ members: { id: string; name: string; email: string }[] }>('/approvals/members') });
  const current = delQ.data?.delegation ?? null;

  const save = useMutation({
    mutationFn: () => api.put('/approvals/delegation', { toUserId, expiresAt: until ? new Date(until).toISOString() : null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-delegation'] }); toast.success('Delegation set'); setToUserId(''); setUntil(''); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not set delegation'),
  });
  const clear = useMutation({
    mutationFn: () => api.del('/approvals/delegation'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-delegation'] }); toast.success('Delegation cleared'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not clear delegation'),
  });

  const members = membersQ.data?.members ?? [];

  return (
    <Card className="space-y-3">
      <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Delegate my approvals</div>
      {current ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
          <span className="text-slate-600 dark:text-slate-300">
            Delegated to <span className="font-medium">{current.toUser?.name ?? 'a user'}</span>
            {current.expiresAt ? ` until ${formatDate(current.expiresAt)}` : ' (until revoked)'}. They can approve on your behalf.
          </span>
          <Button type="button" variant="ghost" onClick={() => clear.mutate()} disabled={clear.isPending}>Clear</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <Field label="Delegate to">
              <Select value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
                <option value="">Choose a person…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="w-44">
            <Field label="Until" hint="optional"><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
          </div>
          <Button type="button" onClick={() => save.mutate()} disabled={!toUserId || save.isPending}>{save.isPending ? 'Saving…' : 'Delegate'}</Button>
        </div>
      )}
    </Card>
  );
}

function ApprovalRow({ a, focused = false }: { a: MyApproval; focused?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [comment, setComment] = useState('');
  // When arrived via ?focus=<id> (from the approval email), scroll this row into view and flash a
  // ring for a couple of seconds so it's obvious which item the email was about.
  const ref = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!focused || !ref.current) return;
    ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 2500);
    return () => clearTimeout(t);
  }, [focused]);
  const cr = a.changeRequest;
  // Final approver of a chargeable CR can add its agreed amount to project revenue (mirrors the
  // legacy single-decider option). Only offered on the LAST step so it's applied once, at sign-off.
  const isFinalStep = a.stepOrder >= a.totalSteps;
  const showApplyRevenue = !!cr?.chargeable && cr.amountIdr != null && isFinalStep;
  const [applyToRevenue, setApplyToRevenue] = useState(false);

  const decide = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED') => api.post(`/approvals/${a.id}/decide`, {
      decision,
      comment: comment.trim() || null,
      applyToRevenue: showApplyRevenue && decision === 'APPROVED' ? applyToRevenue : undefined,
    }),
    onSuccess: (_r, decision) => {
      qc.invalidateQueries({ queryKey: ['my-approvals'] });
      qc.invalidateQueries({ queryKey: ['my-approvals-count'] });
      toast.success(decision === 'APPROVED' ? 'Approved' : 'Rejected');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not record your decision'),
  });

  return (
    <div ref={ref} className={`rounded-2xl transition-shadow duration-500 ${flash ? 'ring-2 ring-brand-400 ring-offset-2 ring-offset-white dark:ring-offset-slate-900' : ''}`}>
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{cr?.title ?? a.actionLabel}</span>
            {cr?.magnitude === 'MAJOR' && <Badge color="amber">Major</Badge>}
            {cr?.chargeable && <Badge color="blue">Chargeable</Badge>}
            {a.aiAction && <Badge color="violet">🤖 AI action</Badge>}
            {!cr && !a.aiAction && <Badge color="violet">{a.actionLabel}</Badge>}
          </div>
          {a.project && (
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              <Link to={`/projects/${a.project.id}`} className="hover:underline">{a.project.name}{a.project.code ? ` (${a.project.code})` : ''}</Link>
              <span className="text-slate-400"> · raised {formatDate(a.createdAt)}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge color="slate">Step {a.stepOrder}/{a.totalSteps} · {a.stepName}</Badge>
          {a.dueAt && <Badge color={new Date(a.dueAt) < new Date() ? 'red' : 'amber'}>{new Date(a.dueAt) < new Date() ? 'Overdue' : 'Due'} {formatDate(a.dueAt)}</Badge>}
        </div>
      </div>

      {cr?.description && <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{cr.description}</p>}
      {a.aiAction && (
        <p className="whitespace-pre-wrap rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800 dark:bg-violet-500/10 dark:text-violet-200">
          Proposed by AI — runs only if you approve.{a.aiAction.rationale ? <> Rationale: {a.aiAction.rationale}</> : null}
        </p>
      )}
      {!cr && !a.aiAction && a.reason && <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">Reason: {a.reason}</p>}
      {cr?.chargeable && cr.amountIdr != null && (
        <p className="text-sm text-slate-600 dark:text-slate-300">Amount: <span className="font-medium">Rp {cr.amountIdr.toLocaleString('id-ID')}</span></p>
      )}

      <div className="text-xs text-slate-400">{a.mode === 'ALL' ? 'This step needs every listed approver.' : 'Any one approver clears this step.'}</div>

      {a.alreadyVoted ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">You have already decided on this step — waiting on the other approver(s).</p>
      ) : (
        <>
          {showApplyRevenue && (
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={applyToRevenue} onChange={(e) => setApplyToRevenue(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              On approval, add Rp {cr!.amountIdr!.toLocaleString('id-ID')} to project Total Revenue
            </label>
          )}
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment…" rows={2} maxLength={500} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="danger" onClick={() => decide.mutate('REJECTED')} disabled={decide.isPending}>Reject</Button>
            <Button type="button" onClick={() => decide.mutate('APPROVED')} disabled={decide.isPending}>{decide.isPending ? 'Saving…' : 'Approve'}</Button>
          </div>
        </>
      )}
    </Card>
    </div>
  );
}
