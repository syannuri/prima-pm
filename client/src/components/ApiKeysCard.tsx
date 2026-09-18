import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Role } from '../api/types';
import { Badge, Button, Field, Input, Select, Spinner } from './ui';
import { SettingsGroup } from './settingsUi';
import { useToast } from './Toast';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  role: Role;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
interface CreatedApiKey extends ApiKey { key: string }

// Roles a key may act as (read-only for now, but the role still scopes what it can read).
const ROLES: Role[] = ['VIEWER', 'TEAM_MEMBER', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'PMO', 'ADMIN'];

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '—');

function keyStatus(k: ApiKey): { label: string; color: string } {
  if (k.revokedAt) return { label: 'Revoked', color: 'red' };
  if (k.expiresAt && new Date(k.expiresAt).getTime() < Date.now()) return { label: 'Expired', color: 'amber' };
  return { label: 'Active', color: 'green' };
}

// Tenant-ADMIN card to manage public REST API keys (T3.2). Create returns the plaintext ONCE — we
// surface it in a copyable banner that stays until dismissed. The API is currently read-only.
export default function ApiKeysCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('VIEWER');
  const [justCreated, setJustCreated] = useState<CreatedApiKey | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get<{ keys: ApiKey[] }>('/api-keys'),
  });

  const create = useMutation({
    mutationFn: () => api.post<CreatedApiKey>('/api-keys', { name: name.trim(), role }),
    onSuccess: (k) => {
      setJustCreated(k);
      setName('');
      setRole('VIEWER');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not create the key'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/api-keys/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['api-keys'] }); toast.success('API key revoked'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not revoke the key'),
  });

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast.success('Copied to clipboard'); }
    catch { toast.error('Could not copy — select and copy manually'); }
  };

  const keys = data?.keys ?? [];

  return (
    <SettingsGroup title="API keys" sub="Programmatic access to your workspace over the REST API. Send the key as an Authorization: Bearer header. Keys are read-only.">

      {/* Show a freshly-created key once, prominently — it can't be retrieved again. */}
      {justCreated && (
        <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-900/20">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Copy your new key now — it won’t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-xs text-slate-800 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700">{justCreated.key}</code>
            <Button type="button" onClick={() => copy(justCreated.key)}>Copy</Button>
          </div>
          <button onClick={() => setJustCreated(null)} className="mt-2 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-300">Done</button>
        </div>
      )}

      {/* Create form */}
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 1) create.mutate(); }}
        className="mt-3 flex flex-wrap items-end gap-2"
      >
        <div className="min-w-[10rem] flex-1">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CI reader" maxLength={80} state={name ? 'valid' : undefined} />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={name.trim().length < 1 || create.isPending}>
          {create.isPending ? 'Creating…' : 'Create key'}
        </Button>
      </form>

      {/* Existing keys */}
      <div className="mt-4">
        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : keys.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">No API keys yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {keys.map((k) => {
              const st = keyStatus(k);
              const active = st.label === 'Active';
              return (
                <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{k.name}</span>
                      <Badge color={st.color}>{st.label}</Badge>
                      <Badge color="slate">{k.role}</Badge>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500 dark:text-slate-400">
                      <code className="font-mono">{k.prefix}…</code>
                      <span>Created {fmtDate(k.createdAt)}</span>
                      <span>Last used {fmtDate(k.lastUsedAt)}</span>
                      {k.expiresAt && <span>Expires {fmtDate(k.expiresAt)}</span>}
                    </div>
                  </div>
                  {active && (
                    <Button type="button" variant="ghost" onClick={() => { if (confirm(`Revoke “${k.name}”? Any client using it will stop working immediately.`)) revoke.mutate(k.id); }} disabled={revoke.isPending}>
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SettingsGroup>
  );
}
