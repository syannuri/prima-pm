import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Stakeholder, StakeholderCategory, InfluenceLevel, EngagementLevel } from '../../api/types';
import { Badge, Button, Card, Field, Input, Modal, SectionTitle, Select, PanelLoading, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useProjectWrite } from '../../lib/useProjectWrite';

const CATEGORIES: StakeholderCategory[] = ['SPONSOR', 'CUSTOMER', 'TEAM', 'VENDOR', 'REGULATOR', 'END_USER', 'OTHER'];
const LEVELS: InfluenceLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
const ENGAGEMENTS: EngagementLevel[] = ['UNAWARE', 'RESISTANT', 'NEUTRAL', 'SUPPORTIVE', 'LEADING'];
const ENG_RANK: Record<EngagementLevel, number> = { UNAWARE: 0, RESISTANT: 1, NEUTRAL: 2, SUPPORTIVE: 3, LEADING: 4 };
const CAT_LABEL: Record<StakeholderCategory, string> = { SPONSOR: 'Sponsor', CUSTOMER: 'Customer', TEAM: 'Team', VENDOR: 'Vendor', REGULATOR: 'Regulator', END_USER: 'End-user', OTHER: 'Other' };
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// Classic power/interest strategy (2×2), HIGH = high axis, else low.
function strategy(power: InfluenceLevel, interest: InfluenceLevel): string {
  const hiP = power === 'HIGH', hiI = interest === 'HIGH';
  if (hiP && hiI) return 'Manage closely';
  if (hiP) return 'Keep satisfied';
  if (hiI) return 'Keep informed';
  return 'Monitor';
}

