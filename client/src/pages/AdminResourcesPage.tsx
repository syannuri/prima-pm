import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { PersonnelRole, RateCard, ResourceItem, ResourceType, User } from '../api/types';
import { Badge, Button, Card, Field, Input, Modal, SectionTitle, Select, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { formatIdr } from '../lib/format';

const PERSONNEL: { value: PersonnelRole; label: string }[] = [
  { value: 'PROJECT_PERSONNEL', label: 'Project Personnel' },
  { value: 'PM', label: 'Project Manager' },
];
const TYPES: { value: ResourceType; label: string }[] = [
  { value: 'NAMED', label: 'Named (a person)' },
  { value: 'GENERIC', label: 'Generic (a role)' },
];

export default function AdminResourcesPage() {
  const { user } = useAuth();
  const allowed = !!user && ['ADMIN', 'PMO', 'FINANCE'].includes(user.role);
  if (!allowed) {
    return (
      <Card>
        <p className="py-6 text-center text-slate-500 dark:text-slate-400">You need the Admin, PMO or Finance role to manage resources.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <SectionTitle sub="Master manpower pool & day-rate catalogue used to load the WBS / Cost module">Resource Pool &amp; rate cards</SectionTitle>
      <RateCardsSection canEditRates={['ADMIN', 'FINANCE'].includes(user!.role)} />
      <ResourcesSection canEdit={['ADMIN', 'PMO'].includes(user!.role)} />
    </div>
  );
}

/* ------------------------------- Rate cards ------------------------------- */
function RateCardsSection({ canEditRates }: { canEditRates: boolean }) {
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['rate-cards-all'] }); qc.invalidateQueries({ queryKey: ['rate-cards'] }); };
  const { data, isLoading } = useQuery({ queryKey: ['rate-cards-all'], queryFn: () => api.get<{ rateCards: RateCard[] }>('/ratecards?all=1') });

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Rate cards</h3>
        <span className="text-xs text-slate-400 dark:text-slate-500">Day-rate per role/level — drives manpower cost</span>
      </div>
      {canEditRates && <AddRateCard onChange={invalidate} />}
      {isLoading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-400 dark:text-slate-500">
                <th className="py-2">Role</th><th>Level</th><th className="text-right">Cost / manday</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data?.rateCards.map((rc) => <RateCardRow key={rc.id} rc={rc} canEdit={canEditRates} onChange={invalidate} />)}
              {!data?.rateCards.length && <tr><td colSpan={5} className="py-3 text-center text-slate-400 dark:text-slate-500">No rate cards yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RateCardRow({ rc, canEdit, onChange }: { rc: RateCard; canEdit: boolean; onChange: () => void }) {
  const toast = useToast();
  const [rate, setRate] = useState(String(rc.unitCostPerManday));
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => api.put(`/ratecards/${rc.id}`, { roleName: rc.roleName, level: rc.level ?? undefined, unitCostPerManday: Number(rate), isActive: rc.isActive }),
    onSuccess: () => { setErr(''); onChange(); toast.success('Rate card updated'); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });
  const toggle = useMutation({
    mutationFn: () => api.patch(`/ratecards/${rc.id}/active`, { isActive: !rc.isActive }),
    onSuccess: onChange,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update rate card'),
  });
  const dirty = Number(rate) !== Number(rc.unitCostPerManday);
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 align-middle">
      <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{rc.roleName}</td>
      <td className="text-slate-500 dark:text-slate-400">{rc.level || '—'}</td>
      <td className="text-right">
        {canEdit ? (
          <div className="flex items-center justify-end gap-1">
            <Input type="number" min={0} value={rate} onChange={(e) => setRate(e.target.value)} className="!w-36 !py-1 text-right text-xs" />
            {dirty && <button onClick={() => save.mutate()} disabled={save.isPending} className="text-xs text-brand-600 hover:underline">Save</button>}
          </div>
        ) : formatIdr(Number(rc.unitCostPerManday))}
        {err && <div className="text-xs text-red-600">{err}</div>}
      </td>
      <td><Badge color={rc.isActive ? 'green' : 'slate'}>{rc.isActive ? 'Active' : 'Inactive'}</Badge></td>
      <td className="text-right">
        {canEdit && (
          <button onClick={() => toggle.mutate()} disabled={toggle.isPending} className={`text-xs hover:underline ${rc.isActive ? 'text-red-500' : 'text-green-600'}`}>
            {rc.isActive ? 'Deactivate' : 'Activate'}
          </button>
        )}
      </td>
    </tr>
  );
}

