import { useRef, useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';

// Portfolio AI assistant — a read-only Q&A over the projects the user can access. Launcher sits
// bottom-LEFT (the DM ChatWidget owns bottom-right). Dormant unless AI is available (env + tenant).
interface Turn { role: 'user' | 'assistant'; content: string }

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
          aria-label="Tanya asisten AI"
          title="Tanya asisten AI"
          className="fixed left-5 z-[60] grid h-14 w-14 place-items-center rounded-full bg-violet-600 text-white shadow-lg shadow-violet-600/30 ring-1 ring-black/5 transition-all duration-300 active:scale-90 bottom-[calc(4.75rem+env(safe-area-inset-bottom)+4rem)] md:bottom-6 md:left-6"
        >
          <span className="text-xl" aria-hidden>✨</span>
        </button>
      )}

      {open && (
        <div className="fixed left-4 z-[70] flex w-[min(92vw,24rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl bottom-[calc(4.75rem+env(safe-area-inset-bottom)+1rem)] md:bottom-6 md:left-6 dark:border-slate-700 dark:bg-slate-900" style={{ maxHeight: 'min(70vh, 32rem)' }}>
          <div className="flex items-center justify-between border-b border-slate-200 bg-violet-50/60 px-3 py-2 dark:border-slate-800 dark:bg-violet-900/15">
            <div className="flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300"><span aria-hidden>✨</span> Asisten AI</div>
            <button onClick={() => setOpen(false)} aria-label="Tutup" className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {turns.length === 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tanya apa saja tentang proyek Anda — mis. “Proyek mana yang paling di belakang jadwal?”, “Risiko tertinggi di AI-1?”, “Berapa CPI proyek X?”. Hanya membaca data (tidak mengubah apa pun).
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${t.role === 'user' ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{t.content}</div>
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
