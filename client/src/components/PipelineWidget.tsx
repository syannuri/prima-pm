import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Proposal, ProposalStatus } from '../api/types';
import { Card } from './ui';
import { useAuth } from '../context/AuthContext';
import { formatIdrShort } from '../lib/format';

// Dashboard widget: the intake pipeline at a glance — counts by stage + the top-ranked approved
// ideas awaiting conversion. Any corporate member sees it (self-hides for guests / when empty).
const num = (v: string | null) => (v == null ? 0 : Number(v));
const COUNTS: { s: ProposalStatus; label: string; color: string }[] = [
  { s: 'SUBMITTED', label: 'Submitted', color: 'text-blue-600 dark:text-blue-400' },
  { s: 'UNDER_REVIEW', label: 'Under review', color: 'text-amber-600 dark:text-amber-400' },
  { s: 'APPROVED', label: 'Approved', color: 'text-emerald-600 dark:text-emerald-400' },
];

export default function PipelineWidget() {
  const { user } = useAuth();
  const isGuest = user?.role === 'GUEST';
  const { data } = useQuery({
    queryKey: ['proposals'],
    queryFn: () => api.get<{ proposals: Proposal[] }>('/intake'),
    enabled: !isGuest,
    refetchInterval: 120_000,
  });
  const rows = data?.proposals ?? [];
  const active = rows.filter((p) => !['REJECTED', 'CONVERTED'].includes(p.status));
  if (isGuest || active.length === 0) return null;

  const approved = rows.filter((p) => p.status === 'APPROVED').sort((a, b) => (a.priorityRank ?? 999) - (b.priorityRank ?? 999) || num(b.weightedScore) - num(a.weightedScore));

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">▦</span>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Pipeline ({active.length} active)</h3>
        </div>
        <Link to="/pipeline" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">Open →</Link>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {COUNTS.map((c) => (
          <div key={c.s} className="rounded-lg bg-slate-50 px-2 py-1.5 text-center dark:bg-slate-800/50">
            <div className={`text-lg font-bold ${c.color}`}>{rows.filter((p) => p.status === c.s).length}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">{c.label}</div>
          </div>
        ))}
      </div>
      {approved.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {approved.slice(0, 3).map((p, i) => (
            <li key={p.id} className="flex items-center gap-2 py-1.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-50 text-[11px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{i + 1}</span>
              <Link to="/pipeline" className="min-w-0 flex-1 truncate text-sm text-slate-700 hover:text-brand-600 dark:text-slate-200 dark:hover:text-brand-400">{p.title}</Link>
              <span className="shrink-0 text-xs text-slate-400">{p.estCostIdr ? formatIdrShort(p.estCostIdr) : '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