function AddRateCard({ onChange }: { onChange: () => void }) {
  const [roleName, setRoleName] = useState('');
  const [level, setLevel] = useState('');
  const [rate, setRate] = useState('');
  const [err, setErr] = useState('');
  const create = useMutation({
    mutationFn: () => api.post('/ratecards', { roleName, level: level || undefined, unitCostPerManday: Number(rate) }),
    onSuccess: () => { setErr(''); setRoleName(''); setLevel(''); setRate(''); onChange(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });
  return (
    <div className="mb-3 grid gap-2 sm:grid-cols-4">
      <Field label="Role name"><Input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Backend Engineer" /></Field>
      <Field label="Level (optional)"><Input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="e.g. Senior" /></Field>
      <Field label="Cost / manday (IDR)"><Input type="number" min={0} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 1500000" /></Field>
      <div className="flex items-end">
        <Button className="w-full" disabled={!roleName || !rate || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Adding…' : 'Add rate card'}</Button>
      </div>
      {err && <p className="text-sm text-red-600 sm:col-span-4">{err}</p>}
    </div>
  );
}

/* ------------------------------- Resources -------------------------------- */
function ResourcesSection({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['resources-all'] });
  const { data, isLoading } = useQuery({ queryKey: ['resources-all'], queryFn: () => api.get<{ resources: ResourceItem[] }>('/resources?all=1') });
  const [editing, setEditing] = useState<ResourceItem | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Resource pool</h3>
        {canEdit && <Button onClick={() => setAdding(true)}>+ Add resource</Button>}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-400 dark:text-slate-500">
                <th className="py-2">Name</th><th>Type</th><th>Role</th><th className="text-right">Rate / manday</th><th className="text-right">Cap/day</th><th>Dept</th><th>Login</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data?.resources.map((r) => <ResourceRow key={r.id} r={r} canEdit={canEdit} onEdit={() => setEditing(r)} onChange={invalidate} />)}
              {!data?.resources.length && <tr><td colSpan={9} className="py-3 text-center text-slate-400 dark:text-slate-500">No resources yet. Add your manpower pool to use it in the WBS.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {(adding || editing) && <ResourceModal resource={editing} onClose={() => { setAdding(false); setEditing(null); }} onSaved={() => { invalidate(); setAdding(false); setEditing(null); }} />}
    </Card>
  );
}

function ResourceRow({ r, canEdit, onEdit, onChange }: { r: ResourceItem; canEdit: boolean; onEdit: () => void; onChange: () => void }) {
  const toast = useToast();
  const toggle = useMutation({
    mutationFn: () => api.patch(`/resources/${r.id}/active`, { isActive: !r.isActive }),
    onSuccess: () => { onChange(); toast.success(`${r.name} ${r.isActive ? 'deactivated' : 'activated'}`); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update resource'),
  });
  const refresh = useMutation({
    mutationFn: () => api.post(`/resources/${r.id}/refresh-rate`, {}),
    onSuccess: () => { onChange(); toast.success('Rate refreshed from rate card'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to refresh rate'),
  });
  const rcLabel = r.rateCard ? `${r.rateCard.roleName}${r.rateCard.level ? ` · ${r.rateCard.level}` : ''}` : null;
  // Flag when the stored rate has drifted from the linked rate card's current rate.
  const cardRate = r.rateCard ? Number(r.rateCard.unitCostPerManday) : null;
  const differs = cardRate != null && Math.round(cardRate) !== Math.round(Number(r.unitCostPerManday));
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 align-middle">
      <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{r.name}</td>
      <td><Badge color={r.resourceType === 'NAMED' ? 'indigo' : 'slate'}>{r.resourceType === 'NAMED' ? 'Named' : 'Generic'}</Badge></td>
      <td className="text-slate-500 dark:text-slate-400">{r.roleTitle || (r.personnelRole === 'PM' ? 'Project Manager' : 'Project Personnel')}</td>
      <td className="text-right tabular-nums">
        <span className={differs ? 'text-amber-600 dark:text-amber-400' : ''}>{formatIdr(Number(r.unitCostPerManday))}</span>
        {rcLabel && <div className="text-[10px] text-slate-400 dark:text-slate-500">{rcLabel}</div>}
        {differs && (
          <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10px] text-amber-600 dark:text-amber-400" title={`Linked rate card is now ${formatIdr(cardRate!)}`}>
            <span>≠ card {formatIdr(cardRate!)}</span>
            {canEdit && (
              <button onClick={() => refresh.mutate()} disabled={refresh.isPending} className="rounded bg-amber-100 px-1 font-medium text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200">
                {refresh.isPending ? '…' : '↻ refresh'}
              </button>
            )}
          </div>
        )}
      </td>
      <td className="text-right tabular-nums">{Number(r.capacityPerDay)}</td>
      <td className="text-slate-500 dark:text-slate-400">{r.department || '—'}</td>
      <td className="text-slate-500 dark:text-slate-400">{r.user ? r.user.name : '—'}</td>
      <td><Badge color={r.isActive ? 'green' : 'slate'}>{r.isActive ? 'Active' : 'Inactive'}</Badge></td>
      <td className="whitespace-nowrap text-right">
        {canEdit && (
          <>
            <button onClick={onEdit} className="text-xs text-brand-600 hover:underline">Edit</button>
            <button onClick={() => toggle.mutate()} disabled={toggle.isPending} className={`ml-3 text-xs hover:underline ${r.isActive ? 'text-red-500' : 'text-green-600'}`}>
              {r.isActive ? 'Deactivate' : 'Activate'}
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

function ResourceModal({ resource, onClose, onSaved }: { resource: ResourceItem | null; onClose: () => void; onSaved: () => void }) {
  const editing = !!resource;
  const [name, setName] = useState(resource?.name ?? '');
  const [resourceType, setResourceType] = useState<ResourceType>(resource?.resourceType ?? 'NAMED');
  const [roleTitle, setRoleTitle] = useState(resource?.roleTitle ?? '');
  const [personnelRole, setPersonnelRole] = useState<PersonnelRole>(resource?.personnelRole ?? 'PROJECT_PERSONNEL');
  const [rateCardId, setRateCardId] = useState(resource?.rateCardId ?? '');
  const [unitCost, setUnitCost] = useState(resource ? String(resource.unitCostPerManday) : '');
  const [capacity, setCapacity] = useState(resource ? String(resource.capacityPerDay) : '1');
  const [department, setDepartment] = useState(resource?.department ?? '');
  const [userId, setUserId] = useState(resource?.userId ?? '');
  const [err, setErr] = useState('');

  const rateCardsQ = useQuery({ queryKey: ['rate-cards'], queryFn: () => api.get<{ rateCards: RateCard[] }>('/ratecards') });
  const usersQ = useQuery({ queryKey: ['directory'], queryFn: () => api.get<{ users: User[] }>('/users/directory') });

  const body = () => ({
    name,
    resourceType,
    roleTitle: roleTitle || null,
    personnelRole,
    rateCardId: rateCardId || null,
    unitCostPerManday: unitCost === '' ? undefined : Number(unitCost),
    capacityPerDay: capacity === '' ? undefined : Number(capacity),
    department: department || null,
    userId: userId || null,
  });
  const save = useMutation({
    mutationFn: () => (editing ? api.put(`/resources/${resource!.id}`, body()) : api.post('/resources', body())),
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });

  const pickedRate = rateCardsQ.data?.rateCards.find((rc) => rc.id === rateCardId);

  return (
    <Modal onClose={onClose} title={editing ? 'Edit resource' : 'New resource'} size="lg">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Person or role" /></Field>
          <Field label="Type">
            <Select value={resourceType} onChange={(e) => setResourceType(e.target.value as ResourceType)}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Job title (optional)"><Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="e.g. Backend Engineer" /></Field>
          <Field label="Personnel role">
            <Select value={personnelRole} onChange={(e) => setPersonnelRole(e.target.value as PersonnelRole)}>
              {PERSONNEL.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="Rate card (optional)">
            <Select value={rateCardId} onChange={(e) => { setRateCardId(e.target.value); setUnitCost(''); }}>
              <option value="">— none / custom rate —</option>
              {rateCardsQ.data?.rateCards.map((rc) => <option key={rc.id} value={rc.id}>{rc.roleName}{rc.level ? ` · ${rc.level}` : ''} ({formatIdr(Number(rc.unitCostPerManday))})</option>)}
            </Select>
          </Field>
          <Field label="Cost / manday (IDR)">
            <Input type="number" min={0} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder={pickedRate ? `from rate card: ${formatIdr(Number(pickedRate.unitCostPerManday))}` : 'override / custom'} />
          </Field>
          <Field label="Capacity / day (mandays)"><Input type="number" min={0} step={0.25} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
          <Field label="Department (optional)"><Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Engineering" /></Field>
          <Field label="Link login account (optional)">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">— not linked —</option>
              {usersQ.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </Select>
          </Field>
        </div>
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">Tip: pick a rate card to inherit its day-rate, or leave it blank and enter a custom rate.</p>
        {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{err}</p>}
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={!name || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create resource'}</Button>
        </div>
    </Modal>
  );
}
