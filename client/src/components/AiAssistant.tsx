import { useRef, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Markdown } from '../lib/markdown';
import { useLang } from '../context/LanguageContext';

// Portfolio AI assistant — Q&A over the projects the user can access, and (Stage C) able to PROPOSE
// actions that a human approves. Launcher sits bottom-RIGHT, stacked ABOVE the DM ChatWidget bubble.
// Dormant unless AI is available (env + tenant). Persona: "Anett".
interface ProposedRef { actionType: string; projectCode: string; routed: boolean }
interface NavRef { label: string; path: string }
interface Turn { role: 'user' | 'assistant'; content: string; proposals?: ProposedRef[]; navigate?: NavRef[]; error?: boolean }
interface Briefing { approvalsWaiting: number; overdueTasks: number; projectsWithOverdue: { code: string; name: string; count: number }[] }

const CHAT_KEY = 'anett-chat';

// Human labels for the whitelisted Stage C actions (used on the inline "proposed" card).
const ACTION_LABELS: Record<string, string> = {
  CREATE_RISK: 'Tambah risiko',
  UPDATE_TASK_PROGRESS: 'Update progress tugas',
  CREATE_CHANGE_REQUEST: 'Draft change request',
  TIDY_SCHEDULE: 'Rapikan jadwal',
};

// Respect the user's reduced-motion preference (matches the app's motion convention).
function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduce(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduce;
}

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

