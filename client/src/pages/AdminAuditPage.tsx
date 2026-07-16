import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AuditEntry, Role } from '../api/types';
import { Badge, Button, Card, Field, SectionTitle, Select, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../lib/format';

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'COMMIT', 'APPROVE', 'REJECT', 'FORCE_CLOSE', 'REOPEN', 'LOGIN', 'PASSWORD_CHANGE'];
const ROLES: Role[] = ['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER', 'GUEST'];

const ROLE_COLOR: Record<string, string> = {
  ADMIN: 'coral', PMO: 'indigo', PROJECT_MANAGER: 'sky', FINANCE: 'green',
  RISK_OFFICER: 'amber', TEAM_MEMBER: 'slate', VIEWER: 'slate', GUEST: 'violet',
};
const ACTION_COLOR: Record<string, string> = {
  CREATE: 'green', UPDATE: 'sky', DELETE: 'red', COMMIT: 'indigo',
  APPROVE: 'green', REJECT: 'red', FORCE_CLOSE: 'amber', REOPEN: 'amber',
};

interface AuditResponse { entries: AuditEntry[]; total: number; limit: number; offset: number }

export default function AdminAuditPage() {
  const { user } = useAuth();
  const [scope, setScope] = useState<'all' | 'personal' | 'corporate'>('all');
  const [action, setAction] = useState('');
  const [role, setRole] = useState('');
  const [limit, setLimit] = useState(50);

  const params = new URLSearchParams({ scope, limit: String(limit) });
  if (action) params.set('action', action);
  if (role) params.set('role', role);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-audit', scope, action, role, limit],
    queryFn: () => api.get<AuditResponse>(`/admin/audit?${params.toString()}`),
    enabled: user?.role === 'ADMIN',
    placeholderData: keepPreviousData,
  });

  if (user?.role !== 'ADMIN') {
    return <Card><p className="py-6 text-center text-slate-500 dark:text-slate-400">You need the Admin role to view the audit trail.</p></Card>;
  }

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-5">
      <SectionTitle sub="Every recorded change across the whole system — corporate and guest activity. Read-only.">Audit trail</SectionTitle>

      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Scope">
            <Select value={scope} onChange={(e) => { setScope(e.target.value as typeof scope); setLimit(50); }}>
              <option value="all">All activity</option>
              <option value="personal">Guest (personal) only</option>
              <option value="corporate">Corporate only</option>
            </Select>
          </Field>
          <Field label="Action">
            <Select value={action} onChange={(e) => { setAction(e.target.value); setLimit(50); }}>
              <option value="">All actions</option>
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </Field>
          <Field label="Actor role">
            <Select value={role} onChange={(e) => { setRole(e.target.value); setLimit(50); }}>
              <option value="">All roles</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {isLoading ? 'Loading…' : `${entries.length} of ${total} event${total === 1 ? '' : 's'}`}
          </h3>
          {isFetching && !isLoading && <Spinner />}
        </div>
        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No audit events match these filters.</p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400 [&>th]:whitespace-nowrap [&>th]:pr-3 [&>th]:py-2">
                    <th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Project</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800 align-middle">
                      <td className="py-2 whitespace-nowrap text-slate-500 dark:text-slate-400">{formatDateTime(e.createdAt)}</td>
                      <td className="whitespace-nowrap">
                        <span className="text-slate-700 dark:text-slate-200">{e.actor?.name ?? '—'}</span>
                        {e.actor && <Badge color={ROLE_COLOR[e.actor.role] ?? 'slate'}>{e.actor.role}</Badge>}
                      </td>
                      <td><Badge color={ACTION_COLOR[e.action] ?? 'slate'}>{e.action}</Badge></td>
                      <td className="text-slate-600 dark:text-slate-300">{e.entity}</td>
                      <td className="whitespace-nowrap">
                        {e.project ? <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{e.project.code}</span> : <span className="text-slate-400">—</span>}
                        {e.personal && <Badge color="violet">guest</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="space-y-2 sm:hidden">
              {entries.map((e) => (
                <div key={e.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <Badge color={ACTION_COLOR[e.action] ?? 'slate'}>{e.action}</Badge>
                    <span className="text-xs text-slate-400">{formatDateTime(e.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-200">
                    {e.entity}{e.project && <span className="ml-1 font-mono text-xs text-slate-500 dark:text-slate-400">· {e.project.code}</span>}
                    {e.personal && <Badge color="violet">guest</Badge>}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {e.actor?.name ?? '—'} {e.actor && <Badge color={ROLE_COLOR[e.actor.role] ?? 'slate'}>{e.actor.role}</Badge>}
                  </p>
                </div>
              ))}
            </div>
            {entries.length < total && (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" disabled={isFetching} onClick={() => setLimit((l) => l + 50)}>
                  {isFetching ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
