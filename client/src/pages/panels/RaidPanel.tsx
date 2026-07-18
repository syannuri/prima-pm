import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Assumption, AssumptionStatus, ProjectDependency, DependencyDirection, DependencyStatus, IssueImpact, Issue, Risk, User } from '../../api/types';
import { Badge, Button, Card, Field, Input, Modal, SectionTitle, Select, PanelLoading, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useProjectWrite } from '../../lib/useProjectWrite';
import { formatDate } from '../../lib/format';

const IMPACTS: IssueImpact[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const IMPACT_COLOR: Record<IssueImpact, string> = { LOW: 'green', MEDIUM: 'amber', HIGH: 'red', CRITICAL: 'red' };
const A_STATUSES: AssumptionStatus[] = ['OPEN', 'VALIDATED', 'INVALIDATED'];
const A_COLOR: Record<AssumptionStatus, string> = { OPEN: 'amber', VALIDATED: 'green', INVALIDATED: 'red' };
const D_DIRECTIONS: DependencyDirection[] = ['INBOUND', 'OUTBOUND'];
const D_STATUSES: DependencyStatus[] = ['PENDING', 'ON_TRACK', 'AT_RISK', 'RESOLVED'];
const D_COLOR: Record<DependencyStatus, string> = { PENDING: 'slate', ON_TRACK: 'sky', AT_RISK: 'amber', RESOLVED: 'green' };
const cap = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const DIR_LABEL: Record<DependencyDirection, string> = { INBOUND: '⇦ Inbound (we need)', OUTBOUND: '⇨ Outbound (we owe)' };

// The RAID log — Risks · Assumptions · Issues · Dependencies in one place. Risk & Issue are
// managed in their own tabs (shown here as counts); Assumptions & Dependencies are managed inline.
export default function RaidPanel({ projectId, onJump }: { projectId: string; onJump?: (tab: string) => void }) {
  const canWrite = useProjectWrite(projectId);
  const base = `/projects/${projectId}/raid`;

  const aQ = useQuery({ queryKey: ['assumptions', projectId], queryFn: () => api.get<{ assumptions: Assumption[] }>(`${base}/assumptions`) });
  const dQ = useQuery({ queryKey: ['dependencies', projectId], queryFn: () => api.get<{ dependencies: ProjectDependency[] }>(`${base}/dependencies`) });
  const riskQ = useQuery({ queryKey: ['risks', projectId], queryFn: () => api.get<{ risks: Risk[] }>(`/projects/${projectId}/risk`) });
  const issueQ = useQuery({ queryKey: ['issues', projectId], queryFn: () => api.get<{ issues: Issue[] }>(`/projects/${projectId}/issues`) });

  if (aQ.isLoading || dQ.isLoading) return <PanelLoading />;
  const assumptions = aQ.data?.assumptions ?? [];
  const dependencies = dQ.data?.dependencies ?? [];
  const riskCount = riskQ.data?.risks.length ?? 0;
  const issuesOpen = (issueQ.data?.issues ?? []).filter((i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS').length;

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle sub="Risks, Assumptions, Issues &amp; Dependencies in one log. Risks &amp; Issues are managed in their own tabs; Assumptions &amp; Dependencies below.">RAID Log</SectionTitle>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <RaidStat letter="R" label="Risks" value={riskCount} onClick={onJump ? () => onJump('Risk') : undefined} />
          <RaidStat letter="A" label="Assumptions" value={assumptions.length} sub={`${assumptions.filter((a) => a.status === 'OPEN').length} open`} />
          <RaidStat letter="I" label="Issues" value={issuesOpen} sub="open" onClick={onJump ? () => onJump('Issues') : undefined} />
          <RaidStat letter="D" label="Dependencies" value={dependencies.length} sub={`${dependencies.filter((d) => d.status === 'AT_RISK').length} at risk`} />
        </div>
      </Card>

      {/* Assumptions */}
      <Register<Assumption>
        title="Assumptions" addLabel="assumption" sub="Things taken as true for planning — validate or invalidate over time."
        base={`${base}/assumptions`} queryKey={['assumptions', projectId]} rows={assumptions} canWrite={canWrite}
        columns={['Code', 'Assumption', 'Category', 'Impact', 'Status', 'Owner']}
        renderRow={(a) => (
          <>
            <td className="py-2 font-mono text-xs">{a.code}</td>
            <td className="py-2 max-w-[22rem]"><div className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{a.statement}</div>{a.notes && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{a.notes}</div>}</td>
            <td className="py-2 text-slate-600 dark:text-slate-300">{a.category ?? '—'}</td>
            <td className="py-2"><Badge color={IMPACT_COLOR[a.impact]}>{a.impact}</Badge></td>
            <td className="py-2"><Badge color={A_COLOR[a.status]}>{cap(a.status)}</Badge></td>
            <td className="py-2 text-slate-600 dark:text-slate-300">{a.owner?.name ?? '—'}</td>
          </>
        )}
        renderCard={(a, act) => (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{a.code}</span>
                <p className="whitespace-pre-wrap font-medium text-slate-700 dark:text-slate-200">{a.statement}</p>
              </div>
              <Badge color={A_COLOR[a.status]}>{cap(a.status)}</Badge>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Category</dt>
                <dd className="text-slate-600 dark:text-slate-300">{a.category ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Impact</dt>
                <dd><Badge color={IMPACT_COLOR[a.impact]}>{a.impact}</Badge></dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Owner</dt>
                <dd className="text-slate-600 dark:text-slate-300">{a.owner?.name ?? '—'}</dd>
              </div>
              {a.notes && (
                <div className="col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Notes</dt>
                  <dd className="text-slate-600 dark:text-slate-300">{a.notes}</dd>
                </div>
              )}
            </dl>
            {canWrite && (
              <div className="mt-2 flex justify-end gap-4 border-t border-slate-100 pt-2 dark:border-slate-800">
                <button onClick={act.edit} className="text-xs font-medium text-brand-600 hover:underline">edit</button>
                {act.del}
              </div>
            )}
          </>
        )}
        Form={AssumptionForm}
      />

      {/* Dependencies */}
      <Register<ProjectDependency>
        title="Dependencies" addLabel="dependency" sub="Cross-team / external dependencies — inbound (we need) or outbound (we owe)."
        base={`${base}/dependencies`} queryKey={['dependencies', projectId]} rows={dependencies} canWrite={canWrite}
        columns={['Code', 'Dependency', 'Direction', 'Counterparty', 'Due', 'Impact', 'Status', 'Owner']}
        renderRow={(d) => (
          <>
            <td className="py-2 font-mono text-xs">{d.code}</td>
            <td className="py-2 max-w-[20rem]"><div className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{d.description}</div>{d.notes && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{d.notes}</div>}</td>
            <td className="py-2 text-xs text-slate-600 dark:text-slate-300">{DIR_LABEL[d.direction]}</td>
            <td className="py-2 text-slate-600 dark:text-slate-300">{d.counterparty ?? '—'}</td>
            <td className="py-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{d.dueDate ? formatDate(d.dueDate) : '—'}</td>
            <td className="py-2"><Badge color={IMPACT_COLOR[d.impact]}>{d.impact}</Badge></td>
            <td className="py-2"><Badge color={D_COLOR[d.status]}>{cap(d.status)}</Badge></td>
            <td className="py-2 text-slate-600 dark:text-slate-300">{d.owner?.name ?? '—'}</td>
          </>
        )}
        renderCard={(d, act) => (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{d.code}</span>
                <p className="whitespace-pre-wrap font-medium text-slate-700 dark:text-slate-200">{d.description}</p>
              </div>
              <Badge color={D_COLOR[d.status]}>{cap(d.status)}</Badge>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
              <div className="col-span-2">
                <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Direction</dt>
                <dd className="text-slate-600 dark:text-slate-300">{DIR_LABEL[d.direction]}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Counterparty</dt>
                <dd className="text-slate-600 dark:text-slate-300">{d.counterparty ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Due</dt>
                <dd className="text-slate-600 dark:text-slate-300">{d.dueDate ? formatDate(d.dueDate) : '—'}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Impact</dt>
                <dd><Badge color={IMPACT_COLOR[d.impact]}>{d.impact}</Badge></dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Owner</dt>
                <dd className="text-slate-600 dark:text-slate-300">{d.owner?.name ?? '—'}</dd>
              </div>
              {d.notes && (
                <div className="col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Notes</dt>
                  <dd className="text-slate-600 dark:text-slate-300">{d.notes}</dd>
                </div>
              )}
            </dl>
            {canWrite && (
              <div className="mt-2 flex justify-end gap-4 border-t border-slate-100 pt-2 dark:border-slate-800">
                <button onClick={act.edit} className="text-xs font-medium text-brand-600 hover:underline">edit</button>
                {act.del}
              </div>
            )}
          </>
        )}
        Form={DependencyForm}
      />
      {(riskQ.isError || issueQ.isError) && null}
    </div>
  );
}

function RaidStat({ letter, label, value, sub, onClick }: { letter: string; label: string; value: number; sub?: string; onClick?: () => void }) {
  const inner = (
    <>
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{letter}</span>
        <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums text-slate-800 dark:text-slate-100">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </>
  );
  const cls = 'rounded-lg border border-slate-200 p-2.5 text-left dark:border-slate-800';
  return onClick
    ? <button onClick={onClick} className={`${cls} transition hover:border-brand-400 hover:bg-brand-50/40 dark:hover:bg-brand-900/10`}>{inner}<div className="mt-0.5 text-[10px] font-medium text-brand-600 dark:text-brand-400">open tab →</div></button>
    : <div className={cls}>{inner}</div>;
}

// Generic register card (table + add button) shared by Assumptions and Dependencies.
interface RegRow { id: string }
function Register<T extends RegRow>({ title, sub, addLabel, base, queryKey, rows, canWrite, columns, renderRow, renderCard, Form }: {
  title: string; sub: string; addLabel: string; base: string; queryKey: unknown[]; rows: T[]; canWrite: boolean;
  columns: string[]; renderRow: (row: T) => React.ReactNode;
  renderCard: (row: T, actions: { edit: () => void; del: React.ReactNode }) => React.ReactNode;
  Form: (p: { base: string; row: T | null; onClose: () => void; onDone: () => void }) => React.ReactElement;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<T | null>(null);
  const [creating, setCreating] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey });
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle sub={sub}>{title}</SectionTitle>
        {canWrite && <Button variant="secondary" onClick={() => setCreating(true)}>+ Add {addLabel}</Button>}
      </div>
      {/* Desktop: full register. Mobile: stacked cards so status/owner columns never clip off-screen. */}
      <div className="mt-3 hidden overflow-x-auto sm:block">
        <table className="prima-rows w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
              {columns.map((c) => <th key={c} className="py-2">{c}</th>)}<th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                {renderRow(r)}
                <td className="py-2 text-right whitespace-nowrap">
                  {canWrite && <button onClick={() => setEditing(r)} className="mr-2 text-xs text-brand-600 hover:underline">edit</button>}
                  {canWrite && <DeleteBtn base={base} id={r.id} onDone={invalidate} />}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={columns.length + 1} className="py-4 text-center text-slate-500 dark:text-slate-400">None recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-3 space-y-2 sm:hidden">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            {renderCard(r, { edit: () => setEditing(r), del: <DeleteBtn base={base} id={r.id} onDone={invalidate} /> })}
          </div>
        ))}
        {!rows.length && <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">None recorded yet.</p>}
      </div>
      {(creating || editing) && <Form base={base} row={editing} onClose={() => { setCreating(false); setEditing(null); }} onDone={invalidate} />}
    </Card>
  );
}

