import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Badge, Card, SectionTitle, Spinner } from './ui';
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
interface JudgeTrend {
  enabled: boolean;
  sampleRate: number;
  totalSamples: number;
  avgOverall: number;
  passRate: number;
  buckets: TrendBucket[];
  recent: TrendRecent[];
}

const T = {
  id: {
    title: 'Kualitas jawaban Anett',
    sub: 'Skor juri LLM atas sampel jawaban Anett yang sebenarnya (groundedness/kegunaan/kejelasan, 1–5).',
    off: 'Sampling mati. Aktifkan dengan menyetel AI_JUDGE_SAMPLE_RATE (mis. 0.1 = menilai 10% jawaban) lalu restart.',
    empty: 'Belum ada sampel. Muncul setelah Anett menjawab saat sampling aktif.',
    avg: 'Rata-rata', pass: 'Lulus', samples: 'sampel', recent: 'Terbaru',
    dims: 'Grounded / Guna / Jelas',
  },
  en: {
    title: 'AI answer quality',
    sub: "LLM-judge scores over a sample of Anett's real answers (groundedness/helpfulness/clarity, 1–5).",
    off: 'Sampling is off. Turn it on by setting AI_JUDGE_SAMPLE_RATE (e.g. 0.1 = judge 10% of answers) and restarting.',
    empty: 'No samples yet. They appear after Anett answers while sampling is on.',
    avg: 'Average', pass: 'Pass', samples: 'samples', recent: 'Recent',
    dims: 'Grounded / Helpful / Clear',
  },
};

const scoreColor = (v: number): string => (v >= 4 ? 'emerald' : v >= 3 ? 'amber' : 'red');

export default function AiJudgeTrendCard() {
  const { lang } = useLang();
  const t = T[lang];
  const q = useQuery({ queryKey: ['ai-judge-trend'], queryFn: () => api.get<JudgeTrend>('/ai-settings/judge-trend?days=30') });

  const data = q.data;
  const loading = q.isLoading;
  const maxCount = Math.max(1, ...(data?.buckets ?? []).map((b) => b.count));

  return (
    <Card>
      <SectionTitle sub={t.sub}>{t.title}</SectionTitle>
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
    </Card>
  );
}
