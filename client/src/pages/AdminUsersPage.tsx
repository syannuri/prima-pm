import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { AdminUser, Role } from '../api/types';
import { Badge, Button, Card, Field, Input, Modal, SectionTitle, Select, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/format';

const ROLES: Role[] = ['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER'];

export default function AdminUsersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-users'] });

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ users: AdminUser[] }>('/users'),
    enabled: user?.role === 'ADMIN',
  });

  const [resetFor, setResetFor] = useState<AdminUser | null>(null);
  const [editFor, setEditFor] = useState<AdminUser | null>(null);

  if (user?.role !== 'ADMIN') {
    return (
      <Card>
        <p className="py-6 text-center text-slate-500 dark:text-slate-400">You need the Admin role to manage users.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <SectionTitle sub="Create accounts, set roles, reset passwords, activate/deactivate">User management</SectionTitle>

      <CreateUser onChange={invalidate} />

      <Card>
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="prima-rows w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                  <th className="py-2">Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data?.users.map((u) => (
                  <UserRow key={u.id} u={u} isSelf={u.id === user.id} onChange={invalidate} onReset={() => setResetFor(u)} onEdit={() => setEditFor(u)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />}
      {editFor && <EditUserModal user={editFor} onClose={() => setEditFor(null)} onSaved={invalidate} />}
    </div>
  );
}

function UserRow({ u, isSelf, onChange, onReset, onEdit }: { u: AdminUser; isSelf: boolean; onChange: () => void; onReset: () => void; onEdit: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [err, setErr] = useState('');
  const setRole = useMutation({
    mutationFn: (role: Role) => api.patch(`/users/${u.id}/role`, { role }),
    onSuccess: () => { setErr(''); onChange(); toast.success(`Role updated for ${u.name}`); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });
  const setActive = useMutation({
    mutationFn: (isActive: boolean) => api.patch(`/users/${u.id}/active`, { isActive }),
    onSuccess: (_d, isActive) => { setErr(''); onChange(); toast.success(`${u.name} ${isActive ? 'activated' : 'deactivated'}`); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });
  const toggleActive = async () => {
    if (u.isActive) {
      if (!(await confirm({ title: 'Deactivate user?', message: <>Deactivate <strong>{u.name}</strong>? They will be signed out and unable to log in until reactivated.</>, confirmLabel: 'Deactivate', danger: true }))) return;
    }
    setActive.mutate(!u.isActive);
  };

  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 align-middle">
      <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{u.name}{isSelf && <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">(you)</span>}</td>
      <td className="text-slate-500 dark:text-slate-400">{u.email}</td>
      <td>
        <Select
          value={u.role}
          disabled={isSelf || setRole.isPending}
          title={isSelf ? 'You cannot change your own role' : 'Change role'}
          onChange={(e) => setRole.mutate(e.target.value as Role)}
          className="!py-1 text-xs"
        >
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        {err && <span className="ml-2 text-xs text-red-600">{err}</span>}
      </td>
      <td>
        <Badge color={u.isActive ? 'green' : 'slate'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>
      </td>
      <td className="text-xs text-slate-500 dark:text-slate-400">{formatDate(u.createdAt)}</td>
      <td className="whitespace-nowrap text-right">
        <button onClick={onEdit} className="text-xs text-brand-600 hover:underline">Edit</button>
        <button onClick={onReset} className="ml-3 text-xs text-brand-600 hover:underline">Reset password</button>
        {!isSelf && (
          <button
            onClick={toggleActive}
            disabled={setActive.isPending}
            className={`ml-3 text-xs hover:underline ${u.isActive ? 'text-red-500' : 'text-green-600'}`}
          >
            {u.isActive ? 'Deactivate' : 'Activate'}
          </button>
        )}
      </td>
    </tr>
  );
}

function CreateUser({ onChange }: { onChange: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('VIEWER');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const create = useMutation({
    mutationFn: () => api.post('/users', { name, email, role, password }),
    onSuccess: () => {
      setOk(`Created ${email}`); setErr(''); setName(''); setEmail(''); setPassword(''); setRole('VIEWER'); onChange();
    },
    onError: (e) => { setOk(''); setErr(e instanceof ApiError ? e.message : 'Failed'); },
  });

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Create user</h3>
      <div className="grid gap-2 md:grid-cols-5">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@prismatix.id" /></Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label="Initial password"><Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="10+ chars, letter+number" /></Field>
        <div className="flex items-end">
          <Button className="w-full" disabled={!name || !email || !password || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {ok && <p className="mt-2 text-sm text-green-600">{ok} — share the password; they can change it under “Change password”.</p>}
    </Card>
  );
}

function EditUserModal({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [err, setErr] = useState('');

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const changed = trimmedName !== user.name || trimmedEmail !== user.email;
  const valid = trimmedName.length >= 2 && /.+@.+\..+/.test(trimmedEmail);

  const save = useMutation({
    mutationFn: () => api.patch(`/users/${user.id}/profile`, { name: trimmedName, email: trimmedEmail }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <Modal onClose={onClose} title="Edit user" size="sm">
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Update name and email. Role, status and password are managed separately.</p>
        <div className="space-y-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></Field>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@prismatix.id" /></Field>
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" disabled={!changed || !valid || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const reset = useMutation({
    mutationFn: () => api.patch(`/users/${user.id}/password`, { newPassword: pw }),
    onSuccess: () => { setDone(true); setErr(''); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <Modal onClose={onClose} title="Reset password" size="sm">
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">For <span className="font-medium">{user.name}</span> ({user.email}).</p>
        {done ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Password reset. Share it securely; the user can change it themselves later.</p>
            <Button className="w-full" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="New password">
              <Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="10+ chars, letter+number" />
            </Field>
            {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button className="flex-1" disabled={!pw || reset.isPending} onClick={() => reset.mutate()}>
                {reset.isPending ? 'Saving…' : 'Reset'}
              </Button>
            </div>
          </div>
        )}
    </Modal>
  );
}
