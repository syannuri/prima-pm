import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Badge, Card, SectionTitle, Spinner } from './ui';
import { useLang } from '../context/LanguageContext';

// Outcome learning — the workspace track record of APPLIED AI actions. For each scored action type
// (schedule-movers) it shows how often SPI improved after the action, plus a few recent measured
// outcomes. Correlational, NOT causal — stated plainly. Read-only; deterministic backend.
interface ActionStat {
  actionType: string;
  measured: number;
  improved: number;
  unchanged: number;
  worsened: number;
  improvedRate: number | null; // null below the sample floor
  avgSpiDelta: number | null;
}
interface RecentOutcome {
  id: string;
  actionType: string;
  verdict: 'IMPROVED' | 'UNCHANGED' | 'WORSENED';
  spiDelta: number | null;
  measuredAt: string | null;
  project: { code: string; name: string };
}

const ACTION_LABEL: Record<string, { id: string; en: string }> = {
  TIDY_SCHEDULE: { id: 'Rapikan jadwal', en: 'Tidy schedule' },
  UPDATE_TASK_PROGRESS: { id: 'Update progres', en: 'Update progress' },
};
const VERDICT_COLOR: Record<string, string> = { IMPROVED: 'emerald', UNCHANGED: 'slate', WORSENED: 'red' };

const T = {
  id: {
    sub: 'Rekam jejak aksi AI yang pernah diterapkan — seberapa sering SPI membaik sesudahnya.',
    title: 'Hasil aksi AI',
    caveat: 'Korelasional, bukan sebab-akibat — banyak faktor menggerakkan SPI. Diukur ~21 hari setelah aksi diterapkan.',
    empty: 'Belum ada hasil terukur. Muncul setelah aksi AI yang disetujui melewati horizon 21 hari.',
    nSamples: (n: number) => `${n} terukur`,
    improved: 'membaik', recent: 'Terbaru', floor: 'sampel belum cukup',
  },
  en: {
    sub: 'Track record of applied AI actions — how often SPI improved afterwards.',
    title: 'AI action outcomes',
    caveat: 'Correlational, not causal — many factors move SPI. Measured ~21 days after an action is applied.',
    empty: 'No measured outcomes yet. They appear after an approved AI action passes its 21-day horizon.',
    nSamples: (n: number) => `${n} measured`,
    improved: 'improved', recent: 'Recent', floor: 'not enough samples',
  },
};

function fmtDelta(d: number | null): string {
  if (d == null) return '—';
  return `${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
}

export default function AiActionOutcomesCard() {
  const { lang } = useLang();
  const t = T[lang];
  const statsQ = useQuery({ queryKey: ['ai-action-outcomes'], queryFn: () => api.get<{ stats: ActionStat[] }>('/ai-settings/action-outcomes') });
  const recentQ = useQuery({ queryKey: ['ai-action-outcomes-recent'], queryFn: () => api.get<{ outcomes: RecentOutcome[] }>('/ai-settings/action-outcomes/recent?take=8') });

  const label = (a: string) => ACTION_LABEL[a]?.[lang] ?? a;
  const stats = statsQ.data?.stats ?? [];
  const recent = recentQ.data?.outcomes ?? [];
  const loading = statsQ.isLoading || recentQ.isLoading;
  const empty = !loading && stats.length === 0 && recent.length === 0;

  return (
    <Card>
      <SectionTitle sub={t.sub}>{t.title}</SectionTitle>
      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : empty ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t.empty}</p>
      ) : (
        <div className="mt-3 space-y-4">
          {/* Per-action improved-rate bars. */}
          <div className="space-y-2.5">
            {stats.map((s) => {
              const pct = s.improvedRate == null ? null : Math.round(s.improvedRate * 100);
              return (
                <div key={s.actionType}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{label(s.actionType)}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {pct == null ? <em>{t.floor}</em> : <><span className="font-semibold text-emerald-600 dark:text-emerald-400">{pct}% {t.improved}</span> · {t.nSamples(s.measured)}</>}
                    </span>
                  </div>
                  <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    {/* Improved / unchanged / worsened split. */}
                    <div className="h-full bg-emerald-500" style={{ width: `${(s.improved / Math.max(1, s.measured)) * 100}%` }} />
                    <div className="h-full bg-slate-300 dark:bg-slate-600" style={{ width: `${(s.unchanged / Math.max(1, s.measured)) * 100}%` }} />
                    <div className="h-full bg-red-500" style={{ width: `${(s.worsened / Math.max(1, s.measured)) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recent measured outcomes. */}
          {recent.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{t.recent}</div>
              <ul className="space-y-1">
                {recent.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                      <span className="font-mono text-slate-400">{o.project.code}</span> · {label(o.actionType)}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">ΔSPI {fmtDelta(o.spiDelta)}</span>
                    <Badge color={VERDICT_COLOR[o.verdict]}>{o.verdict}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">{t.caveat}</p>
        </div>
      )}
    </Card>
  );
}
