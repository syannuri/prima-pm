import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface BellData {
  total: number;
  high: number;
  projects: { projectId: string; code: string; name: string; total: number; high: number }[];
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<BellData>('/notifications'),
    refetchInterval: 60_000,
  });

  const total = data?.total ?? 0;
  const high = data?.high ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-lg hover:bg-slate-100 dark:hover:bg-slate-800"
        title="Notifications"
      >
        🔔
        {total > 0 && (
          <span className={`absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-xs font-bold text-white ${high > 0 ? 'bg-red-600' : 'bg-amber-500'}`}>
            {total}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-lg">
            <div className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Alerts {total > 0 && <span className="text-slate-400 dark:text-slate-500">({total}, {high} high)</span>}
            </div>
            {!data?.projects.length ? (
              <p className="py-3 text-center text-sm text-slate-400 dark:text-slate-500">No active alerts 🎉</p>
            ) : (
              <ul className="space-y-1">
                {data.projects.map((p) => (
                  <li key={p.projectId}>
                    <Link
                      to={`/projects/${p.projectId}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="truncate text-sm text-slate-700 dark:text-slate-200">
                        <span className="font-mono text-xs text-slate-400 dark:text-slate-500">{p.code}</span> {p.name}
                      </span>
                      <span className="ml-2 flex shrink-0 gap-1">
                        {p.high > 0 && <span className="rounded-full bg-red-100 px-1.5 text-xs text-red-700">{p.high}</span>}
                        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 text-xs text-slate-600 dark:text-slate-300">{p.total}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
