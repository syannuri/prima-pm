import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { ActivationItem, ActivationReview } from '../api/types';
import { Button, FormError, Modal, PanelLoading, Textarea } from './ui';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';
import { formatIdr } from '../lib/format';

function CheckRow({ item }: { item: ActivationItem }) {
  const mark = item.ok ? '✓' : item.severity === 'block' ? '✗' : '!';
  const tone = item.ok
    ? 'text-green-600 dark:text-green-400'
    : item.severity === 'block'
      ? 'text-red-600 dark:text-red-400'
      : 'text-amber-600 dark:text-amber-400';
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className={`mt-0.5 w-4 shrink-0 text-center font-bold ${tone}`}>{mark}</span>
      <span className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">{item.label}
        {!item.ok && item.detail && <span className={`ml-2 text-xs ${tone}`}>· {item.detail}</span>}
      </span>
      {!item.ok && (
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${item.severity === 'block' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
          {item.severity === 'block' ? 'Required' : 'Warning'}
        </span>
      )}
    </div>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span aria-hidden>{icon}</span> {title}
      </div>
      {children}
    </div>
  );
}

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// PMO activation review card: at-a-glance Scope (Charter) · Budget (Cost Baseline) · Schedule
// (WBS), the baseline-readiness checklist, and a governed decision — Approve (activate),
// Request revision, or Reject (both send the project back to the PM with a note).
export default function ActivationReviewModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const canDecide = user?.role === 'ADMIN' || user?.role === 'PMO';

  const { data, isLoading } = useQuery({
    queryKey: ['activation-review', projectId],
    queryFn: () => api.get<{ review: ActivationReview }>(`/projects/${projectId}/activation-review`).then((r) => r.review),
  });

  const decide = useMutation({
    mutationFn: (body: { decision: 'APPROVE' | 'REJECT' | 'NEEDS_REVISION'; reason?: string; force?: boolean }) =>
      api.post(`/projects/${projectId}/activation/decide`, body),
    onSuccess: (_d, body) => {
      ['project', 'projects', 'portfolio', 'inbox', 'awaiting-activation', 'next-steps'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success(body.decision === 'APPROVE' ? 'Project activated' : body.decision === 'REJECT' ? 'Activation rejected' : 'Sent back for revision');
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not record the decision'),
  });

  const canActivate = data?.readiness.canActivate ?? false;
  const needReason = !reason.trim();

  return (
    <Modal onClose={onClose} title="Review & activate" size="lg">
      {isLoading || !data ? (
        <PanelLoading className="py-10" />
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-mono text-sm text-slate-500 dark:text-slate-400">{data.project.code}</span>
              <h3 className="min-w-0 break-words text-base font-semibold text-slate-800 dark:text-slate-100">{data.project.name}</h3>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Review the committed plan, then approve to start execution or send it back to the PM.</p>
          </div>

          {data.review.status && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/25 dark:text-amber-200">
              Currently <strong>{data.review.status === 'REJECTED' ? 'rejected' : 'awaiting revision'}</strong>
              {data.review.by && <> · by {data.review.by}</>}{data.review.note && <> — “{data.review.note}”</>}
            </div>
          )}

          {/* Scope of Work — Charter */}
          <Section icon="📋" title="Scope of Work · Charter">
            {data.charter ? (
              <dl className="space-y-2 text-sm">
                <div><dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Scope</dt><dd className="break-words text-slate-700 dark:text-slate-200">{data.charter.scope || '—'}</dd></div>
                <div><dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Deliverables</dt><dd className="break-words text-slate-700 dark:text-slate-200">{data.charter.deliverables || '—'}</dd></div>
                <div><dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Goals</dt><dd className="break-words text-slate-700 dark:text-slate-200">{data.charter.goals || '—'}</dd></div>
              </dl>
            ) : <p className="text-sm text-slate-500 dark:text-slate-400">No committed charter.</p>}
          </Section>

          {/* Budget — Cost Baseline */}
          <Section icon="💰" title="Budget · Cost Baseline">
            {data.budget ? (
              <div className="space-y-1 text-sm tabular-nums">
                {([['Direct', data.budget.direct], ['Indirect', data.budget.indirect], ['Contingency reserve', data.budget.contingency]] as const).map(([l, v]) => (
                  <div key={l} className="flex justify-between text-slate-600 dark:text-slate-300"><span>{l}</span><span>{formatIdr(v)}</span></div>
                ))}
                <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900 dark:border-slate-700 dark:text-white"><span>BAC (PMB)</span><span>{formatIdr(data.budget.bac)}</span></div>
                {data.budget.managementReserve > 0 && (
                  <>
                    <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>+ Management reserve</span><span>{formatIdr(data.budget.managementReserve)}</span></div>
                    <div className="flex justify-between font-semibold text-slate-900 dark:text-white"><span>Total budget</span><span>{formatIdr(data.budget.totalBudget)}</span></div>
                  </>
                )}
              </div>
            ) : <p className="text-sm text-slate-500 dark:text-slate-400">No cost baseline set.</p>}
          </Section>

          {/* Schedule — WBS / Agile */}
          <Section icon="📆" title="Schedule">
            {data.schedule.hasWbs ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <div className="text-slate-500 dark:text-slate-400">Timeline</div><div className="text-right text-slate-700 dark:text-slate-200">{fmtDate(data.schedule.start)} → {fmtDate(data.schedule.end)}</div>
                <div className="text-slate-500 dark:text-slate-400">Duration</div><div className="text-right tabular-nums text-slate-700 dark:text-slate-200">{data.schedule.durationDays ?? '—'} days</div>
                <div className="text-slate-500 dark:text-slate-400">Tasks · milestones</div><div className="text-right tabular-nums text-slate-700 dark:text-slate-200">{data.schedule.taskCount} · {data.schedule.milestoneCount}</div>
                <div className="text-slate-500 dark:text-slate-400">Baseline</div><div className="text-right text-slate-700 dark:text-slate-200">{data.schedule.scheduleBaselinedAt ? `captured ${fmtDate(data.schedule.scheduleBaselinedAt)}` : 'not captured'}</div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <div className="text-slate-500 dark:text-slate-400">Approach</div><div className="text-right text-slate-700 dark:text-slate-200">{data.schedule.deliveryApproach} — planned via sprints</div>
                <div className="text-slate-500 dark:text-slate-400">Sprints · backlog</div><div className="text-right tabular-nums text-slate-700 dark:text-slate-200">{data.schedule.sprintCount} · {data.schedule.backlogCount}</div>
              </div>
            )}
          </Section>

          {/* Baseline readiness checklist */}
          <Section icon="✅" title="Baseline readiness">
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.readiness.items.map((it) => <CheckRow key={it.key} item={it} />)}
            </div>
          </Section>

          {canDecide ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Note {canActivate ? '(required to reject / request revision, or to force-activate)' : '(required)'}
                </label>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Tighten the scope on integration testing and re-baseline the schedule." />
              </div>
              {!canActivate && (
                <FormError>Baselines aren’t all set. You can still <strong>force-activate</strong> with a reason, or send it back to the PM.</FormError>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <span className="flex-1" />
                <Button variant="danger" disabled={needReason || decide.isPending} onClick={() => decide.mutate({ decision: 'REJECT', reason })}>Reject</Button>
                <Button variant="secondary" disabled={needReason || decide.isPending} onClick={() => decide.mutate({ decision: 'NEEDS_REVISION', reason })}>Request revision</Button>
                {canActivate ? (
                  <Button disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'APPROVE' })}>Approve &amp; activate</Button>
                ) : (
                  <Button variant="danger" disabled={needReason || decide.isPending} onClick={() => decide.mutate({ decision: 'APPROVE', force: true, reason })}>Force activate</Button>
                )}
              </div>
            </>
          ) : (
            <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
          )}
        </div>
      )}
    </Modal>
  );
}
