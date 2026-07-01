import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { ChangeRequest } from '../api/types';
import { Badge, Button, Modal } from './ui';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { formatDate, formatIdr } from '../lib/format';

export type CrWithProject = ChangeRequest & { project: { id: string; code: string; name: string } };

const STATUS_BADGE: Record<string, string> = { SUBMITTED: 'amber', UNDER_REVIEW: 'sky', APPROVED: 'green', REJECTED: 'red' };
const dt = (s: string | null) => (s ? `${formatDate(s)} · ${new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : null);

function Step({ label, by, at, active, tone }: { label: string; by?: string | null; at: string | null; active: boolean; tone?: string }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${active ? (tone ?? 'bg-brand-500') : 'bg-slate-200 dark:bg-slate-700'}`}>
        {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <div>
        <div className={`text-sm ${active ? 'font-medium text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>{label}</div>
        <div className="text-xs text-slate-400 dark:text-slate-500">{at ? `${dt(at)}${by ? ` · ${by}` : ''}` : 'Pending'}</div>
      </div>
    </li>
  );
}

export default function CrDetailModal({ cr, onClose }: { cr: CrWithProject; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const canDecide = !!user && ['ADMIN', 'PMO'].includes(user.role) && (cr.status === 'SUBMITTED' || cr.status === 'UNDER_REVIEW');

  const decide = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED') =>
      api.patch(`/projects/${cr.project.id}/charter/change-requests/${cr.id}`, { decision }),
    onSuccess: (_d, decision) => {
      ['pending-approvals', 'charter-crs', 'charter-versions', 'notifications', 'inbox', 'projects', 'portfolio', 'charter'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`Change request ${decision === 'APPROVED' ? 'approved' : 'rejected'}`);
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to decide'),
  });

  const decisionTone = cr.status === 'REJECTED' ? 'bg-red-500' : cr.status === 'APPROVED' ? 'bg-green-500' : undefined;
  const decisionLabel = cr.status === 'REJECTED' ? 'Rejected' : cr.status === 'APPROVED' ? 'Approved' : 'Decision';

  return (
    <Modal onClose={onClose} title="Change request" size="lg">
      <div className="space-y-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-slate-800 dark:text-slate-100">{cr.title}</span>
            <Badge color={STATUS_BADGE[cr.status] ?? 'slate'}>{cr.status.replace('_', ' ')}</Badge>
            <Badge color={cr.magnitude === 'MAJOR' ? 'red' : 'slate'}>{cr.magnitude}</Badge>
            {cr.chargeable && <Badge color="amber">Chargeable</Badge>}
          </div>
          <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            <span className="font-mono">{cr.project.code}</span> · {cr.project.name}
          </div>
          {cr.chargeable && (
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Amount: <span className="font-semibold text-slate-800 dark:text-slate-100">{cr.amountIdr != null ? formatIdr(cr.amountIdr) : '—'}</span>
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Description</div>
          <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{cr.description}</p>
        </div>

        {cr.impactAreas.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Impact areas</div>
            <div className="flex flex-wrap gap-1.5">
              {cr.impactAreas.map((a) => <Badge key={a} color="slate">{a}</Badge>)}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Lifecycle</div>
          <ol className="space-y-3">
            <Step label="Submitted" by={cr.requester?.name} at={cr.createdAt} active />
            <Step label="Under review" by={cr.reviewer?.name} at={cr.reviewedAt} active={!!cr.reviewedAt} tone="bg-sky-500" />
            <Step label={decisionLabel} by={cr.decider?.name} at={cr.decidedAt} active={!!cr.decidedAt} tone={decisionTone} />
          </ol>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {canDecide && (
            <>
              <Button
                variant="danger"
                disabled={decide.isPending}
                onClick={async () => {
                  if (await confirm({ title: 'Reject change request?', message: <>Reject <strong>{cr.title}</strong>?</>, confirmLabel: 'Reject', danger: true })) decide.mutate('REJECTED');
                }}
              >
                Reject
              </Button>
              <Button disabled={decide.isPending} onClick={() => decide.mutate('APPROVED')}>Approve</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
