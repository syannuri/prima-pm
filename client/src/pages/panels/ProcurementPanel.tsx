import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Procurement, ContractType, ProcurementStatus } from '../../api/types';
import { Badge, Button, Card, Field, FormError, Input, Modal, SectionTitle, Select, PanelLoading, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useProjectWrite } from '../../lib/useProjectWrite';
import { formatIdr, formatDate } from '../../lib/format';

const TYPES: ContractType[] = ['FIXED_PRICE', 'TIME_AND_MATERIALS', 'COST_PLUS', 'PURCHASE_ORDER'];
const STATUSES: ProcurementStatus[] = ['PLANNED', 'SOLICITATION', 'AWARDED', 'IN_PROGRESS', 'DELIVERED', 'CLOSED', 'CANCELLED'];
const TYPE_LABEL: Record<ContractType, string> = { FIXED_PRICE: 'Fixed price', TIME_AND_MATERIALS: 'Time & materials', COST_PLUS: 'Cost-plus', PURCHASE_ORDER: 'Purchase order' };
const STATUS_LABEL: Record<ProcurementStatus, string> = { PLANNED: 'Planned', SOLICITATION: 'Solicitation', AWARDED: 'Awarded', IN_PROGRESS: 'In progress', DELIVERED: 'Delivered', CLOSED: 'Closed', CANCELLED: 'Cancelled' };
const STATUS_COLOR: Record<ProcurementStatus, string> = { PLANNED: 'slate', SOLICITATION: 'sky', AWARDED: 'indigo', IN_PROGRESS: 'amber', DELIVERED: 'green', CLOSED: 'slate', CANCELLED: 'red' };
// Value is "committed" once a contract is awarded and until it's closed out.
const COMMITTED: ProcurementStatus[] = ['AWARDED', 'IN_PROGRESS', 'DELIVERED'];

