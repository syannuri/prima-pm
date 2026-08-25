import { useRef, useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Markdown } from '../lib/markdown';

// Portfolio AI assistant — a read-only Q&A over the projects the user can access. Launcher sits
// bottom-RIGHT, stacked directly ABOVE the DM ChatWidget bubble (which owns the very corner).
// Dormant unless AI is available (env + tenant). Persona: "Anett AI".
interface Turn { role: 'user' | 'assistant'; content: string }

// Anett's mark — a "bot" glyph (Lucide-style stroke SVG), matching the ChatWidget icon convention.
// Deliberately distinct from the DM bubble below it and the old ✨.
function AnettIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

export default function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const availQ = useQuery({
    queryKey: ['assistant-available'],
    queryFn: () => api.get<{ aiAvailable: boolean }>(`/assistant/available`),
    staleTime: 5 * 60_000,
  });

  const ask = useMutation({
    mutationFn: (history: Turn[]) => api.post<{ answer: string }>(`/assistant/ask`, { messages: history.slice(-12) }),
    onSuccess: (res) => setTurns((t) => [...t, { role: 'assistant', content: res.answer }]),
    onError: (e) => setTurns((t) => [...t, { role: 'assistant', content: `⚠️ ${e instanceof ApiError ? e.message : 'AI tidak dapat menjawab saat ini.'}` }]),
  });

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [turns, ask.isPending]);

  if (!availQ.data?.aiAvailable) return null;

  const send = () => {
    const q = input.trim();
    if (!q || ask.isPending) return;
    const next: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns(next);
    setInput('');
    ask.mutate(next);
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Tanya Anett AI"
          title="Tanya Anett AI"
          className="fixed right-5 z-[60] grid h-14 w-14 place-items-center rounded-full bg-violet-600 text-white shadow-lg shadow-violet-600/30 ring-1 ring-black/5 transition-all duration-300 active:scale-90 bottom-[calc(4.75rem+env(safe-area-inset-bottom)+8.5rem)] md:bottom-24 md:right-6"
        >
          <AnettIcon className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div className="fixed right-4 z-[70] flex w-[min(92vw,24rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl bottom-[calc(4.75rem+env(safe-area-inset-bottom)+1rem)] md:bottom-6 md:right-6 dark:border-slate-700 dark:bg-slate-900" style={{ maxHeight: 'min(70vh, 32rem)' }}>
          <div className="flex items-center justify-between border-b border-slate-200 bg-violet-50/60 px-3 py-2 dark:border-slate-800 dark:bg-violet-900/15">
            <div className="flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300"><AnettIcon className="h-4 w-4" /> Anett AI</div>
            <button onClick={() => setOpen(false)} aria-label="Tutup" className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {turns.length === 0 && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                <p className="text-slate-600 dark:text-slate-300">
                  Hallo, saya <span className="font-semibold text-violet-600 dark:text-violet-300">Anett</span>. Saya siap membantu perjalanan proyek Anda.
                </p>
                <p className="mt-1.5">
                  Tanya apa saja, mis. “Proyek mana yang paling di belakang jadwal?”, “Risiko tertinggi di <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-slate-800">AI-1</code>?”, “Berapa CPI proyek X?”. Hanya membaca data (tidak mengubah apa pun).
                </p>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${t.role === 'user' ? 'whitespace-pre-wrap bg-violet-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                  {t.role === 'assistant' ? <Markdown text={t.content} className="text-sm" /> : t.content}
                </div>
              </div>
            ))}
            {ask.isPending && <div className="flex justify-start"><div className="rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">Menganalisa…</div></div>}
          </div>

          <div className="border-t border-slate-200 p-2 dark:border-slate-800">
            <div className="flex items-end gap-2">
              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Tulis pertanyaan…"
                className="max-h-24 min-h-[2.25rem] flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button onClick={send} disabled={!input.trim() || ask.isPending} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-600 text-white transition disabled:opacity-40" aria-label="Kirim">➤</button>
            </div>
            <p className="mt-1 px-1 text-[10px] text-slate-400 dark:text-slate-500">Read-only · hasil AI bisa keliru — verifikasi angka penting.</p>
          </div>
        </div>
      )}
    </>
  );
}
