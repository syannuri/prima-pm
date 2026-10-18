import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Spinner } from './ui';
import { SettingsGroup } from './settingsUi';
import { useLang } from '../context/LanguageContext';

// Follow-up chip usage (Anett elevation #4). ADMIN/PMO card in Settings → AI. Shows how often the
// follow-up chips under an answer are clicked, broken down by kind (question vs navigational deep-link)
// and origin (model-suggested / citation-derived / static fallback) — so you can see whether the
// contextual chips earn their place. Read-only; counts only (no PII).
interface FollowupStats {
  days: number;
  total: number;
  byKind: Record<string, number>;
  byOrigin: Record<string, number>;
}

const T = {
  id: {
    title: 'Pemakaian chip lanjutan', sub: 'Berapa sering chip saran lanjutan di bawah jawaban Anett diklik (per jenis & asal). Angka 30 hari terakhir.',
    empty: 'Belum ada klik chip lanjutan pada periode ini.', clicks: 'klik', kind: 'Jenis', origin: 'Asal',
    labels: { question: 'Pertanyaan', nav: 'Buka baris (↗)', model: 'Usulan AI', derived: 'Dari sitiran', static: 'Bawaan', nav_cite: 'Tautan sitiran' } as Record<string, string>,
  },
  en: {
    title: 'Follow-up chip usage', sub: "How often the follow-up chips under Anett's answers are clicked (by kind & origin). Last 30 days.",
    empty: 'No follow-up chip clicks in this window yet.', clicks: 'clicks', kind: 'Kind', origin: 'Origin',
    labels: { question: 'Question', nav: 'Open row (↗)', model: 'AI-suggested', derived: 'From citation', static: 'Static', nav_cite: 'Citation link' } as Record<string, string>,
  },
};

export default function AiFollowupStatsCard() {
  const { lang } = useLang();
  const t = T[lang];
  const { data, isLoading } = useQuery({ queryKey: ['ai-followup-stats'], queryFn: () => api.get<FollowupStats>('/ai-settings/followup-stats?days=30') });

  const row = (title: string, counts: Record<string, number>) => {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return (
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{title}</div>
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([k, n]) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {t.labels[k] ?? k}<span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{n}</span>
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <SettingsGroup title={t.title} sub={t.sub}>
      {isLoading ? (
        <div className="py-6"><Spinner /></div>
      ) : !data || data.total === 0 ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t.empty}</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <span className="text-2xl font-semibold tabular-nums text-slate-800 dark:text-slate-100">{data.total}</span>
            <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">{t.clicks}</span>
          </div>
          {row(t.origin, data.byOrigin)}
          {row(t.kind, data.byKind)}
        </div>
      )}
    </SettingsGroup>
  );
}
