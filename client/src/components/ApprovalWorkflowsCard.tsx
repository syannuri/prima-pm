import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { ApprovalAppliesTo, ApprovalApproverKind, ApprovalWorkflow, Role, TenantMember } from '../api/types';
import { Badge, Button, Card, Field, Input, SectionTitle, Select, Spinner, Toggle } from './ui';
import { useToast } from './Toast';

const ROLES: Role[] = ['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER'];

interface ApproverDraft { kind: ApprovalApproverKind; role: Role | ''; userId: string }
interface StepDraft { name: string; mode: 'ANY' | 'ALL'; slaHours: string; approvers: ApproverDraft[] }
interface FormState {
  name: string;
  appliesTo: ApprovalAppliesTo;
  enabled: boolean;
  condMagnitude: '' | 'MINOR' | 'MAJOR';
  condChargeable: '' | 'yes' | 'no';
  condMinAmountIdr: string;
  escalationUserId: string;
  steps: StepDraft[];
}

// The action a workflow gates.
const APPLIES_TO: { value: ApprovalAppliesTo; label: string; hint: string }[] = [
  { value: 'CHANGE_REQUEST', label: 'Change request', hint: 'A submitted CR is routed for sign-off before it can be decided.' },
  { value: 'COST_BASELINE', label: 'Cost baseline lock', hint: 'Locking the baseline (PMB/BAC) is routed for sign-off before it takes effect.' },
  { value: 'BASELINE_UNLOCK', label: 'Cost baseline unlock', hint: 'Re-opening a locked baseline is routed for sign-off before it unlocks — the baseline stays frozen until approved.' },
  { value: 'PROJECT_CLOSURE', label: 'Project closure', hint: 'Closing a project is routed for sign-off before it actually closes.' },
  { value: 'AI_ACTION', label: 'AI-proposed action', hint: 'An action drafted by the AI (create risk, update progress, draft CR, tidy schedule) is routed for sign-off; it runs only when approved. If none is configured, a default PM+Admin approval is used.' },
];
const appliesLabel = (v: ApprovalAppliesTo) => APPLIES_TO.find((a) => a.value === v)?.label ?? v;

const emptyStep = (): StepDraft => ({ name: '', mode: 'ANY', slaHours: '', approvers: [{ kind: 'ROLE', role: 'PMO', userId: '' }] });
const emptyForm = (): FormState => ({ name: '', appliesTo: 'CHANGE_REQUEST', enabled: true, condMagnitude: '', condChargeable: '', condMinAmountIdr: '', escalationUserId: '', steps: [emptyStep()] });

