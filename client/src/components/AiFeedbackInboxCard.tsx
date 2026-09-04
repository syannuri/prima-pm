import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Card, SectionTitle, Spinner } from './ui';
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
  },
  en: {
    sub: 'Workspace-wide — how Anett is rated & which 👎 became guidance. For auditing the learning loop.',
    empty: 'No feedback yet.', all: 'All', up: '👍 Up', down: '👎 Fix',
    guidance: 'Became guidance', loadErr: 'Failed to load feedback.',
  },
};

// Admin feedback inbox (Fase 4): read-only governance view of Anett ratings + the guidance spawned
// from 👎 notes. Backed by /assistant/feedback/inbox (ADMIN/PMO gated server-side).
export default function AiFeedbackInboxCard() {
  const { lang } = useLang();
  const t = T[lang];
  const [filter, setFilter] = useState<'ALL' | 'UP' | 'DOWN'>('ALL');
  const q = useQuery({
    queryKey: ['assistant-feedback-inbox', filter],
    queryFn: () => api.get<{ feedback: FeedbackRow[] }>(`/assistant/feedback/inbox${filter === 'ALL' ? '' : `?rating=${filter}`}`),
    staleTime: 60_000,
  });
  const rows = q.data?.feedback ?? [];

  return (
    <Card>
      <SectionTitle>Umpan balik Anett</SectionTitle>
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
    </Card>
  );
}
