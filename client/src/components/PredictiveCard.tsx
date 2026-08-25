import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Card } from './ui';

// Stage B — deterministic predictive slip/overrun signals from EVM/forecast. Not ML; the label makes
// that honest. Shown on the project Overview.
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
interface RiskSignal { level: RiskLevel; score: number; drivers: string[] }
interface Predictive { hasData: boolean; slip: RiskSignal | null; overrun: RiskSignal | null }

const LEVEL = {
  LOW: { label: 'Low', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', ring: 'border-emerald-200 dark:border-emerald-900/50' },
  MEDIUM: { label: 'Medium', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', ring: 'border-amber-200 dark:border-amber-900/50' },
  HIGH: { label: 'High', bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400', ring: 'border-red-200 dark:border-red-900/50' },
} as const;

function Meter({ title, sig }: { title: string; sig: RiskSignal }) {
  const l = LEVEL[sig.level];
  return (
    <div className={`rounded-lg border ${l.ring} bg-white p-3 dark:bg-slate-900`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</span>
        <span className={`text-sm font-bold ${l.text}`}>{l.label} · {sig.score}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full ${l.bar}`} style={{ width: `${sig.score}%` }} />
      </div>
      <ul className="mt-2 space-y-0.5">
        {sig.drivers.map((d, i) => (
          <li key={i} className="flex gap-1.5 text-xs text-slate-600 dark:text-slate-300"><span aria-hidden className="text-slate-400">•</span><span>{d}</span></li>
        ))}
      </ul>
    </div>
  );
}

export default function PredictiveCard({ projectId }: { projectId: string }) {
  const { data } = useQuery({
    queryKey: ['predictive', projectId],
    queryFn: () => api.get<Predictive>(`/projects/${projectId}/predictive`),
  });
  if (!data) return null;

  return (
    <Card className="!p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Prediction</div>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">EVM trend estimate (heuristic, not ML)</span>
      </div>
      {!data.hasData || !data.slip || !data.overrun ? (
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">Not enough data yet (needs task progress &amp; actual cost) to predict.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Meter title="Schedule-slip risk" sig={data.slip} />
          <Meter title="Cost-overrun risk" sig={data.overrun} />
        </div>
      )}
    </Card>
  );
}
