import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { ActivationItem, ActivationReadiness, Project } from '../api/types';
import { Button, Modal, Spinner, Textarea } from './ui';
import { useToast } from './Toast';

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
      <div className="min-w-0 flex-1">
        <span className="text-sm text-slate-700 dark:text-slate-200">{item.label}</span>
        {!item.ok && item.detail && <span className={`ml-2 text-xs ${tone}`}>· {item.detail}</span>}
      </div>
      {!item.ok && (
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${item.severity === 'block' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
          {item.severity === 'block' ? 'Required' : 'Warning'}
        </span>
      )}
    </div>
  );
}

// Guided activation (CHARTERED → IN_PROGRESS): shows the planning-baseline readiness
// checklist (cost baseline locked; schedule baseline captured when there's a WBS).
// ADMIN/PMO can force-activate past a blocker with a mandatory reason. See server
// activation.ts for the policy. Rendered by LifecycleActions for a CHARTERED project.
export default function ActivateModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['activation-readiness', project.id],
    queryFn: () =>
      api.get<{ readiness: ActivationReadiness }>(`/projects/${project.id}/activation-readiness`).then((r) => r.readiness),
  });

  const activate = useMutation({
    mutationFn: (force: boolean) =>
      api.patch(`/projects/${project.id}`, {
        status: 'IN_PROGRESS',
        forceActivate: force || undefined,
        activateReason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      qc.invalidateQueries({ queryKey: ['next-steps', project.id] });
      toast.success('Project active');
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to activate the project'),
  });

  const blocked = data ? !data.canActivate : false;

  return (
    <Modal onClose={onClose} title="Start execution" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Activating <strong className="text-slate-700 dark:text-slate-200">{project.name}</strong> starts execution. Set
          the performance baseline first so schedule &amp; cost variance (SV/SPI/CV/CPI) measure against a frozen plan.
        </p>

        {isLoading || !data ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Baseline readiness</div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.items.map((it) => <CheckRow key={it.key} item={it} />)}
              </div>
            </div>

            {blocked && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
                This project isn’t baselined yet. Set the required item(s) above, or <strong>force-activate</strong> with a reason (recorded in the audit trail).
              </div>
            )}

            {blocked && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Reason for force-activating (required)
                </label>
                <Textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Sponsor approved an early start; baseline to be locked within the week."
                />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
              {blocked ? (
                <Button variant="danger" className="flex-1" disabled={!reason.trim() || activate.isPending} onClick={() => activate.mutate(true)}>
                  {activate.isPending ? 'Starting…' : 'Force activate'}
                </Button>
              ) : (
                <Button className="flex-1" disabled={activate.isPending} onClick={() => activate.mutate(false)}>
                  {activate.isPending ? 'Starting…' : 'Start execution'}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
