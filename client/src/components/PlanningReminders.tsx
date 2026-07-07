import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PlanningReminderItem } from '../api/types';
import { Card } from './ui';
import { useAuth } from '../context/AuthContext';

// A ✓/○ chip for one planning artifact. Done = calm green; outstanding = amber "to do";
// n/a (no WBS to baseline) = muted slate so it doesn't read as a gap.
function StepChip({ label, done, na }: { label: string; done: boolean; na?: boolean }) {
  if (na) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        <span>–</span>{label}
      </span>
    );
  }
  return done ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
      <span>✓</span>{label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
      <span>○</span>{label}
    </span>
  );
}

// Dashboard "Set Baseline" reminder panel: still-in-planning projects (owned by the PM,
// or the whole portfolio for ADMIN/PMO) that haven't finished the planning artifacts yet.
// Each row shows which of Charter / Schedule / Cost is still outstanding, so a project
// doesn't quietly stall half-planned. Only rendered when something is incomplete.
export default function PlanningReminders() {
  const { user } = useAuth();
  const canSee = !!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER'].includes(user.role);

  const { data } = useQuery({
    queryKey: ['planning-reminders'],
    queryFn: () => api.get<{ items: PlanningReminderItem[]; count: number }>('/portfolio/planning-reminders'),
    enabled: canSee,
    refetchInterval: 60_000,
  });

  if (!canSee || !data?.count) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-900/10">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-base">📝</span>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Finish planning · Set Baseline ({data.count})</h3>
      </div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        These projects are still in planning. Complete the outstanding steps (Charter · Schedule · Cost) to set the baseline and make them ready to activate.
      </p>
      <ul className="divide-y divide-amber-200/60 dark:divide-amber-900/30">
        {data.items.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <Link to={`/projects/${p.id}`} className="text-sm font-medium text-slate-800 hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-400">{p.name}</Link>
              <div className="text-xs text-slate-500 dark:text-slate-400">{p.code} · PM {p.pm}</div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StepChip label="Charter" done={p.charter} />
              <StepChip label="Schedule" done={p.schedule} na={p.scheduleNa} />
              <StepChip label="Cost" done={p.cost} />
              <Link to={`/projects/${p.id}`} className="ml-1 shrink-0 rounded-lg border border-amber-300 px-3 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/30">
                Open →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
