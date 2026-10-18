import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Badge, Spinner } from './ui';
import { SettingsGroup } from './settingsUi';
import { useLang } from '../context/LanguageContext';

// Quality-trend dashboard (#5): the LLM judge's scores over a SAMPLE of real Anett answers, so an admin
// can watch answer quality over time. Dormant until AI_JUDGE_SAMPLE_RATE is set — the empty state says
// so. Read-only; the backend samples + scores in the background (no cost unless armed).
interface TrendBucket {
  date: string;
  count: number;
  avgOverall: number;
  passRate: number;
  avgGroundedness: number;
  avgHelpfulness: number;
  avgClarity: number;
}
interface TrendRecent {
  question: string;
  overall: number;
  pass: boolean;
  rationale: string;
  createdAt: string;
}
interface FeatureStat {
  feature: string;
  count: number;
  avgOverall: number;
  passRate: number;
  avgGroundedness: number;
  avgHelpfulness: number;
  avgClarity: number;
}
interface JudgeTrend {
  enabled: boolean;
  sampleRate: number;
  feature: string | null;
  totalSamples: number;
  avgOverall: number;
  passRate: number;
  buckets: TrendBucket[];
  byFeature: FeatureStat[];
  recent: TrendRecent[];
}

// Friendly display names for the AiUsage feature labels (keys match the server's AiFeature strings).
const FEATURE_LABELS: Record<string, string> = {
  assistant_qa: 'Chat (Anett)',
  narrative: 'Status narrative',
  proactive: 'Briefings',
  review: 'Project review',
  evm_explain: 'EVM explainer',
  cr_impact: 'CR impact',
  risk_suggest: 'Risk suggestions',
  schedule_suggest: 'Schedule / WBS',
  whatif: 'What-if',
  resource_realloc: 'Resource realloc',
  portfolio_qa: 'Portfolio Q&A',
};
const featureLabel = (f: string): string => FEATURE_LABELS[f] ?? f;

const T = {
  id: {
    title: 'Kualitas jawaban Anett',
    sub: 'Skor juri LLM atas sampel jawaban Anett yang sebenarnya (groundedness/kegunaan/kejelasan, 1–5).',
    off: 'Sampling mati. Aktifkan dengan menyetel AI_JUDGE_SAMPLE_RATE (mis. 0.1 = menilai 10% jawaban) lalu restart.',
    empty: 'Belum ada sampel. Muncul setelah Anett menjawab saat sampling aktif.',
    avg: 'Rata-rata', pass: 'Lulus', samples: 'sampel', recent: 'Terbaru',
    dims: 'Grounded / Guna / Jelas',
    byFeature: 'Per fitur', all: 'Semua fitur',
  },
  en: {
    title: 'AI answer quality',
    sub: "LLM-judge scores over a sample of Anett's real answers (groundedness/helpfulness/clarity, 1–5).",
    off: 'Sampling is off. Turn it on by setting AI_JUDGE_SAMPLE_RATE (e.g. 0.1 = judge 10% of answers) and restarting.',
    empty: 'No samples yet. They appear after Anett answers while sampling is on.',
    avg: 'Average', pass: 'Pass', samples: 'samples', recent: 'Recent',
    dims: 'Grounded / Helpful / Clear',
    byFeature: 'By feature', all: 'All features',
  },
};

const scoreColor = (v: number): string => (v >= 4 ? 'emerald' : v >= 3 ? 'amber' : 'red');

export default function AiJudgeTrendCard() {
  const { lang } = useLang();
  const t = T[lang];
  // Active feature filter (null = all). Buckets/headline/recent scope to it; the by-feature list below
  // is always the full breakdown (server computes it over every feature regardless of the filter).
  const [feature, setFeature] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['ai-judge-trend', feature],
    queryFn: () => api.get<JudgeTrend>(`/ai-settings/judge-trend?days=30${feature ? `&feature=${encodeURIComponent(feature)}` : ''}`),
  });

  const data = q.data;
  const loading = q.isLoading;
  const maxCount = Math.max(1, ...(data?.buckets ?? []).map((b) => b.count));

  return (
    <SettingsGroup title={t.title} sub={t.sub}>
      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : !data || data.totalSamples === 0 ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{data && !data.enabled ? t.off : t.empty}</p>
      ) : (
        <div className="mt-3 space-y-4">
          {/* Headline: window average, pass rate, sample count. */}
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <div>
              <span className="text-2xl font-semibold tabular-nums text-slate-800 dark:text-slate-100">{data.avgOverall.toFixed(2)}</span>
              <span className="text-sm text-slate-400"> / 5</span>
              <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">{t.avg}</span>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-200">{Math.round(data.passRate * 100)}%</span> {t.pass}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{data.totalSamples} {t.samples}</div>
          </div>

          {/* Daily avg-overall bars (height ∝ score/5). Title carries the exact numbers. */}
          <div className="flex h-16 items-end gap-1">
            {data.buckets.map((b) => (
              <div
                key={b.date}
                className="flex-1 rounded-t bg-gradient-to-t from-violet-500 to-fuchsia-400"
                style={{ height: `${(b.avgOverall / 5) * 100}%`, opacity: 0.5 + 0.5 * (b.count / maxCount) }}
                title={`${b.date}: ${b.avgOverall.toFixed(2)}/5 · ${Math.round(b.passRate * 100)}% ${t.pass} · ${b.count} ${t.samples} (${t.dims}: ${b.avgGroundedness.toFixed(1)}/${b.avgHelpfulness.toFixed(1)}/${b.avgClarity.toFixed(1)})`}
              />
            ))}
          </div>

          {/* Per-feature breakdown — doubles as the filter: click a row to scope the bars/headline/recent
              above to that surface, click "All features" to reset. Always shows every sampled feature. */}
          {data.byFeature.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{t.byFeature}</div>
              <ul className="space-y-0.5">
                <li>
                  <button
                    onClick={() => setFeature(null)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-xs transition ${feature === null ? 'bg-violet-50 font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/50'}`}
                  >
                    <span>{t.all}</span>
                    <span className="tabular-nums text-slate-400">{data.byFeature.reduce((n, f) => n + f.count, 0)}</span>
                  </button>
                </li>
                {data.byFeature.map((f) => (
                  <li key={f.feature}>
                    <button
                      onClick={() => setFeature(f.feature)}
                      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-xs transition ${feature === f.feature ? 'bg-violet-50 font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50'}`}
                      title={`${t.dims}: ${f.avgGroundedness.toFixed(1)}/${f.avgHelpfulness.toFixed(1)}/${f.avgClarity.toFixed(1)}`}
                    >
                      <span className="min-w-0 flex-1 truncate text-left">{featureLabel(f.feature)}</span>
                      <span className="shrink-0 text-slate-400">{Math.round(f.passRate * 100)}% · {f.count}</span>
                      <Badge color={scoreColor(f.avgOverall)}>{f.avgOverall.toFixed(1)}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recent judged answers with rationale. */}
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{t.recent}</div>
            <ul className="space-y-1.5">
              {data.recent.map((r, i) => (
                <li key={i} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{r.question}</span>
                    <Badge color={scoreColor(r.overall)}>{r.overall.toFixed(1)}</Badge>
                  </div>
                  <p className="truncate text-[11px] italic text-slate-400 dark:text-slate-500">{r.rationale}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </SettingsGroup>
  );
}
