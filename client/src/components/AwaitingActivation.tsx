import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AwaitingActivationItem } from '../api/types';
import { Card } from './ui';
import { useAuth } from '../context/AuthContext';

// PMO/Admin dashboard panel: chartered projects whose baselines are set and are ready to
// activate. Derived from live state (stays listed until the project is activated), so it
// complements the one-time "ready to activate" bell notification. Only rendered for
// ADMIN/PMO and only when something is waiting.
export default function AwaitingActivation() {
  const { user } = useAuth();
  const isGovernor = !!user && ['ADMIN', 'PMO'].includes(user.role);

  const { data } = useQuery({
    queryKey: ['awaiting-activation'],
    queryFn: () => api.get<{ items: AwaitingActivationItem[]; count: number }>('/portfolio/awaiting-activation'),
    enabled: isGovernor,
    refetchInterval: 60_000,
  });

  if (!isGovernor || !data?.count) return null;

  return (
    <Card className="border-brand-200 bg-brand-50/40 dark:border-brand-900/40 dark:bg-brand-900/10">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-base">▶</span>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Ready to activate ({data.count})</h3>
      </div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Baselines are set on these chartered projects — activate them to start execution.</p>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {data.items.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <Link to={`/projects/${p.id}`} className="text-sm font-medium text-slate-800 hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-400">{p.name}</Link>
              <div className="text-xs text-slate-500 dark:text-slate-400">{p.code} · PM {p.pm}</div>
            </div>
            <Link to={`/projects/${p.id}?review=activation`} className="shrink-0 rounded-lg border border-brand-300 px-3 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-100 dark:border-brand-700 dark:text-brand-300 dark:hover:bg-brand-900/30">
              Review →
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
