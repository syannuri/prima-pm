import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { ClosureItem, ClosureReadiness, Project } from '../api/types';
import { Button, Modal, Spinner, Textarea } from './ui';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';

// Only these lifecycle states can be closed (DRAFT must be chartered first; CLOSED is terminal).
const CLOSEABLE = ['CHARTERED', 'IN_PROGRESS', 'ON_HOLD'];

function CheckRow({ item }: { item: ClosureItem }) {
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

// Guided project closure: shows a readiness checklist (schedule-completeness is the
// only hard blocker; the rest are advisory). ADMIN/PMO can force-close past a blocker
// with a mandatory reason. See server closure.ts for the policy.
export default function CloseProjectModal({ project }: { project: Project }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  const canManage = !!user && ['ADMIN', 'PMO'].includes(user.role);
  const closeable = CLOSEABLE.includes(project.status);

  const { data, isLoading } = useQuery({
    queryKey: ['closure-readiness', project.id],
    queryFn: () =>
      api.get<{ readiness: ClosureReadiness }>(`/projects/${project.id}/closure-readiness`).then((r) => r.readiness),
    enabled: open,
  });

  const close = useMutation({
    mutationFn: (force: boolean) =>
      api.patch(`/projects/${project.id}`, {
        status: 'CLOSED',
        forceClose: force || undefined,
        closureNote: note.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      qc.invalidateQueries({ queryKey: ['next-steps', project.id] });
      toast.success('Project closed');
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to close the project'),
  });

  if (!canManage || !closeable) return null;

  const blocked = data ? !data.canClose : false;

  return (
    <>
      <Button variant="secondary" onClick={() => { setNote(''); setOpen(true); }}>Close project</Button>

      {open && (
        <Modal onClose={() => setOpen(false)} title="Close project" size="lg">
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Closing <strong className="text-slate-700 dark:text-slate-200">{project.name}</strong> is final — a closed
              project can’t be reopened. Review the closure readiness below.
            </p>

            {isLoading || !data ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Closure readiness</div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.items.map((it) => <CheckRow key={it.key} item={it} />)}
                  </div>
                </div>

                {blocked && (
                  <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
                    This project isn’t ready to close. You can resolve the required item(s) above, or <strong>force-close</strong> with a reason (recorded in the audit trail).
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {blocked ? 'Reason for force-closing (required)' : 'Closure note (optional)'}
                  </label>
                  <Textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={blocked ? 'e.g. Project cancelled by sponsor; remaining scope descoped.' : 'e.g. All deliverables accepted; lessons learned filed.'}
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
                  {blocked ? (
                    <Button
                      variant="danger"
                      className="flex-1"
                      disabled={!note.trim() || close.isPending}
                      onClick={() => close.mutate(true)}
                    >
                      {close.isPending ? 'Closing…' : 'Force close'}
                    </Button>
                  ) : (
                    <Button className="flex-1" disabled={close.isPending} onClick={() => close.mutate(false)}>
                      {close.isPending ? 'Closing…' : 'Close project'}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
