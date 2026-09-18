import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Spinner } from './ui';
import { SettingsGroup } from './settingsUi';
import { useToast } from './Toast';
import { useLang } from '../context/LanguageContext';

interface FeedbackRow {
  id: string; rating: 'UP' | 'DOWN'; question: string | null; answer: string;
  note: string | null; projectId: string | null; createdAt: string; guidance: string | null;
}

const T = {
  id: {
    sub: 'Workspace-wide — bagaimana Anett dinilai & koreksi 👎 yang menjadi panduan. Untuk audit loop pembelajaran.',
    empty: 'Belum ada umpan balik.', all: 'Semua', up: '👍 Suka', down: '👎 Perbaikan',
    guidance: 'Jadi panduan', loadErr: 'Gagal memuat umpan balik.',
    analyze: '✨ Analisis 👎 → usul panduan', analyzing: 'Menganalisis…', suggestTitle: 'Usulan panduan dari pola 👎',
    noSuggest: 'Belum ada pola yang bisa disuling (butuh beberapa 👎 bercatatan).', adopt: 'Terapkan', adopted: 'Panduan diterapkan', adoptErr: 'Gagal menerapkan',
  },
  en: {
    sub: 'Workspace-wide — how Anett is rated & which 👎 became guidance. For auditing the learning loop.',
    empty: 'No feedback yet.', all: 'All', up: '👍 Up', down: '👎 Fix',
    guidance: 'Became guidance', loadErr: 'Failed to load feedback.',
    analyze: '✨ Analyze 👎 → suggest guidance', analyzing: 'Analyzing…', suggestTitle: 'Guidance suggestions from 👎 patterns',
    noSuggest: 'No distillable pattern yet (needs a few 👎 with notes).', adopt: 'Adopt', adopted: 'Guidance adopted', adoptErr: 'Failed to adopt',
  },
};

// Admin feedback inbox (Fase 4) + auto prompt-improvement (#2): review ratings/guidance AND distill
// recurring 👎 into suggested GUIDANCE the admin can adopt org-wide. Backed by /assistant/feedback/*.
export default function AiFeedbackInboxCard() {
  const { lang } = useLang();
  const t = T[lang];
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'ALL' | 'UP' | 'DOWN'>('ALL');
  const [suggestions, setSuggestions] = useState<{ content: string }[] | null>(null);
  const q = useQuery({
    queryKey: ['assistant-feedback-inbox', filter],
    queryFn: () => api.get<{ feedback: FeedbackRow[]; distillAvailable?: boolean }>(`/assistant/feedback/inbox${filter === 'ALL' ? '' : `?rating=${filter}`}`),
    staleTime: 60_000,
  });
  const rows = q.data?.feedback ?? [];
  const distillAvailable = q.data?.distillAvailable === true;

  const analyze = useMutation({
    mutationFn: () => api.post<{ suggestions: { content: string }[] }>('/assistant/feedback/analyze', {}),
    onSuccess: (r) => setSuggestions(r.suggestions),
  });
  const adopt = useMutation({
    mutationFn: (content: string) => api.post('/assistant/feedback/suggestion', { content }),
    onSuccess: (_r, content) => {
      toast.success(t.adopted);
      setSuggestions((s) => (s ? s.filter((x) => x.content !== content) : s));
      void qc.invalidateQueries({ queryKey: ['ai-memories'] });
    },
    onError: () => toast.error(t.adoptErr),
  });

  return (
    <SettingsGroup title="Umpan balik Anett">
      <p className="text-xs text-slate-500 mb-3">{t.sub}</p>
      <div className="flex gap-1.5 mb-3">
        {(['ALL', 'UP', 'DOWN'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-2.5 py-1 rounded-full border ${filter === f ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
          >
            {f === 'ALL' ? t.all : f === 'UP' ? t.up : t.down}
          </button>
        ))}
      </div>

      {/* #2 Feedback → auto prompt-improvement: distill recurring 👎 into adoptable GUIDANCE. */}
      {distillAvailable && (
        <div className="mb-3">
          <button
            onClick={() => analyze.mutate()}
            disabled={analyze.isPending}
            className="text-xs px-2.5 py-1 rounded-full border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-50"
          >
            {analyze.isPending ? t.analyzing : t.analyze}
          </button>
          {suggestions && (
            <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50/40 p-2.5">
              <p className="text-[11px] font-medium text-violet-800 mb-1.5">{t.suggestTitle}</p>
              {suggestions.length === 0 ? (
                <p className="text-xs text-slate-500 italic">{t.noSuggest}</p>
              ) : (
                <ul className="space-y-1.5">
                  {suggestions.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className="flex-1 text-slate-700">🧠 {s.content}</span>
                      <button
                        onClick={() => adopt.mutate(s.content)}
                        disabled={adopt.isPending}
                        className="shrink-0 px-2 py-0.5 rounded border border-violet-400 text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                      >
                        {t.adopt}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {q.isLoading ? (
        <div className="py-4 flex justify-center"><Spinner /></div>
      ) : q.isError ? (
        <p className="text-xs text-rose-600">{t.loadErr}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-400 italic">{t.empty}</p>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id} className="text-xs border border-slate-200 rounded-lg p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <span className={r.rating === 'UP' ? 'text-emerald-600' : 'text-rose-600'}>{r.rating === 'UP' ? '👍' : '👎'}</span>
                <span className="text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>
              {r.question && <p className="text-slate-500 truncate"><span className="text-slate-400">Q:</span> {r.question}</p>}
              <p className="text-slate-700 line-clamp-2"><span className="text-slate-400">A:</span> {r.answer}</p>
              {r.note && <p className="text-rose-700 mt-1">✏️ {r.note}</p>}
              {r.guidance && <p className="text-violet-700 mt-1">🧠 {t.guidance}: “{r.guidance}”</p>}
            </li>
          ))}
        </ul>
      )}
    </SettingsGroup>
  );
}
