import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { Button, Modal, Textarea } from './ui';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';

// Cost/schedule baseline (PMB/BAC) freeze control. When locked, cost lines, management
// reserve, WBS tasks and the schedule baseline can't change — progress/actuals and risks
// still can. ADMIN/PMO lock/unlock; unlocking requires a reason (audited).
export default function BaselineLock({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [reason, setReason] = useState('');

  const { data } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<{ project: Project }>(`/projects/${projectId}`),
  });
  const locked = !!data?.project?.baselineLockedAt;
  const canManage = !!user && ['ADMIN', 'PMO'].includes(user.role);

  const toggle = useMutation({
    mutationFn: (body: { locked: boolean; reason?: string }) => api.patch(`/projects/${projectId}/baseline-lock`, body),
    onSuccess: (_d, body) => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success(body.locked ? 'Baseline locked' : 'Baseline unlocked');
      setUnlockOpen(false);
      setReason('');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update baseline lock'),
  });

  return (
    <>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          locked
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
        }`}
        title={locked ? 'Cost lines, WBS and the schedule baseline are frozen' : 'Baseline is editable'}
      >
        {locked ? '🔒 Baseline locked' : '🔓 Baseline editable'}
      </span>
      {canManage && (
        <Button
          variant="secondary"
          className="!py-1 text-xs"
          disabled={toggle.isPending}
          onClick={() => (locked ? setUnlockOpen(true) : toggle.mutate({ locked: true }))}
        >
          {locked ? 'Unlock' : 'Lock baseline'}
        </Button>
      )}

      {unlockOpen && (
        <Modal onClose={() => setUnlockOpen(false)} title="Unlock the baseline">
          <div className="space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Unlocking re-opens the cost &amp; schedule baseline (PMB/BAC) for changes. This is a governance
              decision — provide a reason (recorded in the audit trail). Re-lock once the change is applied.
            </p>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Reason for unlocking (required)
              </label>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Approved change request CR-014: added scope for the reporting module." />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" onClick={() => setUnlockOpen(false)}>Cancel</Button>
              <Button className="flex-1" disabled={!reason.trim() || toggle.isPending} onClick={() => toggle.mutate({ locked: false, reason: reason.trim() })}>
                {toggle.isPending ? 'Saving…' : 'Unlock'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
