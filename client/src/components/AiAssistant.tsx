import { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Markdown } from '../lib/markdown';

// Portfolio AI assistant — Q&A over the projects the user can access, and (Stage C) able to PROPOSE
// actions that a human approves. Launcher sits bottom-RIGHT, stacked ABOVE the DM ChatWidget bubble.
// Dormant unless AI is available (env + tenant). Persona: "Anett".
interface ProposedRef { actionType: string; projectCode: string; routed: boolean }
interface Turn { role: 'user' | 'assistant'; content: string; proposals?: ProposedRef[] }

// Human labels for the whitelisted Stage C actions (used on the inline "proposed" card).
const ACTION_LABELS: Record<string, string> = {
  CREATE_RISK: 'Tambah risiko',
  UPDATE_TASK_PROGRESS: 'Update progress tugas',
  CREATE_CHANGE_REQUEST: 'Draft change request',
  TIDY_SCHEDULE: 'Rapikan jadwal',
};

// Anett's mark — a "bot" glyph (Lucide-style stroke SVG).
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

// A gradient amethyst avatar disc — Anett's face, reused by launcher, header and message rows.
function AnettAvatar({ className = 'h-8 w-8', icon = 'h-4 w-4' }: { className?: string; icon?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-sm ${className}`}>
      <AnettIcon className={icon} />
    </span>
  );
}

// Animated three-dot "typing" bubble.
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Anett sedang mengetik">
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 dark:bg-slate-500" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

export default function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false); // drives the open transition (mount → next frame → in)
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const availQ = useQuery({
    queryKey: ['assistant-available'],
    queryFn: () => api.get<{ aiAvailable: boolean; actionsAvailable: boolean }>(`/assistant/available`),
    staleTime: 5 * 60_000,
  });
  const canPropose = availQ.data?.actionsAvailable === true;

  const ask = useMutation({
    mutationFn: (history: Turn[]) => api.post<{ answer: string; proposals: ProposedRef[] }>(`/assistant/ask`, { messages: history.slice(-12).map(({ role, content }) => ({ role, content })) }),
    onSuccess: (res) => setTurns((t) => [...t, { role: 'assistant', content: res.answer, proposals: res.proposals?.length ? res.proposals : undefined }]),
    onError: (e) => setTurns((t) => [...t, { role: 'assistant', content: `⚠️ ${e instanceof ApiError ? e.message : 'AI tidak dapat menjawab saat ini.'}` }]),
  });

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [turns, ask.isPending]);

  // Open transition + focus the input; Escape closes.
  useEffect(() => {
    if (!open) { setShown(false); return; }
    const raf = requestAnimationFrame(() => setShown(true));
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!availQ.data?.aiAvailable) return null;

  const sendText = (text: string) => {
    const q = text.trim();
    if (!q || ask.isPending) return;
    const next: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns(next);
    setInput('');
    ask.mutate(next);
  };

  // Contextual starter chips — the action chip only when Stage C propose is available.
  const chips = [
    'Proyek mana yang paling di belakang jadwal?',
    'Ringkas kesehatan portofolio saya',
    ...(canPropose ? ['Usulkan mitigasi untuk proyek paling berisiko'] : ['Apa risiko tertinggi di proyek saya?']),
  ];

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Tanya Anett"
          title="Tanya Anett"
          className="fixed right-5 z-[60] grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-lg shadow-violet-600/30 ring-1 ring-black/5 transition-all duration-300 hover:scale-105 active:scale-90 bottom-[calc(4.75rem+env(safe-area-inset-bottom)+8.5rem)] md:bottom-24 md:right-6"
        >
          <AnettIcon className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Asisten Anett"
          className={`fixed right-4 z-[70] flex w-[min(92vw,25rem)] origin-bottom-right flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-200 ease-out bottom-[calc(4.75rem+env(safe-area-inset-bottom)+1rem)] md:bottom-6 md:right-6 dark:border-slate-700 dark:bg-slate-900 ${shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-95 opacity-0'}`}
          style={{ maxHeight: 'min(72vh, 34rem)' }}
        >
          {/* Header — gradient identity band with avatar + status */}
          <div className="flex items-center gap-2.5 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-fuchsia-50 px-3 py-2.5 dark:border-slate-800 dark:from-violet-900/20 dark:to-fuchsia-900/10">
            <AnettAvatar className="h-9 w-9" icon="h-5 w-5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Anett</div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> Asisten PMO · {canPropose ? 'baca + usul aksi' : 'membaca data proyek'}
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Tutup" className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800">✕</button>
          </div>

          <div ref={scrollRef} aria-live="polite" className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {turns.length === 0 && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <AnettAvatar />
                  <div className="rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    Halo, saya <span className="font-semibold text-violet-600 dark:text-violet-300">Anett</span>. Saya bantu memantau proyek Anda{canPropose ? ' — dan bisa mengusulkan aksi (perlu persetujuan)' : ''}.
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <button
                      key={c}
                      onClick={() => sendText(c)}
                      className="rounded-full border border-violet-200 bg-violet-50/60 px-3 py-1.5 text-left text-xs text-violet-700 transition hover:bg-violet-100 dark:border-violet-800/60 dark:bg-violet-900/20 dark:text-violet-300 dark:hover:bg-violet-900/40"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) => (
              <div key={i}>
                <div className={`flex gap-2 ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {t.role === 'assistant' && <AnettAvatar />}
                  <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm ${t.role === 'user' ? 'whitespace-pre-wrap rounded-tr-sm bg-violet-600 text-white' : 'rounded-tl-sm bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                    {t.role === 'assistant' ? <Markdown text={t.content} className="text-sm" /> : t.content}
                  </div>
                </div>
                {/* Stage C — inline card when Anett staged action proposals this turn */}
                {t.proposals && t.proposals.length > 0 && (
                  <div className="ml-10 mt-1.5 rounded-xl border border-violet-200 bg-violet-50/70 p-2.5 text-xs dark:border-violet-800/60 dark:bg-violet-900/20">
                    <div className="mb-1 flex items-center gap-1.5 font-semibold text-violet-700 dark:text-violet-300">🤖 Usulan aksi diajukan</div>
                    <ul className="space-y-0.5 text-slate-600 dark:text-slate-300">
                      {t.proposals.map((p, j) => (
                        <li key={j}>• {ACTION_LABELS[p.actionType] ?? p.actionType} · <span className="font-mono">{p.projectCode}</span>{p.routed ? '' : ' (menunggu approver)'}</li>
                      ))}
                    </ul>
                    <Link to="/approvals" onClick={() => setOpen(false)} className="mt-1.5 inline-block font-medium text-violet-700 hover:underline dark:text-violet-300">Tinjau di Approvals →</Link>
                  </div>
                )}
              </div>
            ))}

            {ask.isPending && (
              <div className="flex justify-start gap-2">
                <AnettAvatar />
                <div className="rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2.5 dark:bg-slate-800"><TypingDots /></div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 p-2 dark:border-slate-800">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(input); } }}
                placeholder="Tulis pertanyaan…"
                className="max-h-24 min-h-[2.25rem] flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button onClick={() => sendText(input)} disabled={!input.trim() || ask.isPending} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white transition disabled:opacity-40" aria-label="Kirim">➤</button>
            </div>
            <p className="mt-1 flex items-center gap-1 px-1 text-[10px] text-slate-400 dark:text-slate-500">
              {canPropose ? '🤖 Bisa mengusulkan aksi · perlu persetujuan' : 'Read-only'} · hasil AI bisa keliru — verifikasi angka penting.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