// Tenant-ADMIN builder for multi-step Change Request approval chains. A CR that matches a workflow's
// conditions is routed through its ordered steps instead of the single-decider path.
export default function ApprovalWorkflowsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);

  const wfQ = useQuery({ queryKey: ['approval-workflows'], queryFn: () => api.get<{ workflows: ApprovalWorkflow[] }>('/approval-workflows') });
  const membersQ = useQuery({ queryKey: ['members'], queryFn: () => api.get<{ members: TenantMember[] }>('/members') });
  const members = membersQ.data?.members.filter((m) => m.isActive) ?? [];

  const reset = () => { setForm(emptyForm()); setEditingId(null); };

  const isCr = form.appliesTo === 'CHANGE_REQUEST';
  const buildPayload = () => ({
    name: form.name.trim(),
    appliesTo: form.appliesTo,
    enabled: form.enabled,
    // Conditions only apply to Change Requests; other entity types match unconditionally.
    condMagnitude: isCr ? form.condMagnitude || null : null,
    condChargeable: isCr && form.condChargeable !== '' ? form.condChargeable === 'yes' : null,
    condMinAmountIdr: isCr && form.condMinAmountIdr.trim() ? Number(form.condMinAmountIdr) : null,
    escalationUserId: form.escalationUserId || null,
    steps: form.steps.map((s) => ({
      name: s.name.trim(),
      mode: s.mode,
      slaHours: s.slaHours.trim() ? Number(s.slaHours) : null,
      approvers: s.approvers.map((a) => ({
        kind: a.kind,
        role: a.kind === 'ROLE' ? a.role || null : null,
        userId: a.kind === 'USER' ? a.userId || null : null,
      })),
    })),
  });

  const save = useMutation({
    mutationFn: () => editingId
      ? api.patch(`/approval-workflows/${editingId}`, buildPayload())
      : api.post('/approval-workflows', buildPayload()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approval-workflows'] });
      toast.success(editingId ? 'Workflow updated' : 'Workflow created');
      reset();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the workflow'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/approval-workflows/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approval-workflows'] }); toast.success('Workflow deleted'); if (editingId) reset(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not delete'),
  });

  const toggleEnabled = useMutation({
    mutationFn: (w: ApprovalWorkflow) => api.patch(`/approval-workflows/${w.id}`, { ...serialize(w), enabled: !w.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approval-workflows'] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not update'),
  });

  const startEdit = (w: ApprovalWorkflow) => {
    setEditingId(w.id);
    setForm({
      name: w.name,
      appliesTo: w.appliesTo,
      enabled: w.enabled,
      condMagnitude: (w.condMagnitude ?? '') as FormState['condMagnitude'],
      condChargeable: w.condChargeable == null ? '' : w.condChargeable ? 'yes' : 'no',
      condMinAmountIdr: w.condMinAmountIdr == null ? '' : String(w.condMinAmountIdr),
      escalationUserId: w.escalationUserId ?? '',
      steps: w.steps.map((s) => ({
        name: s.name,
        mode: s.mode,
        slaHours: s.slaHours == null ? '' : String(s.slaHours),
        approvers: s.approvers.map((a) => ({ kind: a.kind, role: (a.role ?? '') as Role | '', userId: a.userId ?? '' })),
      })),
    });
  };

  // --- step/approver editors ---
  const patchStep = (i: number, patch: Partial<StepDraft>) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const patchApprover = (si: number, ai: number, patch: Partial<ApproverDraft>) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s, j) => j !== si ? s : { ...s, approvers: s.approvers.map((a, k) => (k === ai ? { ...a, ...patch } : a)) }) }));

  const stepsValid = form.steps.length > 0 && form.steps.every((s) =>
    s.name.trim() && s.approvers.length > 0 && s.approvers.every((a) =>
      a.kind === 'PROJECT_PM' || (a.kind === 'ROLE' && a.role) || (a.kind === 'USER' && a.userId)));
  const canSave = form.name.trim().length > 0 && stepsValid && !save.isPending;

  const workflows = wfQ.data?.workflows ?? [];

  return (
    <Card>
      <SectionTitle sub="Route Change Requests through a multi-step approval chain. A CR matching a workflow's conditions goes through its steps instead of the single approve/reject. No match → the usual PMO/Admin decision.">
        Approval workflows
      </SectionTitle>

      {/* Existing workflows */}
      <div className="mt-3">
        {wfQ.isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : workflows.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">No approval workflows yet — every CR uses the default single decision.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {workflows.map((w) => (
              <li key={w.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{w.name}</span>
                    {!w.enabled && <Badge color="slate">off</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <Badge color="violet">{appliesLabel(w.appliesTo)}</Badge>
                    <Badge color="blue">{w.steps.length} step{w.steps.length === 1 ? '' : 's'}</Badge>
                    {condSummary(w).map((c) => <span key={c}>· {c}</span>)}
                    <span className="text-slate-400">· {w.steps.map((s) => s.name).join(' → ')}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Toggle checked={w.enabled} onChange={() => toggleEnabled.mutate(w)} label={`Enable ${w.name}`} />
                  <Button type="button" variant="ghost" onClick={() => startEdit(w)}>Edit</Button>
                  <Button type="button" variant="ghost" onClick={() => { if (confirm(`Delete workflow “${w.name}”?`)) remove.mutate(w.id); }} disabled={remove.isPending}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Builder */}
      <form onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }} className="mt-5 space-y-4 border-t border-slate-100 pt-4 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{editingId ? 'Edit workflow' : 'New workflow'}</h4>
          {editingId && <Button type="button" variant="ghost" onClick={reset}>Cancel edit</Button>}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Major/chargeable change sign-off" maxLength={80} /></Field>
          </div>
          <div className="w-52">
            <Field label="Gates" hint={APPLIES_TO.find((a) => a.value === form.appliesTo)?.hint}>
              <Select value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value as ApprovalAppliesTo })}>
                {APPLIES_TO.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700 dark:text-slate-300">
            <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Enabled" /> Enabled
          </label>
        </div>

        {/* Conditions — Change Requests only (other entity types match unconditionally). */}
        {isCr && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Apply only when (all optional)</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field label="Magnitude">
                <Select value={form.condMagnitude} onChange={(e) => setForm({ ...form, condMagnitude: e.target.value as FormState['condMagnitude'] })}>
                  <option value="">Any</option>
                  <option value="MINOR">Minor</option>
                  <option value="MAJOR">Major</option>
                </Select>
              </Field>
            </div>
            <div className="w-40">
              <Field label="Chargeable">
                <Select value={form.condChargeable} onChange={(e) => setForm({ ...form, condChargeable: e.target.value as FormState['condChargeable'] })}>
                  <option value="">Any</option>
                  <option value="yes">Chargeable only</option>
                  <option value="no">Non-chargeable only</option>
                </Select>
              </Field>
            </div>
            <div className="w-48">
              <Field label="Min amount (IDR)" hint="≥ this amount">
                <Input type="number" min={0} value={form.condMinAmountIdr} onChange={(e) => setForm({ ...form, condMinAmountIdr: e.target.value })} placeholder="Any" />
              </Field>
            </div>
          </div>
        </div>
        )}

        {/* Steps */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Approval steps (in order)</p>
          {form.steps.map((step, si) => (
            <div key={si} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{si + 1}</div>
                <div className="min-w-[10rem] flex-1">
                  <Field label="Step name"><Input value={step.name} onChange={(e) => patchStep(si, { name: e.target.value })} placeholder="e.g. Sponsor sign-off" maxLength={80} /></Field>
                </div>
                <div className="w-44">
                  <Field label="Requires" hint="of the approvers below">
                    <Select value={step.mode} onChange={(e) => patchStep(si, { mode: e.target.value as 'ANY' | 'ALL' })}>
                      <option value="ANY">Any one approves</option>
                      <option value="ALL">All must approve</option>
                    </Select>
                  </Field>
                </div>
                <div className="w-28">
                  <Field label="SLA (hrs)" hint="optional">
                    <Input type="number" min={1} value={step.slaHours} onChange={(e) => patchStep(si, { slaHours: e.target.value })} placeholder="—" />
                  </Field>
                </div>
                {form.steps.length > 1 && (
                  <Button type="button" variant="ghost" onClick={() => setForm((f) => ({ ...f, steps: f.steps.filter((_, j) => j !== si) }))}>Remove step</Button>
                )}
              </div>

              <div className="mt-3 space-y-2 pl-10">
                {step.approvers.map((ap, ai) => (
                  <div key={ai} className="flex flex-wrap items-center gap-2">
                    <div className="w-40">
                      <Select value={ap.kind} onChange={(e) => patchApprover(si, ai, { kind: e.target.value as ApprovalApproverKind })}>
                        <option value="ROLE">A role</option>
                        <option value="USER">A specific person</option>
                        <option value="PROJECT_PM">The project's PM</option>
                      </Select>
                    </div>
                    {ap.kind === 'ROLE' && (
                      <div className="w-44">
                        <Select value={ap.role} onChange={(e) => patchApprover(si, ai, { role: e.target.value as Role | '' })}>
                          <option value="">Choose a role…</option>
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </Select>
                      </div>
                    )}
                    {ap.kind === 'USER' && (
                      <div className="w-56">
                        <Select value={ap.userId} onChange={(e) => patchApprover(si, ai, { userId: e.target.value })}>
                          <option value="">Choose a person…</option>
                          {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
                        </Select>
                      </div>
                    )}
                    {ap.kind === 'PROJECT_PM' && <span className="text-xs text-slate-400">resolved from each CR's project</span>}
                    {step.approvers.length > 1 && (
                      <button type="button" onClick={() => patchStep(si, { approvers: step.approvers.filter((_, k) => k !== ai) })} className="text-xs text-slate-400 hover:text-red-500" aria-label="Remove approver">✕</button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => patchStep(si, { approvers: [...step.approvers, { kind: 'ROLE', role: '', userId: '' }] })} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">+ add approver</button>
              </div>
            </div>
          ))}
          <Button type="button" variant="ghost" onClick={() => setForm((f) => ({ ...f, steps: [...f.steps, emptyStep()] }))}>+ Add step</Button>
        </div>

        {/* Escalation — who to nudge when a step blows its SLA (defaults to the workspace admins). */}
        <div className="w-72">
          <Field label="Escalate overdue steps to" hint="optional — defaults to workspace admins">
            <Select value={form.escalationUserId} onChange={(e) => setForm({ ...form, escalationUserId: e.target.value })}>
              <option value="">Workspace admins</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
            </Select>
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={!canSave}>{save.isPending ? 'Saving…' : editingId ? 'Save changes' : 'Create workflow'}</Button>
        </div>
      </form>
    </Card>
  );
}

// Serialize a workflow back into the API's write shape (for a quick enabled-toggle without opening the editor).
function serialize(w: ApprovalWorkflow) {
  return {
    name: w.name,
    appliesTo: w.appliesTo,
    condMagnitude: w.condMagnitude,
    condChargeable: w.condChargeable,
    condMinAmountIdr: w.condMinAmountIdr == null ? null : Number(w.condMinAmountIdr),
    escalationUserId: w.escalationUserId,
    steps: w.steps.map((s) => ({
      name: s.name,
      mode: s.mode,
      slaHours: s.slaHours ?? null,
      approvers: s.approvers.map((a) => ({ kind: a.kind, role: a.role, userId: a.userId })),
    })),
  };
}

function condSummary(w: ApprovalWorkflow): string[] {
  const out: string[] = [];
  if (w.condMagnitude) out.push(w.condMagnitude === 'MAJOR' ? 'major' : 'minor');
  if (w.condChargeable != null) out.push(w.condChargeable ? 'chargeable' : 'non-chargeable');
  if (w.condMinAmountIdr != null) out.push(`≥ ${Number(w.condMinAmountIdr).toLocaleString('id-ID')}`);
  return out;
}
