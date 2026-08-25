import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { ChangeRequest } from '../api/types';
import { Badge, Button, Modal } from './ui';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { formatDate, formatIdr } from '../lib/format';

export type CrWithProject = ChangeRequest & { project: { id: string; code: string; name: string } };

// Advisory AI impact analysis for a CR (ephemeral — not persisted). Shape mirrors the server's
// CrImpactSchema.
interface CrImpactDraft {
  scheduleImpact: string;
  costImpact: string;
  riskNarrative: string;
  newRisks: { title: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' }[];
  recommendation: 'APPROVE' | 'REJECT' | 'NEEDS_INFO';
  rationale: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

const REC_BADGE: Record<CrImpactDraft['recommendation'], { color: string; label: string }> = {
  APPROVE: { color: 'green', label: 'Rekomendasi: Setujui' },
  REJECT: { color: 'red', label: 'Rekomendasi: Tolak' },
  NEEDS_INFO: { color: 'amber', label: 'Rekomendasi: Perlu info' },
};
const SEVERITY_COLOR: Record<CrImpactDraft['newRisks'][number]['severity'], string> = { LOW: 'slate', MEDIUM: 'amber', HIGH: 'red' };

const STATUS_BADGE: Record<string, string> = { SUBMITTED: 'amber', UNDER_REVIEW: 'sky', APPROVED: 'green', REJECTED: 'red' };
const dt = (s: string | null) => (s ? `${formatDate(s)} · ${new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : null);

function Step({ label, by, at, active, tone }: { label: string; by?: string | null; at: string | null; active: boolean; tone?: string }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${active ? (tone ?? 'bg-brand-500') : 'bg-slate-200 dark:bg-slate-700'}`}>
        {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <div>
        <div className={`text-sm ${active ? 'font-medium text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>{label}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{at ? `${dt(at)}${by ? ` · ${by}` : ''}` : 'Pending'}</div>
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
  const isDecider = !!user && ['ADMIN', 'PMO'].includes(user.role);

  const paidAmount = cr.chargeable && cr.amountIdr != null && Number(cr.amountIdr) > 0 ? Number(cr.amountIdr) : 0;

  // AI impact analysis (advisory) — only surfaced to deciders when AI is available (env + tenant).
  const aiQ = useQuery({
    queryKey: ['ai-available', cr.project.id],
    queryFn: () => api.get<{ aiAvailable: boolean }>(`/projects/${cr.project.id}/ai-available`),
    enabled: isDecider,
    staleTime: 5 * 60_000,
  });
  const impact = useMutation({
    mutationFn: () => api.post<CrImpactDraft>(`/projects/${cr.project.id}/charter/change-requests/${cr.id}/impact/ai-draft`),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'AI tidak dapat membuat analisa dampak'),
  });
  const draft = impact.data;

  const decide = useMutation({
    mutationFn: (vars: { decision: 'APPROVED' | 'REJECTED'; applyToRevenue?: boolean }) =>
      api.patch(`/projects/${cr.project.id}/charter/change-requests/${cr.id}`, vars),
    onSuccess: (_d, vars) => {
      ['pending-approvals', 'charter-crs', 'charter-versions', 'notifications', 'inbox', 'projects', 'portfolio', 'charter'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`Change request ${vars.decision === 'APPROVED' ? 'approved' : 'rejected'}${vars.applyToRevenue ? ` · +${formatIdr(paidAmount)} revenue` : ''}`);
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to decide'),
  });

  const approve = async () => {
    if (paidAmount > 0) {
      const ok = await confirm({
        title: 'Approve chargeable change?',
        message: <>This chargeable change is <strong>{formatIdr(paidAmount)}</strong>. Approving will add it to the project&rsquo;s <strong>Total Revenue</strong> (a client-funded change order).</>,
        confirmLabel: 'Approve & add to revenue',
      });
      if (ok) decide.mutate({ decision: 'APPROVED', applyToRevenue: true });
    } else {
      decide.mutate({ decision: 'APPROVED' });
    }
  };

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
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono">{cr.project.code}</span> · {cr.project.name}
          </div>
          {cr.chargeable && (
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Amount: <span className="font-semibold text-slate-800 dark:text-slate-100">{cr.amountIdr != null ? formatIdr(cr.amountIdr) : '—'}</span>
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Description</div>
          <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{cr.description}</p>
        </div>

        {cr.impactAreas.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Impact areas</div>
            <div className="flex flex-wrap gap-1.5">
              {cr.impactAreas.map((a) => <Badge key={a} color="slate">{a}</Badge>)}
            </div>
          </div>
        )}

        {isDecider && aiQ.data?.aiAvailable && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900/50 dark:bg-violet-900/15">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase text-violet-700 dark:text-violet-300">Analisa dampak (AI)</div>
              <Button variant="secondary" className="!py-1 text-xs" disabled={impact.isPending} onClick={() => impact.mutate()}>
                {impact.isPending ? 'Menganalisa…' : draft ? '↻ Analisa ulang' : '✨ Analisa dampak dengan AI'}
              </Button>
            </div>
            {draft ? (
              <div className="mt-3 space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={REC_BADGE[draft.recommendation].color}>{REC_BADGE[draft.recommendation].label}</Badge>
                  <Badge color="slate">Keyakinan: {draft.confidence}</Badge>
                </div>
                <p className="text-slate-600 dark:text-slate-300">{draft.rationale}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-0.5 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Dampak jadwal</div>
                    <p className="text-slate-600 dark:text-slate-300">{draft.scheduleImpact}</p>
                  </div>
                  <div>
                    <div className="mb-0.5 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Dampak biaya</div>
                    <p className="text-slate-600 dark:text-slate-300">{draft.costImpact}</p>
                  </div>
                </div>
                <div>
                  <div className="mb-0.5 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Risiko</div>
                  <p className="text-slate-600 dark:text-slate-300">{draft.riskNarrative}</p>
                  {draft.newRisks.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {draft.newRisks.map((rk, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs">
                          <Badge color={SEVERITY_COLOR[rk.severity]}>{rk.severity}</Badge>
                          <span className="text-slate-600 dark:text-slate-300">{rk.title}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="text-[11px] italic text-slate-400 dark:text-slate-500">Hasil AI bersifat masukan — keputusan tetap di tangan Anda.</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Perkirakan dampak jadwal, biaya, dan risiko dari CR ini terhadap baseline &amp; EVM saat ini.</p>
            )}
          </div>
        )}

        <div>
          <div className="mb-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Lifecycle</div>
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
                  if (await confirm({ title: 'Reject change request?', message: <>Reject <strong>{cr.title}</strong>?</>, confirmLabel: 'Reject', danger: true })) decide.mutate({ decision: 'REJECTED' });
                }}
              >
                Reject
              </Button>
              <Button disabled={decide.isPending} onClick={approve}>Approve</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
