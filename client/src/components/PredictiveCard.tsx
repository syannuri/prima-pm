import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Button, Card } from './ui';
import { KpiIcon } from './KpiIcon';
import { useToast } from './Toast';

// Stage B — deterministic predictive slip/overrun signals from EVM/forecast. Not ML; the label makes
// that honest. Shown on the project Overview.
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
interface RiskSignal { level: RiskLevel; score: number; drivers: string[] }
interface Predictive { hasData: boolean; slip: RiskSignal | null; overrun: RiskSignal | null }

const LEVEL = {
  LOW: { label: 'Low', bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', ring: 'border-emerald-200 dark:border-emerald-900/50' },
  MEDIUM: { label: 'Medium', bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', ring: 'border-amber-200 dark:border-amber-900/50' },
  HIGH: { label: 'High', bar: 'bg-red-500', text: 'text-red-700 dark:text-red-300', ring: 'border-red-200 dark:border-red-900/50' },
} as const;

function Meter({ title, sig }: { title: string; sig: RiskSignal }) {
  const l = LEVEL[sig.level];
  return (
    <div className={`rounded-lg border ${l.ring} bg-white p-3 dark:bg-slate-900`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">{title}</span>
        <span className={`text-sm font-bold ${l.text}`}>{l.label} · {sig.score}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full ${l.bar}`} style={{ width: `${sig.score}%` }} />
      </div>
      <ul className="mt-2 space-y-0.5">
        {sig.drivers.map((d, i) => (
          <li key={i} className="flex gap-1.5 text-xs text-slate-700 dark:text-slate-200"><span aria-hidden className="text-slate-400">•</span><span>{d}</span></li>
        ))}
      </ul>
    </div>
  );
}

const SCORE_BY_LEVEL: Record<RiskLevel, number> = { LOW: 2, MEDIUM: 3, HIGH: 4 };

export default function PredictiveCard({ projectId }: { projectId: string }) {
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ['predictive', projectId],
    queryFn: () => api.get<Predictive>(`/projects/${projectId}/predictive`),
  });
  // Stage C — whether the AI may propose actions (env + tenant opt-in). Drives the propose footer.
  const { data: avail } = useQuery({
    queryKey: ['ai-actions-available', projectId],
    queryFn: () => api.get<{ aiActionsAvailable: boolean }>(`/projects/${projectId}/ai-actions/available`),
  });

  const propose = useMutation({
    mutationFn: (body: { actionType: string; params: unknown; rationale: string }) =>
      api.post(`/projects/${projectId}/ai-actions/propose`, body),
    onSuccess: () => toast.success('Action proposed for approval — runs only after it is approved.'),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to propose action.'),
  });

  if (!data) return null;

  const canPropose = avail?.aiActionsAvailable === true && data.hasData;
  const slipHot = !!data.slip && data.slip.level !== 'LOW';
  const overrunHot = !!data.overrun && data.overrun.level !== 'LOW';

  return (
    <Card className="!p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><KpiIcon name="activity" accent="indigo" className="h-6 w-6" />Prediction</h3>
        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">EVM trend estimate (heuristic, not ML)</span>
      </div>
      {!data.hasData || !data.slip || !data.overrun ? (
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">Not enough data yet (needs task progress &amp; actual cost) to predict.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Meter title="Schedule-slip risk" sig={data.slip} />
          <Meter title="Cost-overrun risk" sig={data.overrun} />
        </div>
      )}

      {/* Stage C — turn a signal into an AI-proposed action; it only runs after human approval. */}
      {canPropose && (slipHot || overrunHot) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">🤖 Propose action:</span>
          {slipHot && data.slip && (
            <Button variant="secondary" className="!px-2 !py-1 !text-xs" disabled={propose.isPending}
              onClick={() => propose.mutate({ actionType: 'TIDY_SCHEDULE', params: { mode: 'push' }, rationale: `Slip risk ${LEVEL[data.slip!.level].label}: ${data.slip!.drivers.join('; ')}` })}>
              Tidy schedule
            </Button>
          )}
          {overrunHot && data.overrun && (
            <Button variant="secondary" className="!px-2 !py-1 !text-xs" disabled={propose.isPending}
              onClick={() => propose.mutate({ actionType: 'CREATE_RISK', rationale: `Overrun risk ${LEVEL[data.overrun!.level].label}`,
                params: { title: 'Potential cost overrun (from predictive signal)', description: data.overrun!.drivers.join('; '), kind: 'THREAT', probabilityScore: SCORE_BY_LEVEL[data.overrun!.level], impactScore: SCORE_BY_LEVEL[data.overrun!.level] } })}>
              Log overrun risk
            </Button>
          )}
          <span className="text-[10px] text-slate-400 dark:text-slate-500">needs approval</span>
        </div>
      )}
    </Card>
  );
}
