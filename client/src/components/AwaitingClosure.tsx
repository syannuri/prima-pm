import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AwaitingClosureItem } from '../api/types';
import { Card } from './ui';
import { useAuth } from '../context/AuthContext';

// A ✓/○ chip showing whether a closeout artifact has been captured. Green = done
// (semantic positive); neutral slate = still outstanding (never decorative coral).
function ArtifactChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ok
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
      }`}
      title={ok ? `${label} captured` : `${label} still pending`}
    >
      {ok ? '✓' : '○'} {label}
    </span>
  );
}

// PMO/Admin dashboard panel: in-progress projects that have met the closure gate (delivery
// complete) and are ready to close. The mirror of AwaitingActivation — it surfaces the
// PM→PMO close handoff the Next-steps guide points at, and shows which closeout artifacts
// (acceptance / lessons) are still outstanding. Derived from live state (stays listed until
// the project is closed). Only rendered for ADMIN/PMO and only when something is waiting.
export default function AwaitingClosure() {
  const { user } = useAuth();
  const isGovernor = !!user && ['ADMIN', 'PMO'].includes(user.role);

  const { data } = useQuery({
    queryKey: ['awaiting-closure'],
    queryFn: () => api.get<{ items: AwaitingClosureItem[]; count: number }>('/portfolio/awaiting-closure'),
    enabled: isGovernor,
    refetchInterval: 60_000,
  });

  if (!isGovernor || !data?.count) return null;

  return (
    <Card className="border-brand-200 bg-brand-50/40 dark:border-brand-900/40 dark:bg-brand-900/10">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-base">🏁</span>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Ready to close ({data.count})</h3>
      </div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Delivery is complete on these projects — run the closure checklist to close them. The chips show which closeout
        artifacts the PM still has outstanding.
      </p>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {data.items.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <Link to={`/projects/${p.id}`} className="text-sm font-medium text-slate-800 hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-400">{p.name}</Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span>{p.code} · PM {p.pm}</span>
                <ArtifactChip ok={p.hasAcceptance} label="Acceptance" />
                <ArtifactChip ok={p.hasLessons} label="Lessons" />
              </div>
            </div>
            <Link to={`/projects/${p.id}`} className="shrink-0 rounded-lg border border-brand-300 px-3 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-100 dark:border-brand-700 dark:text-brand-300 dark:hover:bg-brand-900/30">
              Open →
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
