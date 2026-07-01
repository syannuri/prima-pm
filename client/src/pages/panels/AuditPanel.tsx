import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Badge, Card, SectionTitle, Select, Spinner } from '../../components/ui';

interface AuditEntry {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  createdAt: string;
  user: { name: string; role: string } | null;
}

const ACTION_COLOR: Record<string, string> = {
  CREATE: 'green',
  UPDATE: 'amber',
  DELETE: 'red',
  COMMIT: 'indigo',
  APPROVE: 'green',
  REJECT: 'red',
  LOGIN: 'slate',
};
const ACTIONS = ['', 'CREATE', 'UPDATE', 'DELETE', 'COMMIT', 'APPROVE', 'REJECT'];

export default function AuditPanel({ projectId }: { projectId: string }) {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const base = `/projects/${projectId}/audit`;

  const { data, isLoading } = useQuery({
    queryKey: ['audit', projectId, entity, action],
    queryFn: () =>
      api.get<{ entries: AuditEntry[]; entities: string[]; total: number }>(
        `${base}?limit=200${entity ? `&entity=${entity}` : ''}${action ? `&action=${action}` : ''}`,
      ),
  });

  const fmt = (s: string) => new Date(s).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <SectionTitle sub="Immutable trail of who changed what, when (append-only)">
          Audit Log {data?.total ? <span className="ml-1 text-sm font-normal text-slate-500 dark:text-slate-400">· {data.total} changes</span> : null}
        </SectionTitle>
        <div className="flex items-end gap-2">
          <div className="w-44">
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Entity</span>
            <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All entities</option>
              {data?.entities.map((en) => <option key={en} value={en}>{en}</option>)}
            </Select>
          </div>
          <div className="w-36">
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Action</span>
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              {ACTIONS.map((a) => <option key={a} value={a}>{a || 'All actions'}</option>)}
            </Select>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : !data?.entries.length ? (
        <p className="py-4 text-center text-slate-500 dark:text-slate-400">No audit entries match.</p>
      ) : (
        <div className="max-h-[32rem] overflow-auto">
          <table className="prima-rows w-full text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b bg-white text-left text-xs uppercase text-slate-400 dark:bg-slate-900 dark:text-slate-500">
                <th className="py-2">When</th><th>User</th><th>Role</th><th>Entity</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 text-slate-500 dark:text-slate-400">{fmt(e.createdAt)}</td>
                  <td>{e.user?.name ?? '—'}</td>
                  <td className="text-xs text-slate-500 dark:text-slate-400">{e.user?.role ?? '—'}</td>
                  <td className="font-mono text-xs">{e.entity}</td>
                  <td><Badge color={ACTION_COLOR[e.action] ?? 'slate'}>{e.action}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Showing latest {data.entries.length}{entity || action ? ' matching' : ` of ${data.total}`} entries.
          </p>
        </div>
      )}
    </Card>
  );
}
