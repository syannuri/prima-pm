import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PendingApproval } from '../api/types';
import { Badge, Card, EmptyState, SectionTitle, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/format';
import CrDetailModal from '../components/CrDetailModal';

const STATUS_BADGE: Record<string, string> = { SUBMITTED: 'amber', UNDER_REVIEW: 'sky', APPROVED: 'green', REJECTED: 'red' };
const FILTERS = ['ALL', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
const label = (s: string) => s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function ChangeLogPage() {
  const { user } = useAuth();
  const isApprover = !!user && ['ADMIN', 'PMO'].includes(user.role);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');
  const [detail, setDetail] = useState<PendingApproval | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['change-log'],
    queryFn: () => api.get<{ items: PendingApproval[] }>('/notifications/change-log'),
    enabled: isApprover,
  });

  if (!isApprover) {
    return <Card><EmptyState icon="M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" title="PMO access only" hint="The change log is available to Admin and PMO." /></Card>;
  }

  const items = data?.items ?? [];
  const filtered = filter === 'ALL' ? items : items.filter((c) => c.status === filter);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Change Log</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Every change request across the portfolio — status, timeline and details.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = f === 'ALL' ? items.length : items.filter((c) => c.status === f).length;
          return (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${filter === f ? 'border-brand-500 bg-brand-600/10 text-brand-700 dark:text-brand-300' : 'border-slate-200 text-slate-600 hover:border-brand-300 dark:border-slate-700 dark:text-slate-300'}`}>
              {f === 'ALL' ? 'All' : label(f)} <span className="text-slate-400 dark:text-slate-500">{n}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <SectionTitle sub="Click a row's “View” to see the full request and its lifecycle.">Change requests</SectionTitle>
        {isLoading ? <div className="flex justify-center py-8"><Spinner /></div> : !filtered.length ? (
          <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">No change requests{filter !== 'ALL' ? ` with status ${label(filter)}` : ''}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="prima-rows w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-400 dark:text-slate-500">
                  <th className="py-2">Project</th><th>Change request</th><th>Status</th>
                  <th>Requested</th><th>Reviewed</th><th>Decided</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((cr) => (
                  <tr key={cr.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                    <td className="py-2">
                      <Link to={`/projects/${cr.project.id}`} className="font-mono text-xs text-brand-600 hover:underline">{cr.project.code}</Link>
                      <div className="max-w-[10rem] truncate text-xs text-slate-400 dark:text-slate-500">{cr.project.name}</div>
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-700 dark:text-slate-200">{cr.title}</span>
                        <Badge color={cr.magnitude === 'MAJOR' ? 'red' : 'slate'}>{cr.magnitude}</Badge>
                        {cr.chargeable && <Badge color="amber">$</Badge>}
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500">by {cr.requester?.name ?? '—'}</div>
                    </td>
                    <td className="py-2"><Badge color={STATUS_BADGE[cr.status] ?? 'slate'}>{label(cr.status)}</Badge></td>
                    <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{formatDate(cr.createdAt)}</td>
                    <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{cr.reviewedAt ? `${formatDate(cr.reviewedAt)}${cr.reviewer ? ` · ${cr.reviewer.name}` : ''}` : '—'}</td>
                    <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{cr.decidedAt ? `${formatDate(cr.decidedAt)}${cr.decider ? ` · ${cr.decider.name}` : ''}` : '—'}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => setDetail(cr)} className="text-xs font-medium text-brand-600 hover:underline">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {detail && <CrDetailModal cr={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
