import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { TenantMember, Role, CustomRole } from '../api/types';
import { Badge, Button, Card, Field, Input, SectionTitle, Select, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import SandboxNotice from '../components/SandboxNotice';
import { formatDate } from '../lib/format';

// The 7 corporate roles a membership can carry (GUEST is a self-service sandbox identity, never a member).
const ROLES: Role[] = ['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER'];

// A role <select> value is either a built-in role, or `custom:<id>` for an org-defined role. This keeps
// both kinds in one dropdown; the parsed value becomes the PATCH/POST payload.
type Assign = { role?: Role; customRoleId?: string | null };
function parseAssign(value: string): Assign {
  return value.startsWith('custom:') ? { customRoleId: value.slice(7) } : { role: value as Role, customRoleId: null };
}
function RoleOptions({ customRoles }: { customRoles: CustomRole[] }) {
  return (
    <>
      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      {customRoles.length > 0 && (
        <optgroup label="Custom roles">
          {customRoles.map((r) => <option key={r.id} value={`custom:${r.id}`}>{r.name} ({r.baseRole})</option>)}
        </optgroup>
      )}
    </>
  );
}

// Tenant-centric membership admin: who belongs to THIS org and with what role. Distinct from
// /admin/users (global identity). Backed by the /members API. ADMIN-only, active tenant.
export default function AdminMembersPage() {
  const { user, tenants, activeTenantId } = useAuth();
  const { lang } = useLang();
  const id = lang === 'id';
  const qc = useQueryClient();
  const activeTenant = tenants.find((t) => t.id === activeTenantId);

  const { data, isLoading } = useQuery({
    queryKey: ['members'],
    queryFn: () => api.get<{ members: TenantMember[] }>('/members'),
    enabled: user?.role === 'ADMIN',
  });
  const customRolesQ = useQuery({
    queryKey: ['custom-roles'],
    queryFn: () => api.get<{ roles: CustomRole[] }>('/custom-roles'),
    enabled: user?.role === 'ADMIN',
  });
  const customRoles = customRolesQ.data?.roles ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['members'] });

  if (user?.role !== 'ADMIN') {
    return <SandboxNotice fallback={<Card><p className="py-6 text-center text-slate-500 dark:text-slate-400">{id ? 'Butuh peran Admin untuk mengelola anggota.' : 'You need the Admin role to manage members.'}</p></Card>} />;
  }

  return (
    <div className="space-y-5">
      <SectionTitle sub={activeTenant ? (id ? `Anggota organisasi “${activeTenant.name}”` : `Members of “${activeTenant.name}”`) : (id ? 'Anggota organisasi aktif' : 'Members of the active tenant')}>
        {id ? 'Anggota' : 'Members'}
      </SectionTitle>

      <AddMember customRoles={customRoles} onChange={invalidate} />

      <Card>
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : !data?.members.length ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{id ? 'Belum ada anggota.' : 'No members yet.'}</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="prima-rows w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                    <th className="py-2">{id ? 'Nama' : 'Name'}</th><th>Email</th><th>{id ? 'Peran' : 'Role'}</th><th>{id ? 'Status' : 'Status'}</th><th>{id ? 'Sejak' : 'Since'}</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => <MemberRow key={m.id} m={m} isSelf={m.id === user.id} customRoles={customRoles} onChange={invalidate} />)}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 sm:hidden">
              {data.members.map((m) => <MemberCard key={m.id} m={m} isSelf={m.id === user.id} customRoles={customRoles} onChange={invalidate} />)}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// Shared role/remove mutations for a member.
function useMemberActions(m: TenantMember, onChange: () => void) {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const confirm = useConfirm();
  const setRole = useMutation({
    mutationFn: (assign: Assign) => api.patch(`/members/${m.id}`, assign),
    onSuccess: () => { onChange(); toast.success(id ? `Peran ${m.name} diperbarui` : `Role updated for ${m.name}`); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/members/${m.id}`),
    onSuccess: () => { onChange(); toast.success(id ? `${m.name} dikeluarkan` : `${m.name} removed`); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const askRemove = async () => {
    if (await confirm({
      title: id ? 'Keluarkan anggota?' : 'Remove member?',
      message: id ? <>Keluarkan <strong>{m.name}</strong> dari organisasi ini? Akun mereka tetap ada — hanya keanggotaan di sini yang dicabut.</> : <>Remove <strong>{m.name}</strong> from this organization? Their account stays — only their membership here is revoked.</>,
      confirmLabel: id ? 'Keluarkan' : 'Remove',
      danger: true,
    })) remove.mutate();
  };
  return { setRole, remove, askRemove };
}

function MemberRow({ m, isSelf, customRoles, onChange }: { m: TenantMember; isSelf: boolean; customRoles: CustomRole[]; onChange: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const { setRole, remove, askRemove } = useMemberActions(m, onChange);
  return (
    <tr className="border-b last:border-0 dark:border-slate-800">
      <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{m.name}{isSelf && <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">({id ? 'Anda' : 'you'})</span>}</td>
      <td className="text-slate-500 dark:text-slate-400">{m.email}</td>
      <td>
        <Select value={m.customRoleId ? `custom:${m.customRoleId}` : m.role} disabled={isSelf} onChange={(e) => setRole.mutate(parseAssign(e.target.value))} className="w-44">
          <RoleOptions customRoles={customRoles} />
        </Select>
      </td>
      <td><Badge color={m.isActive ? 'green' : 'slate'}>{m.isActive ? (id ? 'Aktif' : 'Active') : (id ? 'Nonaktif' : 'Inactive')}</Badge></td>
      <td className="text-slate-500 dark:text-slate-400">{formatDate(m.since)}</td>
      <td className="text-right">
        {!isSelf && <Button variant="ghost" onClick={askRemove} disabled={remove.isPending} className="text-red-600 dark:text-red-400">{id ? 'Keluarkan' : 'Remove'}</Button>}
      </td>
    </tr>
  );
}

function MemberCard({ m, isSelf, customRoles, onChange }: { m: TenantMember; isSelf: boolean; customRoles: CustomRole[]; onChange: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const { setRole, remove, askRemove } = useMemberActions(m, onChange);
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-700 dark:text-slate-200">{m.name}{isSelf && <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">({id ? 'Anda' : 'you'})</span>}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{m.email}</p>
        </div>
        <Badge color={m.isActive ? 'green' : 'slate'}>{m.isActive ? (id ? 'Aktif' : 'Active') : (id ? 'Nonaktif' : 'Inactive')}</Badge>
      </div>
      <div className="mt-2 grid grid-cols-2 items-end gap-3 border-t border-slate-100 pt-2 dark:border-slate-800">
        <div>
          <span className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{id ? 'Peran' : 'Role'}</span>
          <Select value={m.customRoleId ? `custom:${m.customRoleId}` : m.role} disabled={isSelf} onChange={(e) => setRole.mutate(parseAssign(e.target.value))} className="mt-1">
            <RoleOptions customRoles={customRoles} />
          </Select>
        </div>
        <div className="text-right">
          {!isSelf && <Button variant="ghost" onClick={askRemove} disabled={remove.isPending} className="text-red-600 dark:text-red-400">{id ? 'Keluarkan' : 'Remove'}</Button>}
        </div>
      </div>
    </div>
  );
}

// Add an existing user (by email) to the active tenant with a role (built-in or custom).
function AddMember({ customRoles, onChange }: { customRoles: CustomRole[]; onChange: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [assignValue, setAssignValue] = useState<string>('VIEWER');
  const add = useMutation({
    mutationFn: () => api.post('/members', { email: email.trim().toLowerCase(), ...parseAssign(assignValue) }),
    onSuccess: () => { setEmail(''); setAssignValue('VIEWER'); onChange(); toast.success(id ? 'Anggota ditambahkan' : 'Member added'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to add member'),
  });
  const canSubmit = /.+@.+\..+/.test(email.trim());
  return (
    <Card>
      <SectionTitle sub={id ? 'Tambahkan pengguna yang sudah punya akun ke organisasi ini' : 'Add an existing account to this organization'}>{id ? 'Tambah anggota' : 'Add member'}</SectionTitle>
      <form className="mt-3 grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (canSubmit) add.mutate(); }}>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" />
        </Field>
        <Field label={id ? 'Peran' : 'Role'}>
          <Select value={assignValue} onChange={(e) => setAssignValue(e.target.value)}>
            <RoleOptions customRoles={customRoles} />
          </Select>
        </Field>
        <Button type="submit" disabled={!canSubmit || add.isPending}>{add.isPending ? (id ? 'Menambah…' : 'Adding…') : (id ? 'Tambah' : 'Add')}</Button>
      </form>
    </Card>
  );
}