function DeleteBtn({ base, id, onDone }: { base: string; id: string; onDone: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const del = useMutation({
    mutationFn: () => api.del(`${base}/${id}`),
    onSuccess: () => { onDone(); toast.success('Removed'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to remove'),
  });
  const onClick = async () => { if (await confirm({ title: 'Delete entry?', message: 'Remove this entry from the register?', confirmLabel: 'Delete', danger: true })) del.mutate(); };
  return <button onClick={onClick} className="text-xs text-red-500 hover:underline">delete</button>;
}

function OwnerSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => api.get<{ users: User[] }>('/users/directory') });
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Unassigned —</option>
      {dirQ.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </Select>
  );
}

function ImpactSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <Field label={label}><Select value={value} onChange={(e) => onChange(e.target.value)}>{IMPACTS.map((i) => <option key={i} value={i}>{i}</option>)}</Select></Field>;
}

function AssumptionForm({ base, row, onClose, onDone }: { base: string; row: Assumption | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ statement: row?.statement ?? '', category: row?.category ?? '', status: row?.status ?? 'OPEN', impact: row?.impact ?? 'MEDIUM', ownerUserId: row?.ownerUserId ?? '', notes: row?.notes ?? '' });
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { statement: f.statement.trim(), status: f.status, impact: f.impact };
      if (f.category.trim()) body.category = f.category.trim();
      if (f.ownerUserId) body.ownerUserId = f.ownerUserId;
      if (f.notes.trim()) body.notes = f.notes.trim();
      return row ? api.put(`${base}/${row.id}`, body) : api.post(base, body);
    },
    onSuccess: () => { toast.success(row ? 'Assumption updated' : 'Assumption added'); onDone(); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to save'),
  });
  return (
    <Modal onClose={onClose} title={row ? `Edit ${row.code}` : 'Add an assumption'} size="lg">
      <div className="space-y-3">
        <Field label="Assumption"><Textarea rows={2} value={f.statement} onChange={(e) => set('statement', e.target.value)} placeholder="We assume that…" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><Input value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Resource, Technical, Vendor" /></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => set('status', e.target.value)}>{A_STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</Select></Field>
          <ImpactSelect label="Impact if false" value={f.impact} onChange={(v) => set('impact', v)} />
          <Field label="Owner"><OwnerSelect value={f.ownerUserId} onChange={(v) => set('ownerUserId', v)} /></Field>
        </div>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Validation approach, evidence…" /></Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!f.statement.trim() || save.isPending}>{row ? 'Save' : 'Add'}</Button>
        </div>
      </div>
    </Modal>
  );
}

const toDateInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

function DependencyForm({ base, row, onClose, onDone }: { base: string; row: ProjectDependency | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ description: row?.description ?? '', direction: row?.direction ?? 'INBOUND', counterparty: row?.counterparty ?? '', dueDate: toDateInput(row?.dueDate), status: row?.status ?? 'PENDING', impact: row?.impact ?? 'MEDIUM', ownerUserId: row?.ownerUserId ?? '', notes: row?.notes ?? '' });
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { description: f.description.trim(), direction: f.direction, status: f.status, impact: f.impact };
      if (f.counterparty.trim()) body.counterparty = f.counterparty.trim();
      if (f.dueDate) body.dueDate = f.dueDate;
      if (f.ownerUserId) body.ownerUserId = f.ownerUserId;
      if (f.notes.trim()) body.notes = f.notes.trim();
      return row ? api.put(`${base}/${row.id}`, body) : api.post(base, body);
    },
    onSuccess: () => { toast.success(row ? 'Dependency updated' : 'Dependency added'); onDone(); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to save'),
  });
  return (
    <Modal onClose={onClose} title={row ? `Edit ${row.code}` : 'Add a dependency'} size="lg">
      <div className="space-y-3">
        <Field label="Dependency"><Textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="What is needed / owed, and by when…" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Direction"><Select value={f.direction} onChange={(e) => set('direction', e.target.value)}>{D_DIRECTIONS.map((d) => <option key={d} value={d}>{DIR_LABEL[d]}</option>)}</Select></Field>
          <Field label="Counterparty"><Input value={f.counterparty} onChange={(e) => set('counterparty', e.target.value)} placeholder="Team / project / vendor" /></Field>
          <Field label="Due date"><Input type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => set('status', e.target.value)}>{D_STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</Select></Field>
          <ImpactSelect label="Criticality" value={f.impact} onChange={(v) => set('impact', v)} />
          <Field label="Owner"><OwnerSelect value={f.ownerUserId} onChange={(v) => set('ownerUserId', v)} /></Field>
        </div>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Escalation path, mitigation…" /></Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!f.description.trim() || save.isPending}>{row ? 'Save' : 'Add'}</Button>
        </div>
      </div>
    </Modal>
  );
}
