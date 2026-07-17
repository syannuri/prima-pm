import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { Button, Modal, Textarea } from './ui';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';
import { canGovernProject } from '../lib/perms';

// Cost/schedule baseline (PMB/BAC) freeze control. When locked, cost lines, management
// reserve, WBS tasks and the schedule baseline can't change — progress/actuals and risks
// still can. The owning PM (who builds the cost breakdown) + ADMIN/PMO lock/unlock;
// unlocking requires a reason (audited). A PM only ever sees projects they own, so the
// control is safe to show them; the server also enforces ownership.
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
  // Mirror the server ordering guard: a WBS project must capture its schedule baseline before
  // locking (locking freezes it too, so it could never be set afterwards). Shares the WBS query
  // cache key so capturing the baseline in the Schedule tab re-enables this button immediately.
  const scheduleQ = useQuery({
    queryKey: ['gantt', projectId],
    queryFn: () => api.get<{ tree: unknown[]; baselinedAt: string | null }>(`/projects/${projectId}/schedule/gantt`),
  });
  const locked = !!data?.project?.baselineLockedAt;
  const hasWbs = (scheduleQ.data?.tree?.length ?? 0) > 0;
  const needScheduleBaseline = hasWbs && !scheduleQ.data?.baselinedAt;
  // Corporate: ADMIN/PMO or the owning PM. Personal: the guest owner. (Server enforces PM ownership.)
  const canManage = !!data?.project && canGovernProject(user, data.project, ['ADMIN', 'PMO', 'PROJECT_MANAGER']);

  const toggle = useMutation({
    mutationFn: (body: { locked: boolean; reason?: string }) => api.patch(`/projects/${projectId}/baseline-lock`, body),
    onSuccess: (_d, body) => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['next-steps', projectId] });
      // On lock, confirm the baseline is now complete (both baselines for a WBS project).
      toast.success(
        body.locked
          ? (hasWbs ? 'Baseline locked ✓ (2 of 2) — cost + schedule baseline set. Ready to activate.' : 'Baseline locked ✓ — ready to activate.')
          : 'Baseline unlocked',
      );
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
        <span title={!locked && needScheduleBaseline ? 'Capture the schedule baseline (Schedule tab) first — it can’t be set once the baseline is locked.' : undefined}>
          <Button
            data-tour="baseline-lock"
            variant="secondary"
            className="!py-1 text-xs"
            disabled={toggle.isPending || (!locked && needScheduleBaseline)}
            onClick={() => (locked ? setUnlockOpen(true) : toggle.mutate({ locked: true }))}
          >
            {locked ? 'Unlock' : 'Lock baseline'}
          </Button>
        </span>
      )}
      {canManage && !locked && needScheduleBaseline && (
        <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">← capture the schedule baseline first</span>
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
