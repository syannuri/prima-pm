import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type {
  Requirement, RequirementCategory, RequirementPriority, RequirementStatus, RequirementCoverage, Task,
} from '../../api/types';
import { Badge, Button, Card, Field, Input, Modal, SectionTitle, Select, Spinner, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';

const CATEGORIES: RequirementCategory[] = ['FUNCTIONAL', 'NON_FUNCTIONAL', 'BUSINESS', 'TECHNICAL', 'REGULATORY', 'OTHER'];
const PRIORITIES: RequirementPriority[] = ['MUST', 'SHOULD', 'COULD', 'WONT'];
const STATUSES: RequirementStatus[] = ['PROPOSED', 'APPROVED', 'IN_PROGRESS', 'VERIFIED', 'DEFERRED', 'REJECTED'];

const CATEGORY_LABEL: Record<RequirementCategory, string> = {
  FUNCTIONAL: 'Functional', NON_FUNCTIONAL: 'Non-functional', BUSINESS: 'Business', TECHNICAL: 'Technical', REGULATORY: 'Regulatory', OTHER: 'Other',
};
// MoSCoW.
const PRIORITY_LABEL: Record<RequirementPriority, string> = { MUST: 'Must', SHOULD: 'Should', COULD: 'Could', WONT: "Won't" };
const PRIORITY_COLOR: Record<RequirementPriority, string> = { MUST: 'indigo', SHOULD: 'sky', COULD: 'slate', WONT: 'slate' };
const STATUS_LABEL: Record<RequirementStatus, string> = {
  PROPOSED: 'Proposed', APPROVED: 'Approved', IN_PROGRESS: 'In progress', VERIFIED: 'Verified', DEFERRED: 'Deferred', REJECTED: 'Rejected',
};
const STATUS_COLOR: Record<RequirementStatus, string> = {
  PROPOSED: 'slate', APPROVED: 'sky', IN_PROGRESS: 'amber', VERIFIED: 'green', DEFERRED: 'slate', REJECTED: 'red',
};

export default function RequirementsPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const canWrite = !!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER'].includes(user.role);
  const qc = useQueryClient();
  const base = `/projects/${projectId}/requirements`;
  const [editing, setEditing] = useState<Requirement | null>(null);
  const [creating, setCreating] = useState(false);
  const [tracing, setTracing] = useState<Requirement | null>(null);

  const q = useQuery({ queryKey: ['requirements', projectId], queryFn: () => api.get<{ requirements: Requirement[]; coverage: RequirementCoverage }>(base) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['requirements', projectId] });

  if (q.isLoading) return <Spinner />;
  const list = q.data?.requirements ?? [];
  const cov = q.data?.coverage;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle sub="Scope register with forward traceability — every requirement should be delivered by at least one WBS task. Uncovered requirements are scope gaps.">Requirements Traceability</SectionTitle>
          {canWrite && <Button onClick={() => setCreating(true)}>+ Add requirement</Button>}
        </div>

        {cov && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Requirements" value={String(cov.total)} sub={`${cov.byPriority.MUST ?? 0} must-have`} />
            <Stat label="Covered" value={`${cov.covered}/${cov.total}`} sub={cov.total ? `${Math.round((cov.covered / cov.total) * 100)}% traced to WBS` : 'no requirements yet'} />
            <Stat label="Scope gaps" value={String(cov.uncovered)} sub="not linked to any task" tone={cov.uncovered > 0 ? 'warn' : 'ok'} />
            <Stat label="Verified" value={String(cov.verified)} sub="accepted / signed off" />
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="prima-rows w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <th className="py-2">Code</th><th>Requirement</th><th>Category</th><th>Priority</th><th>Status</th><th>Traces to (WBS)</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                  <td className="py-2 font-mono text-xs">{r.code}</td>
                  <td className="py-2">
                    <div className="font-medium text-slate-700 dark:text-slate-200">{r.title}</div>
                    {r.description && <div className="max-w-[20rem] truncate text-xs text-slate-500 dark:text-slate-400">{r.description}</div>}
                    {r.source && <div className="text-[11px] text-slate-400">source: {r.source}</div>}
                  </td>
                  <td className="py-2 text-xs text-slate-600 dark:text-slate-300">{CATEGORY_LABEL[r.category]}</td>
                  <td className="py-2"><Badge color={PRIORITY_COLOR[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge></td>
                  <td className="py-2"><Badge color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                  <td className="py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {r.taskLinks.map((l) => (
                        <span key={l.id} className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300" title={l.task.name}>
                          {l.task.wbsCode || l.task.name}
                        </span>
                      ))}
                      {r.taskLinks.length === 0 && <span className="text-xs text-amber-600 dark:text-amber-400">⚠ no link</span>}
                      {canWrite && <button onClick={() => setTracing(r)} className="ml-1 text-xs text-brand-600 hover:underline">+ link</button>}
                    </div>
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {canWrite && <button onClick={() => setEditing(r)} className="mr-2 text-xs text-brand-600 hover:underline">edit</button>}
                    {canWrite && <DeleteBtn base={base} id={r.id} title={r.title} onDone={invalidate} />}
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={7} className="py-4 text-center text-slate-500 dark:text-slate-400">No requirements yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {(creating || editing) && (
        <RequirementForm base={base} requirement={editing} onClose={() => { setCreating(false); setEditing(null); }} onDone={invalidate} />
      )}
      {tracing && (
        <TraceModal projectId={projectId} base={base} requirement={tracing} onClose={() => setTracing(null)} onDone={invalidate} />
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'ok' }) {
  const valueTone = tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100';
  return (
    <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-base font-bold tabular-nums ${valueTone}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

function DeleteBtn({ base, id, title, onDone }: { base: string; id: string; title: string; onDone: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const del = useMutation({
    mutationFn: () => api.del(`${base}/${id}`),
    onSuccess: () => { onDone(); toast.success('Requirement deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete'),
  });
  const onClick = async () => {
    if (await confirm({ title: 'Delete requirement?', message: <>Delete <strong>{title}</strong> and its traceability links?</>, confirmLabel: 'Delete', danger: true })) del.mutate();
  };
  return <button onClick={onClick} className="text-xs text-red-500 hover:underline">delete</button>;
}

function RequirementForm({ base, requirement, onClose, onDone }: { base: string; requirement: Requirement | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    title: requirement?.title ?? '',
    description: requirement?.description ?? '',
    category: requirement?.category ?? 'FUNCTIONAL',
    priority: requirement?.priority ?? 'MUST',
    status: requirement?.status ?? 'PROPOSED',
    source: requirement?.source ?? '',
    acceptanceCriteria: requirement?.acceptanceCriteria ?? '',
    notes: requirement?.notes ?? '',
  });
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { title: f.title.trim(), category: f.category, priority: f.priority, status: f.status };
      if (f.description.trim()) body.description = f.description.trim();
      if (f.source.trim()) body.source = f.source.trim();
      if (f.acceptanceCriteria.trim()) body.acceptanceCriteria = f.acceptanceCriteria.trim();
      if (f.notes.trim()) body.notes = f.notes.trim();
      return requirement ? api.put(`${base}/${requirement.id}`, body) : api.post(base, body);
    },
    onSuccess: () => { toast.success(requirement ? 'Requirement updated' : 'Requirement added'); onDone(); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to save'),
  });

  return (
    <Modal onClose={onClose} title={requirement ? `Edit ${requirement.code}` : 'Add a requirement'} size="lg">
      <div className="space-y-3">
        <Field label="Requirement"><Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="What the solution must do…" /></Field>
        <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Detail / rationale…" /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Category"><Select value={f.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
          <Field label="Priority (MoSCoW)"><Select value={f.priority} onChange={(e) => set('priority', e.target.value)}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select></Field>
        </div>
        <Field label="Source"><Input value={f.source} onChange={(e) => set('source', e.target.value)} placeholder="Stakeholder, document, charter clause…" /></Field>
        <Field label="Acceptance criteria"><Textarea rows={2} value={f.acceptanceCriteria} onChange={(e) => set('acceptanceCriteria', e.target.value)} placeholder="How this requirement is verified as met…" /></Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Constraints, dependencies…" /></Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!f.title.trim() || save.isPending}>{requirement ? 'Save' : 'Add'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// Manage which WBS tasks deliver a requirement (forward traceability).
function TraceModal({ projectId, base, requirement, onClose, onDone }: { projectId: string; base: string; requirement: Requirement; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const sched = useQuery({ queryKey: ['schedule', projectId], queryFn: () => api.get<{ tasks: Task[] }>(`/projects/${projectId}/schedule`) });
  // The requirement prop is a snapshot; re-read the live list so the checkbox state stays fresh after each toggle.
  const reqs = useQuery({ queryKey: ['requirements', projectId], queryFn: () => api.get<{ requirements: Requirement[] }>(base) });
  const live = reqs.data?.requirements.find((r) => r.id === requirement.id) ?? requirement;
  const linkedIds = new Set(live.taskLinks.map((l) => l.taskId));

  const refresh = () => { onDone(); qc.invalidateQueries({ queryKey: ['requirements', projectId] }); };
  const link = useMutation({
    mutationFn: (taskId: string) => api.post(`${base}/${requirement.id}/links`, { taskId }),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to link'),
  });
  const unlink = useMutation({
    mutationFn: (taskId: string) => api.del(`${base}/${requirement.id}/links/${taskId}`),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to unlink'),
  });

  const tasks = (sched.data?.tasks ?? []).slice().sort((a, b) => (a.wbsCode || '').localeCompare(b.wbsCode || ''));
  const busy = link.isPending || unlink.isPending;

  return (
    <Modal onClose={onClose} title={`Trace ${requirement.code} to WBS tasks`} size="lg">
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        Tick the tasks that deliver <strong className="text-slate-700 dark:text-slate-200">{requirement.title}</strong>. A requirement with no linked task is a scope gap.
      </p>
      {sched.isLoading ? <Spinner /> : tasks.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">This project has no WBS tasks to trace to yet.</p>
      ) : (
        <div className="max-h-[24rem] space-y-1 overflow-y-auto">
          {tasks.map((t) => {
            const on = linkedIds.has(t.id);
            return (
              <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy}
                  onChange={() => (on ? unlink.mutate(t.id) : link.mutate(t.id))}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{t.wbsCode || '—'}</span>
                <span className="text-sm text-slate-700 dark:text-slate-200">{t.name}</span>
                {t.isMilestone && <span className="text-[10px] uppercase text-slate-400">milestone</span>}
              </label>
            );
          })}
        </div>
      )}
      <div className="mt-4 flex justify-end border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
        <Button variant="secondary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
