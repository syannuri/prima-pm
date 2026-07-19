import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { Button, Modal, Textarea } from './ui';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';
import { canGovernProject } from '../lib/perms';
import ActivateModal from './ActivateModal';

// Manual lifecycle transitions (ADMIN/PMO): Activate (→IN_PROGRESS), Put on hold
// (→ON_HOLD, reason required), Resume (→IN_PROGRESS). DRAFT→CHARTERED happens via
// charter commit; CLOSED is handled by CloseProjectModal. The backend state-machine
// (STATUS_TRANSITIONS) is the source of truth — this just exposes the legal moves.
export default function LifecycleActions({ project, onReview }: { project: Project; onReview?: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  // Reason-required modal, shared by "hold" and "reopen".
  const [modal, setModal] = useState<null | 'hold' | 'reopen'>(null);
  const [reason, setReason] = useState('');
  // Activation goes through a guided modal (baseline-readiness checklist).
  const [activating, setActivating] = useState(false);

  const canManage = canGovernProject(user, project);

  const change = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/projects/${project.id}`, body),
    onSuccess: (_d, body) => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      qc.invalidateQueries({ queryKey: ['next-steps', project.id] });
      toast.success(
        body.status === 'ON_HOLD' ? 'Project put on hold'
          : body.reopenReason ? 'Project reopened'
          : body.status === 'IN_PROGRESS' ? 'Project active'
          : 'Status updated',
      );
      setModal(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update status'),
  });

  if (!canManage) return null;

  const s = project.status;
  const canActivate = s === 'CHARTERED';
  const canResume = s === 'ON_HOLD';
  const canHold = s === 'CHARTERED' || s === 'IN_PROGRESS';
  const canReopen = s === 'CLOSED';

  if (!canActivate && !canResume && !canHold && !canReopen) return null;

  const isReopen = modal === 'reopen';
  const submit = () =>
    change.mutate(isReopen ? { status: 'IN_PROGRESS', reopenReason: reason.trim() } : { status: 'ON_HOLD', holdReason: reason.trim() });

  return (
    <>
      {canActivate && (
        <Button variant="secondary" onClick={onReview ?? (() => setActivating(true))}>
          ▶ Activate
        </Button>
      )}
      {/* Fallback plain activate modal when no review handler is wired (kept for safety). */}
      {activating && !onReview && <ActivateModal project={project} onClose={() => setActivating(false)} />}
      {canResume && (
        <Button variant="secondary" disabled={change.isPending} onClick={() => change.mutate({ status: 'IN_PROGRESS' })}>
          ▶ Resume
        </Button>
      )}
      {canHold && (
        <Button variant="secondary" onClick={() => { setReason(''); setModal('hold'); }}>⏸ Put on hold</Button>
      )}
      {canReopen && (
        <Button variant="secondary" onClick={() => { setReason(''); setModal('reopen'); }}>↩ Reopen</Button>
      )}

      {modal && (
        <Modal onClose={() => setModal(null)} title={isReopen ? 'Reopen closed project' : 'Put project on hold'}>
          <div className="space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {isReopen ? (
                <>Reopens <strong className="text-slate-700 dark:text-slate-200">{project.name}</strong> back to execution so its
                  data can be edited again. A reason is required and recorded in the audit trail.</>
              ) : (
                <>Suspends <strong className="text-slate-700 dark:text-slate-200">{project.name}</strong>. A reason is
                  required and recorded in the audit trail; you can resume it any time.</>
              )}
            </p>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {isReopen ? 'Reason for reopening (required)' : 'Reason for hold (required)'}
              </label>
              <Textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={isReopen ? 'e.g. Client raised a warranty defect; reopening to log the fix.' : 'e.g. Awaiting client budget approval; paused until Q4.'}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" onClick={() => setModal(null)}>Cancel</Button>
              <Button className="flex-1" disabled={!reason.trim() || change.isPending} onClick={submit}>
                {change.isPending ? 'Saving…' : isReopen ? 'Reopen' : 'Put on hold'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
