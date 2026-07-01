import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

interface Alert {
  type: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  tab: 'Schedule' | 'Risk' | 'Cost';
  message: string;
}

const SEV_STYLE: Record<string, string> = {
  HIGH: 'bg-red-50 border-red-200 text-red-700',
  MEDIUM: 'bg-amber-50 border-amber-200 text-amber-700',
  LOW: 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300',
};

export default function ProjectAlerts({ projectId, onJump }: { projectId: string; onJump: (tab: string) => void }) {
  const { data } = useQuery({
    queryKey: ['project-alerts', projectId],
    queryFn: () => api.get<{ alerts: Alert[]; counts: Record<string, number> }>(`/projects/${projectId}/notifications`),
  });

  const alerts = data?.alerts ?? [];
  if (!alerts.length) return null;

  // Show the most severe first, cap to a few in the banner.
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  const sorted = [...alerts].sort((a, b) => order[a.severity] - order[b.severity]);

  return (
    <div className="space-y-1.5">
      {sorted.slice(0, 5).map((a, i) => (
        <button
          key={i}
          onClick={() => onJump(a.tab)}
          className={`flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-sm hover:brightness-95 ${SEV_STYLE[a.severity]}`}
        >
          <span className="text-xs font-bold uppercase">{a.severity}</span>
          <span className="flex-1">{a.message}</span>
          <span className="text-xs opacity-70">→ {a.tab}</span>
        </button>
      ))}
      {sorted.length > 5 && <p className="text-xs text-slate-500 dark:text-slate-400">+ {sorted.length - 5} more alerts</p>}
    </div>
  );
}