// Three-dot "typing" bubble; static when the user prefers reduced motion.
function TypingDots({ reduce }: { reduce: boolean }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Anett sedang mengetik">
      {[0, 150, 300].map((d) => (
        <span key={d} className={`h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500 ${reduce ? '' : 'animate-bounce'}`} style={reduce ? undefined : { animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

export default function AiAssistant() {
  const reduce = usePrefersReducedMotion();
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false); // drives the open transition (mount → next frame → in)
  // Conversation survives close/reopen and an accidental reload within the tab (sessionStorage).
  const [turns, setTurns] = useState<Turn[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(CHAT_KEY) || '[]') as Turn[]; } catch { return []; }
  });
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // What the user is currently viewing → lets "proyek ini" resolve without naming it.
  const location = useLocation();
  const currentProjectId = /^\/projects\/([0-9a-f-]{36})/i.exec(location.pathname)?.[1] ?? null;
  const currentTab = new URLSearchParams(location.search).get('tab');

  const availQ = useQuery({
    queryKey: ['assistant-available'],
    queryFn: () => api.get<{ aiAvailable: boolean; actionsAvailable: boolean }>(`/assistant/available`),
    staleTime: 5 * 60_000,
  });
  const canPropose = availQ.data?.actionsAvailable === true;

  // Proactive open-state briefing (deterministic; refetched each open) — only when the panel is open.
  const briefingQ = useQuery({
    queryKey: ['assistant-briefing'],
    queryFn: () => api.get<Briefing>(`/assistant/briefing`),
    enabled: open && availQ.data?.aiAvailable === true,
    staleTime: 60_000,
  });

  const ask = useMutation({
    // Only real Q&A turns go to the model — error notices are dropped from the sent history.
    mutationFn: (history: Turn[]) => api.post<{ answer: string; proposals: ProposedRef[]; navigate: NavRef[] }>(`/assistant/ask`, {
      messages: history.filter((t) => !t.error).slice(-12).map(({ role, content }) => ({ role, content })),
      context: currentProjectId ? { projectId: currentProjectId, tab: currentTab } : undefined,
      lang,
    }),
    onSuccess: (res) => setTurns((t) => [...t, { role: 'assistant', content: res.answer, proposals: res.proposals?.length ? res.proposals : undefined, navigate: res.navigate?.length ? res.navigate : undefined }]),
    onError: (e) => setTurns((t) => [...t, { role: 'assistant', content: e instanceof ApiError ? e.message : 'AI tidak dapat menjawab saat ini.', error: true }]),
  });

  // Persist + keep the view pinned to the latest message.
  useEffect(() => { try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(turns)); } catch { /* quota */ } }, [turns]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduce ? 'auto' : 'smooth' }); }, [turns, ask.isPending, reduce]);

  // Auto-grow the input up to a cap (mirrors max-h-24 = 6rem).
  useEffect(() => {
    const el = inputRef.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [input]);

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

  // Retry after a failure: drop the trailing error notice and re-ask with the same question intact
  // (the user's message bubble stays put — no duplicate).
  const retry = () => {
    if (ask.isPending) return;
    const base = turns.filter((t) => !t.error);
    if (!base.length) return;
    setTurns(base);
    ask.mutate(base);
  };

  const newChat = () => { setTurns([]); setInput(''); try { sessionStorage.removeItem(CHAT_KEY); } catch { /* noop */ } inputRef.current?.focus(); };

  // Contextual starter chips — project-aware when viewing a project; the action chip only when
  // Stage C propose is available.
  const chips = currentProjectId
    ? [
        'Ringkas kesehatan proyek ini',
        'Tugas apa saja yang telat di sini?',
        ...(canPropose ? ['Usulkan mitigasi untuk proyek ini'] : ['Apa risiko tertinggi di proyek ini?']),
      ]
    : [
        'Proyek mana yang paling di belakang jadwal?',
        'Ringkas kesehatan portofolio saya',
        ...(canPropose ? ['Usulkan mitigasi untuk proyek paling berisiko'] : ['Apa risiko tertinggi di proyek saya?']),
      ];

  // Dynamic follow-up chips shown after the latest answer — nudge the next useful question.
  const followups = currentProjectId
    ? ['Forecast & EAC proyek ini?', 'Ada change request tertunda?', 'Apa langkah berikutnya?']
    : ['Apa yang menunggu persetujuan saya?', 'Ringkas portofolio saya', 'Proyek mana paling berisiko?'];
  const lastIsAnswer = turns.length > 0 && turns[turns.length - 1].role === 'assistant' && !turns[turns.length - 1].error;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Tanya Anett"
          title="Tanya Anett"
          className={`fixed right-5 z-[60] grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-lg shadow-violet-600/30 ring-1 ring-black/5 bottom-[calc(4.75rem+env(safe-area-inset-bottom)+8.5rem)] md:bottom-24 md:right-6 ${reduce ? '' : 'transition-all duration-300 hover:scale-105 active:scale-90'}`}
        >
          <AnettIcon className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Asisten Anett"
          className={`fixed right-4 z-[70] flex w-[min(92vw,25rem)] origin-bottom-right flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl bottom-[calc(4.75rem+env(safe-area-inset-bottom)+1rem)] md:bottom-6 md:right-6 dark:border-slate-700 dark:bg-slate-900 ${reduce ? '' : 'transition-all duration-200 ease-out'} ${shown || reduce ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-95 opacity-0'}`}
          style={{ maxHeight: 'min(72vh, 34rem)' }}
        >
          {/* Header — gradient identity band with avatar + status */}
          <div className="flex items-center gap-2.5 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-fuchsia-50 px-3 py-2.5 dark:border-slate-800 dark:from-violet-900/20 dark:to-fuchsia-900/10">
            <AnettAvatar className="h-9 w-9" icon="h-5 w-5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Anett</div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> PM Assistant · {canPropose ? 'baca + usul aksi' : 'membaca data proyek'}
              </div>
            </div>
            {turns.length > 0 && (
              <button onClick={newChat} aria-label="Percakapan baru" title="Percakapan baru" className="rounded-lg px-2 py-1 text-[11px] font-medium text-violet-600 hover:bg-white/60 dark:text-violet-300 dark:hover:bg-slate-800">+ Baru</button>
            )}
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

                {/* Proactive briefing — what needs attention right now (deterministic, no AI cost) */}
                {briefingQ.data && (briefingQ.data.approvalsWaiting > 0 || briefingQ.data.projectsWithOverdue.length > 0) && (
                  <div className="ml-10 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 text-xs dark:border-amber-900/50 dark:bg-amber-900/15">
                    <div className="mb-1 font-semibold text-amber-800 dark:text-amber-200">Perlu perhatian</div>
                    <div className="flex flex-wrap gap-1.5">
                      {briefingQ.data.approvalsWaiting > 0 && (
                        <Link to="/approvals" onClick={() => setOpen(false)} className="rounded-full border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200">
                          📥 {briefingQ.data.approvalsWaiting} approval menunggu
                        </Link>
                      )}
                      {briefingQ.data.projectsWithOverdue.map((p) => (
                        <button key={p.code} onClick={() => sendText(`Tugas apa saja yang telat di ${p.code}?`)} className="rounded-full border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200">
                          ⏰ {p.code}: {p.count} telat
                        </button>
                      ))}
                    </div>
                  </div>
                )}

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
                  <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm ${
                    t.role === 'user'
                      ? 'whitespace-pre-wrap rounded-tr-sm bg-violet-600 text-white'
                      : t.error
                        ? 'rounded-tl-sm border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200'
                        : 'rounded-tl-sm bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}>
                    {t.role === 'assistant' && !t.error ? (
                      <Markdown text={t.content} className="text-sm" />
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span>{t.error ? `⚠️ ${t.content}` : t.content}</span>
                        {t.error && i === turns.length - 1 && (
                          <button onClick={retry} disabled={ask.isPending} className="self-start rounded-md bg-amber-600/90 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50">Coba lagi</button>
                        )}
                      </div>
                    )}
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
                {/* Grounded "how-to" navigation — real in-app router links surfaced by the process guide */}
                {t.navigate && t.navigate.length > 0 && (
                  <div className="ml-10 mt-1.5 flex flex-wrap gap-1.5">
                    {t.navigate.map((n, j) => (
                      <Link key={j} to={n.path} onClick={() => setOpen(false)} className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-700 transition hover:bg-violet-50 dark:border-violet-800/60 dark:bg-slate-900 dark:text-violet-300 dark:hover:bg-violet-900/30">
                        {n.label} →
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Dynamic follow-up chips after the latest answer — nudge the next useful question */}
            {lastIsAnswer && !ask.isPending && (
              <div className="ml-10 flex flex-wrap gap-1.5">
                {followups.map((c) => (
                  <button key={c} onClick={() => sendText(c)} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                    {c}
                  </button>
                ))}
              </div>
            )}

            {ask.isPending && (
              <div className="flex justify-start gap-2">
                <AnettAvatar />
                <div className="rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2.5 dark:bg-slate-800"><TypingDots reduce={reduce} /></div>
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
