import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

// A compact "what needs me" strip at the top of the dashboard — summarises the action
// queues (approvals · to baseline · to activate · to close) as count chips so attention
// leads the page. The detailed queue cards still render below as the drill-down. Reuses
// the queues' query keys, so react-query dedupes and no extra fetches happen.
export default function ActionCenter() {
  const { user } = useAuth();
  const role = user?.role;
  const isGovernor = role === 'ADMIN' || role === 'PMO';
  const canPlan = isGovernor || role === 'PROJECT_MANAGER';

  const approvals = useQuery({ queryKey: ['pending-approvals'], queryFn: () => api.get<{ count: number }>('/notifications/pending-approvals'), enabled: isGovernor });
  const planning = useQuery({ queryKey: ['planning-reminders'], queryFn: () => api.get<{ count: number }>('/portfolio/planning-reminders'), enabled: canPlan });
  const activation = useQuery({ queryKey: ['awaiting-activation'], queryFn: () => api.get<{ count: number }>('/portfolio/awaiting-activation'), enabled: isGovernor });
  const closure = useQuery({ queryKey: ['awaiting-closure'], queryFn: () => api.get<{ count: number }>('/portfolio/awaiting-closure'), enabled: isGovernor });

  const chips = [
    { key: 'approvals', label: 'to approve', icon: '🗳️', count: approvals.data?.count ?? 0, show: isGovernor },
    { key: 'planning', label: 'to baseline', icon: '📝', count: planning.data?.count ?? 0, show: canPlan },
    { key: 'activation', label: 'to activate', icon: '▶', count: activation.data?.count ?? 0, show: isGovernor },
    { key: 'closure', label: 'to close', icon: '🏁', count: closure.data?.count ?? 0, show: isGovernor },
  ].filter((c) => c.show && c.count > 0);

  if (!chips.length) {
    // Only the roles that own these queues get the affirmation; others see nothing.
    if (!canPlan) return null;
    const loading = approvals.isLoading || planning.isLoading || activation.isLoading || closure.isLoading;
    if (loading) return null; // don't flash "all clear" before the counts arrive
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-2 text-sm font-medium text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/15 dark:text-emerald-300">
        <span aria-hidden>✓</span> All caught up — nothing needs your attention right now.
      </div>
    );
  }
  const total = chips.reduce((s, c) => s + c.count, 0);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 dark:border-amber-800/50 dark:bg-amber-900/15">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-200">
        <span aria-hidden>⚡</span> Needs attention
        <span className="rounded-full bg-amber-200 px-2 text-xs font-bold text-amber-900 dark:bg-amber-800 dark:text-amber-100">{total}</span>
      </span>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <span key={c.key} className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-amber-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-amber-800/50">
            <span aria-hidden>{c.icon}</span><span className="font-bold tabular-nums">{c.count}</span> {c.label}
          </span>
        ))}
      </div>
      <span className="ml-auto text-[11px] text-amber-700/70 dark:text-amber-300/60">details below ↓</span>
    </div>
  );
}
