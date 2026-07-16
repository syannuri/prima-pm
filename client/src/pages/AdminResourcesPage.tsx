import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { PersonnelRole, RateCard, ResourceItem, ResourceType, User } from '../api/types';
import { Badge, Button, Card, Field, Input, Modal, SectionTitle, Select, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { formatIdr, formatIdrInput } from '../lib/format';
import { fieldState } from '../lib/formValidation';

const isPositiveNum = (v: string) => v.trim() !== '' && Number(v) > 0;

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
  // A guest manages their OWN private pool (fully editable); corporate roles manage the shared
  // corporate pool. The server scopes every read/write by owner, so the two never mix.
  const isGuest = user?.role === 'GUEST';
  const allowed = !!user && (isGuest || ['ADMIN', 'PMO', 'FINANCE'].includes(user.role));
  if (!allowed) {
    return (
      <Card>
        <p className="py-6 text-center text-slate-500 dark:text-slate-400">You need the Admin, PMO or Finance role to manage resources.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <SectionTitle sub={isGuest
        ? 'Your private manpower pool & day-rates — used to load your projects’ WBS / Cost. Not shared with anyone.'
        : 'Master manpower pool & day-rate catalogue used to load the WBS / Cost module'}>
        {isGuest ? 'My Resource Pool & rate cards' : 'Resource Pool & rate cards'}
      </SectionTitle>
      <RateCardsSection canEditRates={isGuest || ['ADMIN', 'FINANCE'].includes(user!.role)} />
      <ResourcesSection canEdit={isGuest || ['ADMIN', 'PMO'].includes(user!.role)} />
    </div>
  );
}

/* ------------------------------- Rate cards ------------------------------- */
function RateCardsSection({ canEditRates }: { canEditRates: boolean }) {
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['rate-cards-all'] }); qc.invalidateQueries({ queryKey: ['rate-cards'] }); };
  const { data, isLoading } = useQuery({ queryKey: ['rate-cards-all'], queryFn: () => api.get<{ rateCards: RateCard[] }>('/ratecards?all=1') });
  const [editing, setEditing] = useState<RateCard | null>(null);

  return (
    <Card>
      <div className="mb-3 flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Rate cards</h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">Day-rate per role/level — drives manpower cost</span>
      </div>
      {canEditRates && <AddRateCard onChange={invalidate} />}
      {isLoading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <>
          {/* Desktop: full table. Mobile: stacked cards so the day-rate never gets clipped off-screen. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400 [&>th]:whitespace-nowrap [&>th]:pr-3">
                  <th className="py-2">Role</th><th>Level</th><th className="text-right">Cost / manday</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data?.rateCards.map((rc) => <RateCardRow key={rc.id} rc={rc} canEdit={canEditRates} onEdit={() => setEditing(rc)} onChange={invalidate} />)}
                {!data?.rateCards.length && <tr><td colSpan={5} className="py-3 text-center text-slate-500 dark:text-slate-400">No rate cards yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 sm:hidden">
            {data?.rateCards.map((rc) => <RateCardCard key={rc.id} rc={rc} canEdit={canEditRates} onEdit={() => setEditing(rc)} onChange={invalidate} />)}
            {!data?.rateCards.length && <p className="py-3 text-center text-sm text-slate-500 dark:text-slate-400">No rate cards yet.</p>}
          </div>
        </>
      )}
      {editing && <RateCardModal rc={editing} onClose={() => setEditing(null)} onSaved={() => { invalidate(); setEditing(null); }} />}
    </Card>
  );
}

// Shared activate + delete logic for a rate card (full edit lives in RateCardModal), used by both
// the desktop row and mobile card.
function useRateCardActions(rc: RateCard, onChange: () => void) {
  const toast = useToast();
  const confirm = useConfirm();
  const toggle = useMutation({
    mutationFn: () => api.patch(`/ratecards/${rc.id}/active`, { isActive: !rc.isActive }),
    onSuccess: onChange,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update rate card'),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/ratecards/${rc.id}`),
    onSuccess: () => { onChange(); toast.success('Rate card deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete rate card'),
  });
  const askDelete = async () => {
    const label = `${rc.roleName}${rc.level ? ` · ${rc.level}` : ''}`;
    if (await confirm({ title: 'Delete rate card?', message: `Permanently delete "${label}"? A card already linked to resources or cost lines can't be deleted — deactivate it instead.`, confirmLabel: 'Delete' })) del.mutate();
  };
  return { toggle, del, askDelete };
}

function RateCardCard({ rc, canEdit, onEdit, onChange }: { rc: RateCard; canEdit: boolean; onEdit: () => void; onChange: () => void }) {
  const { toggle, del, askDelete } = useRateCardActions(rc, onChange);
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-700 dark:text-slate-200">{rc.roleName}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{rc.level || 'No level'}</p>
        </div>
        <Badge color={rc.isActive ? 'green' : 'slate'}>{rc.isActive ? 'Active' : 'Inactive'}</Badge>
      </div>
      <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
        <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Cost / manday</p>
        <p className="mt-0.5 font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatIdr(Number(rc.unitCostPerManday))}</p>
      </div>
      {canEdit && (
        <div className="mt-2 flex justify-end gap-4 border-t border-slate-100 pt-2 dark:border-slate-800">
          <button onClick={onEdit} className="text-xs font-medium text-brand-600 hover:underline">Edit</button>
          <button onClick={() => toggle.mutate()} disabled={toggle.isPending} className={`text-xs font-medium hover:underline ${rc.isActive ? 'text-amber-600' : 'text-green-600'}`}>
            {rc.isActive ? 'Deactivate' : 'Activate'}
          </button>
          <button onClick={askDelete} disabled={del.isPending} className="text-xs font-medium text-red-500 hover:underline disabled:opacity-40">Delete</button>
        </div>
      )}
    </div>
  );
}

function RateCardRow({ rc, canEdit, onEdit, onChange }: { rc: RateCard; canEdit: boolean; onEdit: () => void; onChange: () => void }) {
  const { toggle, del, askDelete } = useRateCardActions(rc, onChange);
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 align-middle">
      <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{rc.roleName}</td>
      <td className="text-slate-500 dark:text-slate-400">{rc.level || '—'}</td>
      <td className="text-right tabular-nums">{formatIdr(Number(rc.unitCostPerManday))}</td>
      <td><Badge color={rc.isActive ? 'green' : 'slate'}>{rc.isActive ? 'Active' : 'Inactive'}</Badge></td>
      <td className="whitespace-nowrap text-right">
        {canEdit && (
          <>
            <button onClick={onEdit} className="text-xs text-brand-600 hover:underline">Edit</button>
            <button onClick={() => toggle.mutate()} disabled={toggle.isPending} className={`ml-3 text-xs hover:underline ${rc.isActive ? 'text-amber-600' : 'text-green-600'}`}>
              {rc.isActive ? 'Deactivate' : 'Activate'}
            </button>
            <button onClick={askDelete} disabled={del.isPending} className="ml-3 text-xs text-red-500 hover:underline disabled:opacity-40">Delete</button>
          </>
        )}
      </td>
    </tr>
  );
}

// Edit an existing rate card (role, level, day-rate). Add uses the inline AddRateCard form.
function RateCardModal({ rc, onClose, onSaved }: { rc: RateCard; onClose: () => void; onSaved: () => void }) {
  const [roleName, setRoleName] = useState(rc.roleName);
  const [level, setLevel] = useState(rc.level ?? '');
  const [rate, setRate] = useState(String(rc.unitCostPerManday));
  const [err, setErr] = useState('');
  const roleOk = roleName.trim().length >= 2;
  const rateOk = isPositiveNum(rate);
  const save = useMutation({
    mutationFn: () => api.put(`/ratecards/${rc.id}`, { roleName: roleName.trim(), level: level.trim() || undefined, unitCostPerManday: Number(rate), isActive: rc.isActive }),
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to save'),
  });
  return (
    <Modal onClose={onClose} title="Edit rate card">
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <Field label="Role name">
          <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Backend Engineer" state={fieldState(!!roleName, roleOk)} />
          {!!roleName && !roleOk && <span className="mt-1 block text-xs text-red-500">At least 2 characters</span>}
        </Field>
        <Field label="Level (optional)"><Input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="e.g. Senior" /></Field>
        <Field label="Cost / manday (IDR)">
          <Input inputMode="numeric" value={formatIdrInput(rate)} onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} state={fieldState(!!rate, rateOk)} />
          {!!rate && !rateOk && <span className="mt-1 block text-xs text-red-500">Must be greater than 0</span>}
        </Field>
      </div>
      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{err}</p>}
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button className="flex-1" disabled={!roleOk || !rateOk || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </Modal>
  );
}

function AddRateCard({ onChange }: { onChange: () => void }) {
  const [roleName, setRoleName] = useState('');
  const [level, setLevel] = useState('');
  const [rate, setRate] = useState('');
  const [err, setErr] = useState('');
  const roleOk = roleName.trim().length >= 2;
  const rateOk = isPositiveNum(rate);
  const create = useMutation({
    mutationFn: () => api.post('/ratecards', { roleName, level: level || undefined, unitCostPerManday: Number(rate) }),
    onSuccess: () => { setErr(''); setRoleName(''); setLevel(''); setRate(''); onChange(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });
  return (
    <div className="mb-3 grid items-start gap-2 sm:grid-cols-4">
      <Field label="Role name">
        <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Backend Engineer" state={fieldState(!!roleName, roleOk)} />
        {!!roleName && !roleOk && <span className="mt-1 block text-xs text-red-500">At least 2 characters</span>}
      </Field>
      <Field label="Level (optional)"><Input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="e.g. Senior" /></Field>
      <Field label="Cost / manday (IDR)">
        <Input inputMode="numeric" value={formatIdrInput(rate)} onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} placeholder="e.g. Rp 1.500.000" state={fieldState(!!rate, rateOk)} />
        {!!rate && !rateOk && <span className="mt-1 block text-xs text-red-500">Must be greater than 0</span>}
      </Field>
      <div className="flex items-end pt-6">
        <Button className="w-full" disabled={!roleOk || !rateOk || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Adding…' : 'Add rate card'}</Button>
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
      <div className="mb-3 flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Resource pool</h3>
        {canEdit && <Button onClick={() => setAdding(true)}>+ Add resource</Button>}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <>
          {/* Desktop: full table. Mobile: stacked cards so the rate/capacity columns never get clipped off-screen. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400 [&>th]:whitespace-nowrap [&>th]:pr-3">
                  <th className="py-2">Name</th><th>Type</th><th>Role</th><th className="text-right">Rate / manday</th><th className="text-right">Cap/day</th><th>Dept</th><th>Login</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data?.resources.map((r) => <ResourceRow key={r.id} r={r} canEdit={canEdit} onEdit={() => setEditing(r)} onChange={invalidate} />)}
                {!data?.resources.length && <tr><td colSpan={9} className="py-3 text-center text-slate-500 dark:text-slate-400">No resources yet. Add your manpower pool to use it in the WBS.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 sm:hidden">
            {data?.resources.map((r) => <ResourceCard key={r.id} r={r} canEdit={canEdit} onEdit={() => setEditing(r)} onChange={invalidate} />)}
            {!data?.resources.length && <p className="py-3 text-center text-sm text-slate-500 dark:text-slate-400">No resources yet. Add your manpower pool to use it in the WBS.</p>}
          </div>
        </>
      )}
      {(adding || editing) && <ResourceModal resource={editing} onClose={() => { setAdding(false); setEditing(null); }} onSaved={() => { invalidate(); setAdding(false); setEditing(null); }} />}
    </Card>
  );
}

// Shared activate/refresh-rate logic + rate-drift flags for a resource, used by both the desktop row and mobile card.
function useResourceActions(r: ResourceItem, onChange: () => void) {
  const toast = useToast();
  const confirm = useConfirm();
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
  const del = useMutation({
    mutationFn: () => api.del(`/resources/${r.id}`),
    onSuccess: () => { onChange(); toast.success(`${r.name} deleted`); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete resource'),
  });
  const askDelete = async () => {
    if (await confirm({ title: 'Delete resource?', message: `Permanently delete "${r.name}"? A resource already used by a project can't be deleted — deactivate it instead.`, confirmLabel: 'Delete' })) del.mutate();
  };
  const rcLabel = r.rateCard ? `${r.rateCard.roleName}${r.rateCard.level ? ` · ${r.rateCard.level}` : ''}` : null;
  // Flag when the stored rate has drifted from the linked rate card's current rate.
  const cardRate = r.rateCard ? Number(r.rateCard.unitCostPerManday) : null;
  const differs = cardRate != null && Math.round(cardRate) !== Math.round(Number(r.unitCostPerManday));
  return { toggle, refresh, del, askDelete, rcLabel, cardRate, differs };
}

function ResourceCard({ r, canEdit, onEdit, onChange }: { r: ResourceItem; canEdit: boolean; onEdit: () => void; onChange: () => void }) {
  const { toggle, refresh, del, askDelete, rcLabel, cardRate, differs } = useResourceActions(r, onChange);
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-700 dark:text-slate-200">{r.name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{r.roleTitle || (r.personnelRole === 'PM' ? 'Project Manager' : 'Project Personnel')}</p>
        </div>
        <Badge color={r.resourceType === 'NAMED' ? 'indigo' : 'slate'}>{r.resourceType === 'NAMED' ? 'Named' : 'Generic'}</Badge>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
        <div className="col-span-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Rate / manday</dt>
          <dd className="tabular-nums">
            <span className={differs ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}>{formatIdr(Number(r.unitCostPerManday))}</span>
            {rcLabel && <span className="ml-1 text-[10px] text-slate-500 dark:text-slate-400">· {rcLabel}</span>}
            {differs && (
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                <span>≠ card {formatIdr(cardRate!)}</span>
                {canEdit && (
                  <button onClick={() => refresh.mutate()} disabled={refresh.isPending} className="rounded bg-amber-100 px-1 font-medium text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200">
                    {refresh.isPending ? '…' : '↻ refresh'}
                  </button>
                )}
              </div>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Cap / day</dt>
          <dd className="tabular-nums text-slate-700 dark:text-slate-200">{Number(r.capacityPerDay)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Department</dt>
          <dd className="text-slate-600 dark:text-slate-300">{r.department || '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Login</dt>
          <dd className="truncate text-slate-600 dark:text-slate-300">{r.user ? r.user.name : '—'}</dd>
        </div>
      </dl>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
        <Badge color={r.isActive ? 'green' : 'slate'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>
        {canEdit && (
          <div className="flex gap-4">
            <button onClick={onEdit} className="text-xs font-medium text-brand-600 hover:underline">Edit</button>
            <button onClick={() => toggle.mutate()} disabled={toggle.isPending} className={`text-xs font-medium hover:underline ${r.isActive ? 'text-amber-600' : 'text-green-600'}`}>
              {r.isActive ? 'Deactivate' : 'Activate'}
            </button>
            <button onClick={askDelete} disabled={del.isPending} className="text-xs font-medium text-red-500 hover:underline disabled:opacity-40">Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResourceRow({ r, canEdit, onEdit, onChange }: { r: ResourceItem; canEdit: boolean; onEdit: () => void; onChange: () => void }) {
  const { toggle, refresh, del, askDelete, rcLabel, cardRate, differs } = useResourceActions(r, onChange);
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 align-middle">
      <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{r.name}</td>
      <td><Badge color={r.resourceType === 'NAMED' ? 'indigo' : 'slate'}>{r.resourceType === 'NAMED' ? 'Named' : 'Generic'}</Badge></td>
      <td className="text-slate-500 dark:text-slate-400">{r.roleTitle || (r.personnelRole === 'PM' ? 'Project Manager' : 'Project Personnel')}</td>
      <td className="text-right tabular-nums">
        <span className={differs ? 'text-amber-600 dark:text-amber-400' : ''}>{formatIdr(Number(r.unitCostPerManday))}</span>
        {rcLabel && <div className="text-[10px] text-slate-500 dark:text-slate-400">{rcLabel}</div>}
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
            <button onClick={() => toggle.mutate()} disabled={toggle.isPending} className={`ml-3 text-xs hover:underline ${r.isActive ? 'text-amber-600' : 'text-green-600'}`}>
              {r.isActive ? 'Deactivate' : 'Activate'}
            </button>
            <button onClick={askDelete} disabled={del.isPending} className="ml-3 text-xs text-red-500 hover:underline disabled:opacity-40">Delete</button>
          </>
        )}
      </td>
    </tr>
  );
}

function ResourceModal({ resource, onClose, onSaved }: { resource: ResourceItem | null; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const isGuest = user?.role === 'GUEST'; // a guest's private resource never links a login account
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
  // The corporate user directory is off-limits to a guest — don't even fetch it.
  const usersQ = useQuery({ queryKey: ['directory'], queryFn: () => api.get<{ users: User[] }>('/users/directory'), enabled: !isGuest });

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

  const nameOk = name.trim().length >= 1 && name.trim().length <= 160;
  const capacityOk = isPositiveNum(capacity) && Number(capacity) <= 100;
  // Cost is optional (a rate card can supply it); if typed, it must be a non-negative number.
  const costOk = unitCost.trim() === '' || (Number.isFinite(Number(unitCost)) && Number(unitCost) >= 0);
  const allValid = nameOk && capacityOk && costOk;

  return (
    <Modal onClose={onClose} title={editing ? 'Edit resource' : 'New resource'} size="lg">
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Person or role" state={fieldState(!!name, nameOk)} />
            {!!name && !nameOk && <span className="mt-1 block text-xs text-red-500">Required (max 160 characters)</span>}
          </Field>
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
            <Input inputMode="numeric" value={formatIdrInput(unitCost)} onChange={(e) => setUnitCost(e.target.value.replace(/\D/g, ''))} placeholder={pickedRate ? `from rate card: ${formatIdr(Number(pickedRate.unitCostPerManday))}` : 'override / custom'} state={fieldState(unitCost.trim() !== '', costOk)} />
            {unitCost.trim() !== '' && !costOk && <span className="mt-1 block text-xs text-red-500">Must be 0 or more</span>}
          </Field>
          <Field label="Capacity / day (mandays)">
            <Input type="number" min={0} step={0.25} value={capacity} onChange={(e) => setCapacity(e.target.value)} state={fieldState(!!capacity, capacityOk)} />
            {!!capacity && !capacityOk && <span className="mt-1 block text-xs text-red-500">Between 0 and 100</span>}
          </Field>
          <Field label="Department (optional)"><Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Engineering" /></Field>
          {!isGuest && (
            <Field label="Link login account (optional)">
              <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">— not linked —</option>
                {usersQ.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </Select>
            </Field>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Tip: pick a rate card to inherit its day-rate, or leave it blank and enter a custom rate.</p>
        {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{err}</p>}
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={!allValid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create resource'}</Button>
        </div>
    </Modal>
  );
}