export default function ProcurementPanel({ projectId }: { projectId: string }) {
  const canWrite = useProjectWrite(projectId);
  const qc = useQueryClient();
  const base = `/projects/${projectId}/procurements`;
  const [editing, setEditing] = useState<Procurement | null>(null);
  const [creating, setCreating] = useState(false);

  const q = useQuery({ queryKey: ['procurements', projectId], queryFn: () => api.get<{ procurements: Procurement[] }>(base) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['procurements', projectId] });

  if (q.isLoading) return <PanelLoading />;
  const list = q.data?.procurements ?? [];
  const active = list.filter((p) => p.status !== 'CANCELLED');
  const plannedValue = active.reduce((s, p) => s + (p.amount ?? 0), 0);
  const committedValue = list.filter((p) => COMMITTED.includes(p.status)).reduce((s, p) => s + (p.amount ?? 0), 0);
  const openCount = list.filter((p) => !['CLOSED', 'CANCELLED'].includes(p.status)).length;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle sub="Contracts &amp; purchases: vendor, contract type, value and status through solicit → award → deliver → close.">Procurement Register</SectionTitle>
          {canWrite && <Button onClick={() => setCreating(true)}>+ Add procurement</Button>}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Items" value={String(list.length)} sub={`${openCount} open`} />
          <Stat label="Planned value" value={formatIdr(plannedValue)} sub="excl. cancelled" />
          <Stat label="Committed" value={formatIdr(committedValue)} sub="awarded → delivered" />
          <Stat label="Vendors" value={String(new Set(active.map((p) => p.vendor).filter(Boolean)).size)} sub="distinct" />
        </div>

        {/* Desktop: full register. Mobile: stacked cards so Value + Status never clip off the right edge. */}
        <div className="mt-4 hidden overflow-x-auto sm:block">
          <table className="prima-rows w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <th className="py-2">Code</th><th>Item</th><th>Vendor</th><th>Type</th>
                <th className="text-right">Value</th><th>Need by</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                  <td className="py-2 font-mono text-xs">{p.code}</td>
                  <td className="py-2">
                    <div className="font-medium text-slate-700 dark:text-slate-200">{p.title}</div>
                    {p.scope && <div className="max-w-[16rem] truncate text-xs text-slate-500 dark:text-slate-400">{p.scope}</div>}
                  </td>
                  <td className="py-2 text-slate-600 dark:text-slate-300">
                    {p.vendor ?? '—'}
                    {p.vendorContact && <div className="text-xs text-slate-500 dark:text-slate-400">{p.vendorContact}</div>}
                  </td>
                  <td className="py-2 text-xs text-slate-600 dark:text-slate-300">{TYPE_LABEL[p.type]}</td>
                  <td className="py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{p.amount != null ? formatIdr(p.amount) : '—'}</td>
                  <td className="py-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{p.needBy ? formatDate(p.needBy) : '—'}</td>
                  <td className="py-2"><Badge color={STATUS_COLOR[p.status]}>{STATUS_LABEL[p.status]}</Badge></td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {canWrite && <button onClick={() => setEditing(p)} className="mr-2 text-xs text-brand-600 hover:underline">edit</button>}
                    {canWrite && <DeleteBtn base={base} id={p.id} title={p.title} onDone={invalidate} />}
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={8} className="py-4 text-center text-slate-500 dark:text-slate-400">No procurements yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-2 sm:hidden">
          {list.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{p.code}</span>
                  <p className="font-medium text-slate-700 dark:text-slate-200">{p.title}</p>
                  {p.scope && <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{p.scope}</p>}
                </div>
                <Badge color={STATUS_COLOR[p.status]}>{STATUS_LABEL[p.status]}</Badge>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
                <div className="col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Vendor</dt>
                  <dd className="text-slate-600 dark:text-slate-300">
                    {p.vendor ?? '—'}
                    {p.vendorContact && <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">· {p.vendorContact}</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Value</dt>
                  <dd className="tabular-nums text-slate-700 dark:text-slate-200">{p.amount != null ? formatIdr(p.amount) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Type</dt>
                  <dd className="text-slate-600 dark:text-slate-300">{TYPE_LABEL[p.type]}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Need by</dt>
                  <dd className="text-slate-600 dark:text-slate-300">{p.needBy ? formatDate(p.needBy) : '—'}</dd>
                </div>
              </dl>
              {canWrite && (
                <div className="mt-2 flex justify-end gap-4 border-t border-slate-100 pt-2 dark:border-slate-800">
                  <button onClick={() => setEditing(p)} className="text-xs font-medium text-brand-600 hover:underline">edit</button>
                  <DeleteBtn base={base} id={p.id} title={p.title} onDone={invalidate} />
                </div>
              )}
            </div>
          ))}
          {!list.length && <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">No procurements yet.</p>}
        </div>
      </Card>

      {(creating || editing) && (
        <ProcurementForm base={base} procurement={editing} onClose={() => { setCreating(false); setEditing(null); }} onDone={invalidate} />
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-base font-bold tabular-nums text-slate-800 dark:text-slate-100">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

function DeleteBtn({ base, id, title, onDone }: { base: string; id: string; title: string; onDone: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const del = useMutation({
    mutationFn: () => api.del(`${base}/${id}`),
    onSuccess: () => { onDone(); toast.success('Procurement deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete'),
  });
  const onClick = async () => {
    if (await confirm({ title: 'Delete procurement?', message: <>Delete <strong>{title}</strong> from the register?</>, confirmLabel: 'Delete', danger: true })) del.mutate();
  };
  return <button onClick={onClick} className="text-xs text-red-500 hover:underline">delete</button>;
}

const toDateInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

function ProcurementForm({ base, procurement, onClose, onDone }: { base: string; procurement: Procurement | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    title: procurement?.title ?? '',
    vendor: procurement?.vendor ?? '',
    vendorContact: procurement?.vendorContact ?? '',
    type: procurement?.type ?? 'PURCHASE_ORDER',
    status: procurement?.status ?? 'PLANNED',
    amount: procurement?.amount != null ? String(procurement.amount) : '',
    needBy: toDateInput(procurement?.needBy),
    startDate: toDateInput(procurement?.startDate),
    endDate: toDateInput(procurement?.endDate),
    scope: procurement?.scope ?? '',
    notes: procurement?.notes ?? '',
  });
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { title: f.title.trim(), type: f.type, status: f.status };
      if (f.vendor.trim()) body.vendor = f.vendor.trim();
      if (f.vendorContact.trim()) body.vendorContact = f.vendorContact.trim();
      if (f.amount.trim() !== '') body.amount = Number(f.amount);
      if (f.needBy) body.needBy = f.needBy;
      if (f.startDate) body.startDate = f.startDate;
      if (f.endDate) body.endDate = f.endDate;
      if (f.scope.trim()) body.scope = f.scope.trim();
      if (f.notes.trim()) body.notes = f.notes.trim();
      return procurement ? api.put(`${base}/${procurement.id}`, body) : api.post(base, body);
    },
    onSuccess: () => { toast.success(procurement ? 'Procurement updated' : 'Procurement added'); onDone(); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to save'),
  });

  return (
    <Modal onClose={onClose} title={procurement ? `Edit ${procurement.code}` : 'Add a procurement'} size="lg">
      <div className="space-y-3">
        <Field label="Title"><Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="What is being procured?" /></Field>
        {/* 2-col even on phones so the Need-by / Start / End date pickers aren't full-width. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vendor / supplier"><Input value={f.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="Company name" /></Field>
          <Field label="Vendor contact"><Input value={f.vendorContact} onChange={(e) => set('vendorContact', e.target.value)} placeholder="Name / email / phone" /></Field>
          <Field label="Contract type"><Select value={f.type} onChange={(e) => set('type', e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select></Field>
          <Field label="Value (IDR)"><Input type="number" min="0" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="e.g. 150000000" /></Field>
          <Field label="Need by"><Input type="date" value={f.needBy} onChange={(e) => set('needBy', e.target.value)} /></Field>
          <Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
          <Field label="End / delivery date"><Input type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
        </div>
        <Field label="Scope / SOW"><Textarea rows={2} value={f.scope} onChange={(e) => set('scope', e.target.value)} placeholder="What the contract covers…" /></Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Terms, risks, dependencies…" /></Field>
        <FormError>{err}</FormError>
        <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!f.title.trim() || save.isPending}>{procurement ? 'Save' : 'Add'}</Button>
        </div>
      </div>
    </Modal>
  );
}
