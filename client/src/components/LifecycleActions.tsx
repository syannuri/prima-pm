import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { Button, Modal, Textarea } from './ui';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';
import { canGovernProject } from '../lib/perms';
import ActivateModal from './ActivateModal';

// Which manual lifecycle transitions are legal from a given status. Exported so a host (e.g. the
// Schedule focus-mode menu) can render the same moves as menu items without duplicating the policy.
export function legalLifecycle(status: Project['status']) {
  return {
    canActivate: status === 'CHARTERED',
    canResume: status === 'ON_HOLD',
    canHold: status === 'CHARTERED' || status === 'IN_PROGRESS',
    canReopen: status === 'CLOSED',
  };
}

// The modal/action a controlled parent can drive. 'resume' is modal-less (a direct transition fired
// in an effect); 'activate' opens the guided ActivateModal (guests only — governors use onReview).
export type LifecycleModal = null | 'hold' | 'reopen' | 'resume' | 'activate';

// Manual lifecycle transitions (ADMIN/PMO): Activate (→IN_PROGRESS), Put on hold
// (→ON_HOLD, reason required), Resume (→IN_PROGRESS). DRAFT→CHARTERED happens via
// charter commit; CLOSED is handled by CloseProjectModal. The backend state-machine
// (STATUS_TRANSITIONS) is the source of truth — this just exposes the legal moves.
//
// Two modes:
//  • Default (uncontrolled): renders its own trigger buttons + owns the modal state — the normal
//    project header on every tab.
//  • Controlled host (renderTriggers=false + modal/onModalChange): renders NO buttons, only the
//    modals + mutation, driven by the parent. The parent renders the triggers as menu items and
//    mounts this host OUTSIDE the auto-closing overflow menu (which unmounts its children on click).
export default function LifecycleActions({
  project, onReview, renderTriggers = true, modal: modalProp, onModalChange,
}: {
  project: Project;
  onReview?: () => void;
  renderTriggers?: boolean;
  modal?: LifecycleModal;
  onModalChange?: (m: LifecycleModal) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const controlled = onModalChange !== undefined;
  const [internalModal, setInternalModal] = useState<LifecycleModal>(null);
  const modal = controlled ? (modalProp ?? null) : internalModal;
  const setModal = (m: LifecycleModal) => { if (controlled) onModalChange!(m); else setInternalModal(m); };
  const [reason, setReason] = useState('');

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

  // Controlled 'resume' is a modal-less transition — fire it once when the parent requests it.
  // (Resume carries no reason, so there's no modal to show.)
  useEffect(() => {
    if (modal === 'resume' && !change.isPending) change.mutate({ status: 'IN_PROGRESS' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

  // Clear the reason box each time the hold/reopen modal opens (covers the controlled path, where the
  // parent's menu item opens it without going through the local trigger).
  useEffect(() => {
    if (modal === 'hold' || modal === 'reopen') setReason('');
  }, [modal]);

  if (!canManage) return null;

  const { canActivate, canResume, canHold, canReopen } = legalLifecycle(project.status);
  if (!canActivate && !canResume && !canHold && !canReopen) return null;

  const isReopen = modal === 'reopen';
  const submit = () =>
    change.mutate(isReopen ? { status: 'IN_PROGRESS', reopenReason: reason.trim() } : { status: 'ON_HOLD', holdReason: reason.trim() });
  // Guided ActivateModal shows when activation is requested and no onReview handler is wired (guests).
  const activateOpen = modal === 'activate' && !onReview;

  return (
    <>
      {renderTriggers && (
        <>
          {canActivate && (
            <Button variant="secondary" data-tour="activate" onClick={onReview ?? (() => setModal('activate'))}>
              ▶ Activate
            </Button>
          )}
          {canResume && (
            <Button variant="secondary" disabled={change.isPending} onClick={() => change.mutate({ status: 'IN_PROGRESS' })}>
              ▶ Resume
            </Button>
          )}
          {canHold && (
            <Button variant="secondary" onClick={() => setModal('hold')}>⏸ Put on hold</Button>
          )}
          {canReopen && (
            <Button variant="secondary" onClick={() => setModal('reopen')}>↩ Reopen</Button>
          )}
        </>
      )}

      {/* Fallback plain activate modal when no review handler is wired (kept for safety / guests). */}
      {activateOpen && <ActivateModal project={project} onClose={() => setModal(null)} />}

      {(modal === 'hold' || modal === 'reopen') && (
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