export default function StakeholderPanel({ projectId }: { projectId: string }) {
  const canWrite = useProjectWrite(projectId);
  const qc = useQueryClient();
  const base = `/projects/${projectId}/stakeholders`;
  const [editing, setEditing] = useState<Stakeholder | null>(null);
  const [creating, setCreating] = useState(false);

  const q = useQuery({ queryKey: ['stakeholders', projectId], queryFn: () => api.get<{ stakeholders: Stakeholder[] }>(base) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['stakeholders', projectId] });

  if (q.isLoading) return <PanelLoading />;
  const list = q.data?.stakeholders ?? [];
  const gaps = list.filter((s) => ENG_RANK[s.currentEngagement] < ENG_RANK[s.desiredEngagement]).length;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle sub="Who has a stake, their power &amp; interest, and current vs desired engagement — so effort goes where the gap is.">Stakeholder Register</SectionTitle>
          {canWrite && <Button onClick={() => setCreating(true)}>+ Add stakeholder</Button>}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge color="slate">{list.length} stakeholder{list.length === 1 ? '' : 's'}</Badge>
          <Badge color={gaps > 0 ? 'amber' : 'green'}>{gaps} engagement gap{gaps === 1 ? '' : 's'}</Badge>
        </div>

        {list.length > 0 && <PowerInterestGrid list={list} />}

        {/* Desktop: full register. Mobile: stacked cards so Strategy + Engagement gap never clip off-screen. */}
        <div className="mt-4 hidden overflow-x-auto sm:block">
          <table className="prima-rows w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <th className="py-2">Code</th><th>Name</th><th>Category</th><th>Power</th><th>Interest</th>
                <th>Strategy</th><th>Engagement</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const gap = ENG_RANK[s.currentEngagement] < ENG_RANK[s.desiredEngagement];
                return (
                  <tr key={s.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                    <td className="py-2 font-mono text-xs">{s.code}</td>
                    <td className="py-2">
                      <div className="font-medium text-slate-700 dark:text-slate-200">{s.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{[s.role, s.organization].filter(Boolean).join(' · ') || '—'}{s.email ? ` · ${s.email}` : ''}</div>
                    </td>
                    <td className="py-2 text-slate-600 dark:text-slate-300">{CAT_LABEL[s.category]}</td>
                    <td className="py-2"><Lvl v={s.power} /></td>
                    <td className="py-2"><Lvl v={s.interest} /></td>
                    <td className="py-2 text-xs text-slate-600 dark:text-slate-300">{strategy(s.power, s.interest)}</td>
                    <td className="py-2 text-xs">
                      <span className={gap ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}>
                        {cap(s.currentEngagement)} {gap ? '→' : '='} {cap(s.desiredEngagement)}
                      </span>
                      {gap && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">gap</span>}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {canWrite && <button onClick={() => setEditing(s)} className="mr-2 text-xs text-brand-600 hover:underline">edit</button>}
                      {canWrite && <DeleteBtn base={base} id={s.id} name={s.name} onDone={invalidate} />}
                    </td>
                  </tr>
                );
              })}
              {!list.length && <tr><td colSpan={8} className="py-4 text-center text-slate-500 dark:text-slate-400">No stakeholders identified yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-2 sm:hidden">
          {list.map((s) => {
            const gap = ENG_RANK[s.currentEngagement] < ENG_RANK[s.desiredEngagement];
            return (
              <div key={s.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{s.code}</span>
                    <p className="font-medium text-slate-700 dark:text-slate-200">{s.name}</p>
                    <p className="break-words text-xs text-slate-500 dark:text-slate-400">{[s.role, s.organization].filter(Boolean).join(' · ') || '—'}{s.email ? ` · ${s.email}` : ''}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{CAT_LABEL[s.category]}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Power</dt>
                    <dd><Lvl v={s.power} /></dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Interest</dt>
                    <dd><Lvl v={s.interest} /></dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Strategy</dt>
                    <dd className="text-slate-600 dark:text-slate-300">{strategy(s.power, s.interest)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Engagement</dt>
                    <dd className="text-xs">
                      <span className={gap ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}>
                        {cap(s.currentEngagement)} {gap ? '→' : '='} {cap(s.desiredEngagement)}
                      </span>
                      {gap && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">gap</span>}
                    </dd>
                  </div>
                </dl>
                {canWrite && (
                  <div className="mt-2 flex justify-end gap-4 border-t border-slate-100 pt-2 dark:border-slate-800">
                    <button onClick={() => setEditing(s)} className="text-xs font-medium text-brand-600 hover:underline">edit</button>
                    <DeleteBtn base={base} id={s.id} name={s.name} onDone={invalidate} />
                  </div>
                )}
              </div>
            );
          })}
          {!list.length && <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">No stakeholders identified yet.</p>}
        </div>
      </Card>

      {(creating || editing) && (
        <StakeholderForm base={base} stakeholder={editing} onClose={() => { setCreating(false); setEditing(null); }} onDone={invalidate} />
      )}
    </div>
  );
}

// Power (rows, HIGH→LOW) × Interest (cols, LOW→HIGH) grid with stakeholder chips.
function PowerInterestGrid({ list }: { list: Stakeholder[] }) {
  const rows: InfluenceLevel[] = ['HIGH', 'MEDIUM', 'LOW'];
  const cols: InfluenceLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
  const tint = (p: InfluenceLevel, i: InfluenceLevel) => {
    const score = (p === 'HIGH' ? 2 : p === 'MEDIUM' ? 1 : 0) + (i === 'HIGH' ? 2 : i === 'MEDIUM' ? 1 : 0);
    return ['bg-slate-50 dark:bg-slate-800/40', 'bg-slate-50 dark:bg-slate-800/40', 'bg-sky-50 dark:bg-sky-900/20', 'bg-amber-50 dark:bg-amber-900/20', 'bg-brand-50 dark:bg-brand-900/20'][score];
  };
  return (
    <div className="mt-4">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Power / interest grid</div>
      <div className="flex gap-2">
        <div className="flex flex-col items-center justify-center"><span className="rotate-180 text-[10px] font-semibold uppercase tracking-wide text-slate-400 [writing-mode:vertical-rl]">Power →</span></div>
        <div className="flex-1">
          <div className="grid grid-cols-3 gap-1">
            {rows.map((p) => cols.map((i) => {
              const cell = list.filter((s) => s.power === p && s.interest === i);
              return (
                <div key={`${p}-${i}`} className={`min-h-[54px] rounded-md border border-slate-200 p-1.5 dark:border-slate-700 ${tint(p, i)}`}>
                  <div className="mb-0.5 text-[9px] uppercase tracking-wide text-slate-400">{strategy(p, i)}</div>
                  <div className="flex flex-wrap gap-1">
                    {cell.map((s) => (
                      <span key={s.id} title={`${s.name} — ${cap(s.power)} power / ${cap(s.interest)} interest`} className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">{s.name.split(' ')[0]}</span>
                    ))}
                  </div>
                </div>
              );
            }))}
          </div>
          <div className="mt-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">Interest →</div>
        </div>
      </div>
    </div>
  );
}

function Lvl({ v }: { v: InfluenceLevel }) {
  const color = v === 'HIGH' ? 'red' : v === 'MEDIUM' ? 'amber' : 'slate';
  return <Badge color={color}>{cap(v)}</Badge>;
}

function DeleteBtn({ base, id, name, onDone }: { base: string; id: string; name: string; onDone: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const del = useMutation({
    mutationFn: () => api.del(`${base}/${id}`),
    onSuccess: () => { onDone(); toast.success('Stakeholder removed'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to remove'),
  });
  const onClick = async () => {
    if (await confirm({ title: 'Remove stakeholder?', message: <>Remove <strong>{name}</strong> from the register?</>, confirmLabel: 'Remove', danger: true })) del.mutate();
  };
  return <button onClick={onClick} className="text-xs text-red-500 hover:underline">delete</button>;
}

function StakeholderForm({ base, stakeholder, onClose, onDone }: { base: string; stakeholder: Stakeholder | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: stakeholder?.name ?? '',
    role: stakeholder?.role ?? '',
    organization: stakeholder?.organization ?? '',
    category: stakeholder?.category ?? 'OTHER',
    power: stakeholder?.power ?? 'MEDIUM',
    interest: stakeholder?.interest ?? 'MEDIUM',
    currentEngagement: stakeholder?.currentEngagement ?? 'NEUTRAL',
    desiredEngagement: stakeholder?.desiredEngagement ?? 'SUPPORTIVE',
    email: stakeholder?.email ?? '',
    strategy: stakeholder?.strategy ?? '',
    notes: stakeholder?.notes ?? '',
  });
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: f.name.trim(), category: f.category, power: f.power, interest: f.interest,
        currentEngagement: f.currentEngagement, desiredEngagement: f.desiredEngagement,
      };
      if (f.role.trim()) body.role = f.role.trim();
      if (f.organization.trim()) body.organization = f.organization.trim();
      if (f.email.trim()) body.email = f.email.trim();
      if (f.strategy.trim()) body.strategy = f.strategy.trim();
      if (f.notes.trim()) body.notes = f.notes.trim();
      return stakeholder ? api.put(`${base}/${stakeholder.id}`, body) : api.post(base, body);
    },
    onSuccess: () => { toast.success(stakeholder ? 'Stakeholder updated' : 'Stakeholder added'); onDone(); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to save'),
  });

  return (
    <Modal onClose={onClose} title={stakeholder ? `Edit ${stakeholder.code}` : 'Add a stakeholder'} size="lg">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" /></Field>
          <Field label="Role / title"><Input value={f.role} onChange={(e) => set('role', e.target.value)} placeholder="e.g. IT Director" /></Field>
          <Field label="Organization"><Input value={f.organization} onChange={(e) => set('organization', e.target.value)} placeholder="Company / unit" /></Field>
          <Field label="Category">
            <Select value={f.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</Select>
          </Field>
          <Field label="Power (influence)"><Select value={f.power} onChange={(e) => set('power', e.target.value)}>{LEVELS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}</Select></Field>
          <Field label="Interest"><Select value={f.interest} onChange={(e) => set('interest', e.target.value)}>{LEVELS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}</Select></Field>
          <Field label="Current engagement"><Select value={f.currentEngagement} onChange={(e) => set('currentEngagement', e.target.value)}>{ENGAGEMENTS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}</Select></Field>
          <Field label="Desired engagement"><Select value={f.desiredEngagement} onChange={(e) => set('desiredEngagement', e.target.value)}>{ENGAGEMENTS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}</Select></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="name@company.com" /></Field>
        </div>
        <Field label="Engagement strategy" hint="How you'll communicate with / influence this stakeholder."><Textarea rows={2} value={f.strategy} onChange={(e) => set('strategy', e.target.value)} placeholder="Comms cadence, channel, key messages…" /></Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Concerns, expectations…" /></Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!f.name.trim() || save.isPending}>{stakeholder ? 'Save' : 'Add'}</Button>
        </div>
      </div>
    </Modal>
  );
}
