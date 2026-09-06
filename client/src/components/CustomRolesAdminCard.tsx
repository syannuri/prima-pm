import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CustomRole, Role } from '../api/types';
import { Button, Card, Field, Input, SectionTitle } from './ui';
import { useToast } from './Toast';

// Tenant-ADMIN builder for the org's custom role catalog (Tier-3). A custom role gives a workspace-specific
// NAME to one built-in base role, whose permissions it inherits. Members are assigned custom roles on the
// Members page; enforcement always uses the base role.
const BASE_ROLES: Role[] = ['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER'];

export default function CustomRolesAdminCard() {
  const toast = useToast();
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [baseRole, setBaseRole] = useState<Role>('TEAM_MEMBER');
  const [description, setDescription] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ roles: CustomRole[] }>('/custom-roles');
      setRoles(res.roles);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not load roles');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/custom-roles', { name: name.trim(), baseRole, description: description.trim() || undefined });
      setName(''); setBaseRole('TEAM_MEMBER'); setDescription('');
      toast.success('Custom role added');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not add the role');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: CustomRole) => {
    if (!confirm(`Delete the "${r.name}" role? Members keep their underlying ${r.baseRole} access; they just lose the label.`)) return;
    try {
      await api.del(`/custom-roles/${r.id}`);
      toast.success('Role deleted');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not delete the role');
    }
  };

  const selectClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <Card>
      <SectionTitle sub="Give your organization's own names to roles (e.g. “Delivery Lead”, “Auditor”). Each maps to a built-in permission level; assign them to members on the Members page.">
        Custom roles
      </SectionTitle>

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : roles.length === 0 ? (
          <p className="text-sm text-slate-500">No custom roles yet. Add one below.</p>
        ) : (
          roles.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
              <span className="font-medium text-slate-800 dark:text-slate-100">{r.name}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">acts as {r.baseRole}</span>
              {r.description && <span className="truncate text-xs text-slate-400">{r.description}</span>}
              <button onClick={() => remove(r)} className="ml-auto text-xs font-medium text-red-500 hover:text-red-600">Delete</button>
            </div>
          ))
        )}
      </div>

      <div className="mt-5 space-y-3 rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-600">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Add a role</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Delivery Lead" /></Field>
          <Field label="Acts as (permissions)">
            <select className={selectClass} value={baseRole} onChange={(e) => setBaseRole(e.target.value as Role)}>
              {BASE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Description (optional)"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role is for" /></Field>
        <div className="flex justify-end">
          <Button type="button" onClick={add} disabled={busy || !name.trim()}>{busy ? 'Adding…' : 'Add role'}</Button>
        </div>
      </div>
    </Card>
  );
}
