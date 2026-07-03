import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { Button, Modal, Textarea } from './ui';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';

// Manual lifecycle transitions (ADMIN/PMO): Activate (→IN_PROGRESS), Put on hold
// (→ON_HOLD, reason required), Resume (→IN_PROGRESS). DRAFT→CHARTERED happens via
// charter commit; CLOSED is handled by CloseProjectModal. The backend state-machine
// (STATUS_TRANSITIONS) is the source of truth — this just exposes the legal moves.
export default function LifecycleActions({ project }: { project: Project }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [holdOpen, setHoldOpen] = useState(false);
  const [reason, setReason] = useState('');

  const canManage = !!user && ['ADMIN', 'PMO'].includes(user.role);

  const change = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/projects/${project.id}`, body),
    onSuccess: (_d, body) => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      toast.success(body.status === 'ON_HOLD' ? 'Project put on hold' : body.status === 'IN_PROGRESS' ? 'Project active' : 'Status updated');
      setHoldOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update status'),
  });

  if (!canManage) return null;

  const s = project.status;
  const canActivate = s === 'CHARTERED';
  const canResume = s === 'ON_HOLD';
  const canHold = s === 'CHARTERED' || s === 'IN_PROGRESS';

  if (!canActivate && !canResume && !canHold) return null;

  return (
    <>
      {canActivate && (
        <Button variant="secondary" disabled={change.isPending} onClick={() => change.mutate({ status: 'IN_PROGRESS' })}>
          ▶ Activate
        </Button>
      )}
      {canResume && (
        <Button variant="secondary" disabled={change.isPending} onClick={() => change.mutate({ status: 'IN_PROGRESS' })}>
          ▶ Resume
        </Button>
      )}
      {canHold && (
        <Button variant="secondary" onClick={() => { setReason(''); setHoldOpen(true); }}>⏸ Put on hold</Button>
      )}

      {holdOpen && (
        <Modal onClose={() => setHoldOpen(false)} title="Put project on hold">
          <div className="space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Suspends <strong className="text-slate-700 dark:text-slate-200">{project.name}</strong>. A reason is
              required and recorded in the audit trail; you can resume it any time.
            </p>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Reason for hold (required)
              </label>
              <Textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Awaiting client budget approval; paused until Q4."
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" onClick={() => setHoldOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!reason.trim() || change.isPending}
                onClick={() => change.mutate({ status: 'ON_HOLD', holdReason: reason.trim() })}
              >
                {change.isPending ? 'Saving…' : 'Put on hold'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
