import { useRef, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, API_BASE, streamHeaders } from '../api/client';
import { Markdown } from '../lib/markdown';
import { toCsv, downloadCsv } from '../lib/csv';
import { useLang } from '../context/LanguageContext';

// Portfolio AI assistant — Q&A over the projects the user can access, and (Stage C) able to PROPOSE
// actions that a human approves. Launcher sits bottom-RIGHT, stacked ABOVE the DM ChatWidget bubble.
// Dormant unless AI is available (env + tenant). Persona: "Anett".
interface ProposedRef { actionType: string; projectCode: string; routed: boolean }
interface NavRef { label: string; path: string }
interface MemoryRef { scope: 'USER' | 'TENANT'; content: string }
interface QueryTable { entity: string; columns: { key: string; label: string }[]; rows: Record<string, string | number | boolean | null>[]; total: number; limit: number }
interface Turn { role: 'user' | 'assistant'; content: string; proposals?: ProposedRef[]; navigate?: NavRef[]; memories?: MemoryRef[]; tables?: QueryTable[]; error?: boolean }
interface Briefing { approvalsWaiting: number; overdueTasks: number; projectsWithOverdue: { code: string; name: string; count: number }[] }
interface ApprovalItem { id: string; actionLabel: string; stepName: string; project: { code: string; name: string } | null }

const CHAT_KEY = 'anett-chat';

// All of Anett's UI copy, bilingual — follows the app's language toggle (useLang) like the rest of
// the app. `en` is the default for non-Indonesian locales, so every visible string has both.
interface AnettStrings {
  launcher: string; subtitlePropose: string; subtitleRead: string;
  newChat: string; newChatTitle: string; close: string;
  enlarge: string; shrink: string;
  greetPre: string; greetPost: string; greetPropose: string;
  needAttention: string; approvalsWaiting: (n: number) => string; overdue: (code: string, n: number) => string; overduePrompt: (code: string) => string;
  proposalsTitle: string; waitingApprover: string; reviewInApprovals: string;
  remembering: string; teamSuffix: string;
  thanksUp: string; thanksDown: string; notePlaceholder: string; send: string; skip: string;
  likeTitle: string; likeAria: string; dislikeTitle: string; dislikeAria: string;
  retry: string; thinking: string; composing: string; inputPlaceholder: string;
  voiceStart: string; voiceStop: string; listening: string; ttsOnAria: string; ttsOffAria: string;
  voiceErrSecure: string; voiceErrDenied: string; voiceErrGeneric: string;
  convoOnAria: string; convoOffAria: string; readAloud: string; stopReading: string; voiceLabel: string; voiceAuto: string;
  menuAria: string; menuHandsFree: string; menuReadAloud: string;
  needsApproval: (n: number) => string; approve: string; reject: string; viewAllApprovals: (n: number) => string; approvedToast: string; rejectedToast: string;
  exportCsv: string; rowsShown: (n: number, total: number) => string;
  footerPropose: string; footerRead: string; footerTail: string; errorGeneric: string;
  actionLabels: Record<string, string>;
  chips: (proj: boolean, propose: boolean) => string[];
  followups: (proj: boolean) => string[];
}

const STRINGS: Record<'id' | 'en', AnettStrings> = {
  id: {
    launcher: 'Tanya Anett AI Assistant', subtitlePropose: 'Baca data proyek & usulkan aksi', subtitleRead: 'Membaca data proyek',
    newChat: 'New Chat', newChatTitle: 'Percakapan baru', close: 'Tutup', enlarge: 'Perbesar', shrink: 'Perkecil',
    greetPre: 'Halo, saya ', greetPost: '. Saya bantu memantau proyek Anda', greetPropose: ' — dan bisa mengusulkan aksi (perlu persetujuan)',
    needAttention: 'Perlu perhatian', approvalsWaiting: (n) => `${n} approval menunggu`, overdue: (c, n) => `${c}: ${n} telat`, overduePrompt: (c) => `Tugas apa saja yang telat di ${c}?`,
    proposalsTitle: '🤖 Usulan aksi diajukan', waitingApprover: ' (menunggu approver)', reviewInApprovals: 'Tinjau di Approvals →',
    remembering: 'Mengingat', teamSuffix: ' (tim)',
    thanksUp: '👍 Terima kasih atas masukannya.', thanksDown: '👎 Terima kasih — Anett akan mengingatnya.', notePlaceholder: 'Apa yang kurang tepat? / seharusnya bagaimana?', send: 'Kirim', skip: 'Lewati',
    likeTitle: 'Jawaban ini membantu', likeAria: 'Suka', dislikeTitle: 'Jawaban ini kurang tepat', dislikeAria: 'Tidak suka',
    retry: 'Coba lagi', thinking: 'Berpikir…', composing: 'Menyusun jawaban…', inputPlaceholder: 'Tulis pertanyaan…',
    voiceStart: 'Bicara', voiceStop: 'Berhenti merekam', listening: 'Mendengarkan…', ttsOnAria: 'Matikan suara', ttsOffAria: 'Bacakan jawaban',
    voiceErrSecure: 'Mikrofon butuh HTTPS — buka lewat alamat https:// (bukan http/LAN).', voiceErrDenied: 'Izin mikrofon ditolak. Aktifkan di pengaturan situs (ikon gembok di address bar), lalu coba lagi.', voiceErrGeneric: 'Mikrofon tidak dapat diakses. Cek koneksi & izin mikrofon.',
    convoOnAria: 'Matikan mode ngobrol', convoOffAria: 'Mode ngobrol (hands-free)', readAloud: 'Bacakan', stopReading: 'Stop', voiceLabel: 'Suara', voiceAuto: 'Otomatis',
    menuAria: 'Menu lainnya', menuHandsFree: 'Mode ngobrol', menuReadAloud: 'Bacakan jawaban',
    needsApproval: (n) => `Menunggu persetujuan Anda (${n})`, approve: 'Setujui', reject: 'Tolak', viewAllApprovals: (n) => `+${n} lainnya di Approvals →`, approvedToast: 'Disetujui', rejectedToast: 'Ditolak',
    exportCsv: 'Ekspor CSV', rowsShown: (n, total) => `${n} dari ${total} baris`,
    footerPropose: '🤖 Bisa mengusulkan aksi · perlu persetujuan', footerRead: 'Hanya membaca', footerTail: ' · hasil AI bisa keliru — verifikasi angka penting.', errorGeneric: 'AI tidak dapat menjawab saat ini.',
    actionLabels: { CREATE_RISK: 'Tambah risiko', UPDATE_TASK_PROGRESS: 'Update progress tugas', CREATE_CHANGE_REQUEST: 'Draft change request', TIDY_SCHEDULE: 'Rapikan jadwal' },
    chips: (proj, propose) => proj
      ? ['Ringkas kesehatan proyek ini', 'Tugas apa saja yang telat di sini?', propose ? 'Usulkan mitigasi untuk proyek ini' : 'Apa risiko tertinggi di proyek ini?']
      : ['Proyek mana yang paling di belakang jadwal?', 'Ringkas kesehatan portofolio saya', propose ? 'Usulkan mitigasi untuk proyek paling berisiko' : 'Apa risiko tertinggi di proyek saya?'],
    followups: (proj) => proj
      ? ['Forecast & EAC proyek ini?', 'Ada change request tertunda?', 'Apa langkah berikutnya?']
      : ['Apa yang menunggu persetujuan saya?', 'Ringkas portofolio saya', 'Proyek mana paling berisiko?'],
  },
  en: {
    launcher: 'Ask Anett AI Assistant', subtitlePropose: 'Reads project data & proposes actions', subtitleRead: 'Reads project data',
    newChat: 'New Chat', newChatTitle: 'New conversation', close: 'Close', enlarge: 'Enlarge', shrink: 'Shrink',
    greetPre: "Hi, I'm ", greetPost: '. I help you monitor your projects', greetPropose: ' — and can propose actions (needs approval)',
    needAttention: 'Needs attention', approvalsWaiting: (n) => `${n} approval${n === 1 ? '' : 's'} waiting`, overdue: (c, n) => `${c}: ${n} overdue`, overduePrompt: (c) => `Which tasks are overdue in ${c}?`,
    proposalsTitle: '🤖 Action proposals submitted', waitingApprover: ' (awaiting approver)', reviewInApprovals: 'Review in Approvals →',
    remembering: 'Remembering', teamSuffix: ' (team)',
    thanksUp: '👍 Thanks for the feedback.', thanksDown: "👎 Thanks — Anett will remember this.", notePlaceholder: 'What was off? / what should it be?', send: 'Send', skip: 'Skip',
    likeTitle: 'This answer helped', likeAria: 'Like', dislikeTitle: 'This answer was off', dislikeAria: 'Dislike',
    retry: 'Try again', thinking: 'Thinking…', composing: 'Composing an answer…', inputPlaceholder: 'Type a question…',
    voiceStart: 'Speak', voiceStop: 'Stop recording', listening: 'Listening…', ttsOnAria: 'Turn off voice', ttsOffAria: 'Read answers aloud',
    voiceErrSecure: 'The mic needs HTTPS — open the https:// address (not http/LAN).', voiceErrDenied: 'Microphone permission denied. Enable it in site settings (padlock icon in the address bar), then try again.', voiceErrGeneric: 'Microphone unavailable. Check your connection & mic permission.',
    convoOnAria: 'Turn off conversation mode', convoOffAria: 'Conversation mode (hands-free)', readAloud: 'Read aloud', stopReading: 'Stop', voiceLabel: 'Voice', voiceAuto: 'Auto',
    menuAria: 'More options', menuHandsFree: 'Hands-free', menuReadAloud: 'Read answers',
    needsApproval: (n) => `Awaiting your approval (${n})`, approve: 'Approve', reject: 'Reject', viewAllApprovals: (n) => `+${n} more in Approvals →`, approvedToast: 'Approved', rejectedToast: 'Rejected',
    exportCsv: 'Export CSV', rowsShown: (n, total) => `${n} of ${total} rows`,
    footerPropose: '🤖 Can propose actions · needs approval', footerRead: 'Read-only', footerTail: ' · AI can be wrong — verify key numbers.', errorGeneric: "Anett can't answer right now.",
    actionLabels: { CREATE_RISK: 'Add risk', UPDATE_TASK_PROGRESS: 'Update task progress', CREATE_CHANGE_REQUEST: 'Draft change request', TIDY_SCHEDULE: 'Tidy schedule' },
    chips: (proj, propose) => proj
      ? ['Summarize this project’s health', 'Which tasks are overdue here?', propose ? 'Propose mitigations for this project' : "What's the top risk in this project?"]
      : ['Which project is most behind schedule?', 'Summarize my portfolio health', propose ? 'Propose mitigations for the riskiest project' : "What's the top risk across my projects?"],
    followups: (proj) => proj
      ? ["This project’s forecast & EAC?", 'Any pending change requests?', "What's the next step?"]
      : ['What is waiting for my approval?', 'Summarize my portfolio', 'Which project is riskiest?'],
  },
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
      <path className="anett-eye" d="M15 13v2" />
      <path className="anett-eye" d="M9 13v2" />
    </svg>
  );
}

// A gradient amethyst avatar disc — Anett's face, reused by launcher, header and message rows.
function AnettAvatar({ className = 'h-8 w-8', icon = 'h-4 w-4', thinking = false }: { className?: string; icon?: string; thinking?: boolean }) {
  return (
    <span className={`relative grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-sm ${thinking ? 'anett-halo anett-thinking' : ''} ${className}`}>
      <AnettIcon className={icon} />
    </span>
  );
}

// Microphone glyph (filled, Gemini-style: solid capsule mic + arc cradle + stand) for the voice button.
function MicIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.09A6 6 0 0 0 18 11Z" />
    </svg>
  );
}

// Speaker glyph (filled, same visual language as MicIcon) — muted variant crosses out the waves.
function SpeakerIcon({ className, muted = false }: { className: string; muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M11 5 6.5 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3.5L11 19a1 1 0 0 0 1.6-.8V5.8A1 1 0 0 0 11 5Z" />
      {muted ? (
        <path d="M16 9.5 20.5 14M20.5 9.5 16 14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      ) : (
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      )}
    </svg>
  );
}

// Vertical 3-dot "more options" glyph for the header overflow menu.
function KebabIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

// Three-dot "typing" bubble; static when the user prefers reduced motion.
function TypingDots({ reduce }: { reduce: boolean }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Anett is typing">
      {[0, 150, 300].map((d) => (
        <span key={d} className={`h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500 ${reduce ? '' : 'animate-bounce'}`} style={reduce ? undefined : { animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

// Maximize / restore glyph for the enlarge toggle (Lucide-style stroke SVG).
function ResizeIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {expanded ? (
        <>
          <polyline points="4 14 10 14 10 20" />
          <polyline points="20 10 14 10 14 4" />
          <line x1="14" y1="10" x2="21" y2="3" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </>
      ) : (
        <>
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </>
      )}
    </svg>
  );
}

// ── Voice (Web Speech API) — client-only STT + TTS; absent gracefully where unsupported ──────────────
interface SpeechRec {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: SpeechRecEvent) => void) | null; onerror: ((e: { error?: string }) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
}
interface SpeechRecEvent { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }
function getSpeechRecognitionCtor(): (new () => SpeechRec) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const TTS_SUPPORTED = typeof window !== 'undefined' && 'speechSynthesis' in window;

// Pick the nicest voice for a language: an explicit choice if still available, else a local
// (on-device, usually more natural) voice matching the language, else any matching, else the first.
function pickVoice(voices: SpeechSynthesisVoice[], lang: 'id' | 'en', preferredURI?: string): SpeechSynthesisVoice | undefined {
  if (!voices.length) return undefined;
  if (preferredURI) { const m = voices.find((v) => v.voiceURI === preferredURI); if (m) return m; }
  const prefix = lang === 'en' ? 'en' : 'id';
  const matching = voices.filter((v) => v.lang?.toLowerCase().startsWith(prefix));
  return matching.find((v) => v.localService) ?? matching[0] ?? voices[0];
}

// Live audio-level bars while the mic listens (Gemini/Siri-style) — driven by a real MediaStream via
// the Web Audio analyser. Isolated so its ~30fps updates don't re-render the whole assistant.
function VoiceListeningBar({ stream }: { stream: MediaStream }) {
  const N = 9;
  const [bars, setBars] = useState<number[]>(() => Array(N).fill(0.15));
  useEffect(() => {
    let raf = 0; let ctx: AudioContext | null = null;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      const analyser = ctx.createAnalyser(); analyser.fftSize = 64; analyser.smoothingTimeConstant = 0.7;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const step = Math.max(1, Math.floor(data.length / N));
      const loop = () => {
        analyser.getByteFrequencyData(data);
        const next: number[] = [];
        for (let i = 0; i < N; i++) { let s = 0; for (let j = 0; j < step; j++) s += data[i * step + j] ?? 0; next.push(Math.min(1, s / step / 170 + 0.12)); }
        setBars(next);
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* Web Audio unavailable → bars stay at rest */ }
    return () => { cancelAnimationFrame(raf); ctx?.close().catch(() => {}); };
  }, [stream]);
  return (
    <div className="flex h-9 flex-1 items-center gap-[3px] px-2" aria-hidden>
      {bars.map((h, i) => <span key={i} className="w-1 rounded-full bg-rose-500" style={{ height: `${Math.round(h * 100)}%` }} />)}
    </div>
  );
}
// Strip common markdown so the spoken answer sounds natural (not "asterisk asterisk …").
function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/^\s*[-•]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function AiAssistant() {
  const reduce = usePrefersReducedMotion();
  const { lang } = useLang();
  const L = STRINGS[lang];
  const ACTION_LABELS = L.actionLabels;
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false); // drives the open transition (mount → next frame → in)
  // Conversation survives close/reopen and an accidental reload within the tab (sessionStorage).
  const [turns, setTurns] = useState<Turn[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(CHAT_KEY) || '[]') as Turn[]; } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [expanded, setExpanded] = useState(false); // larger panel (not fullscreen)
  const [menuOpen, setMenuOpen] = useState(false);  // header ⋮ overflow menu (New Chat / voice toggles)
  // Typewriter reveal for the freshest answer (Hostinger-style): which turn is animating + how far.
  const [streamIdx, setStreamIdx] = useState<number | null>(null);
  const [streamLen, setStreamLen] = useState(0);
  // Feedback per answer: which turns were rated (so the buttons collapse) + the open 👎-note editor.
  const [rated, setRated] = useState<Record<number, 'up' | 'down'>>({});
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');
  // Live "thinking process": the tool-loop steps streamed from the server while Anett reasons.
  const [streaming, setStreaming] = useState(false);
  const [streamSteps, setStreamSteps] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // Voice: mic (speech→text, auto-send) + optional spoken answers (text→speech).
  const sttCtor = getSpeechRecognitionCtor();
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [ttsOn, setTtsOn] = useState(() => { try { return localStorage.getItem('anett-tts') === '1'; } catch { return false; } });
  const [convoMode, setConvoMode] = useState(() => { try { return localStorage.getItem('anett-convo') === '1'; } catch { return false; } }); // hands-free loop
  const [micStream, setMicStream] = useState<MediaStream | null>(null); // for the live listening waveform
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);  // which answer is being read aloud
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState(() => { try { return localStorage.getItem('anett-voice') || ''; } catch { return ''; } });
  const recogRef = useRef<SpeechRec | null>(null);
  const spokenRef = useRef(-1); // index of the last answer read aloud (avoids re-speaking restored turns)
  // Refs so the speech callbacks (which outlive a render) always see current values.
  const convoRef = useRef(convoMode); convoRef.current = convoMode;
  const openRef = useRef(false); openRef.current = open;
  const startListeningRef = useRef<() => void>(() => {});
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const turnsRef = useRef<Turn[]>(turns); // always-current turns, so onSuccess can index the new answer

  // What the user is currently viewing → lets "proyek ini" resolve without naming it.
  const location = useLocation();
  const currentProjectId = /^\/projects\/([0-9a-f-]{36})/i.exec(location.pathname)?.[1] ?? null;
  const currentTab = new URLSearchParams(location.search).get('tab');

  const availQ = useQuery({
    queryKey: ['assistant-available'],
    queryFn: () => api.get<{ aiAvailable: boolean; actionsAvailable: boolean; voiceServer: boolean }>(`/assistant/available`),
    staleTime: 5 * 60_000,
  });
  const canPropose = availQ.data?.actionsAvailable === true;
  // Server-side voice (Whisper/ElevenLabs) when available; else the browser Web Speech API (Voice v2).
  const voiceServer = availQ.data?.voiceServer === true;
  const sttAvailable = voiceServer || !!sttCtor;
  const ttsAvailable = voiceServer || TTS_SUPPORTED;
  const voiceServerRef = useRef(voiceServer); voiceServerRef.current = voiceServer;
  const recorderRef = useRef<MediaRecorder | null>(null); // server-STT recording
  const audioRef = useRef<HTMLAudioElement | null>(null);  // server-TTS playback

  // Proactive open-state briefing (deterministic; refetched each open) — only when the panel is open.
  const briefingQ = useQuery({
    queryKey: ['assistant-briefing'],
    queryFn: () => api.get<Briefing>(`/assistant/briefing`),
    enabled: open && availQ.data?.aiAvailable === true,
    staleTime: 60_000,
  });

  // Approvals routed to the user — surfaced in-chat so they can Approve/Reject without leaving Anett.
  const qc = useQueryClient();
  const approvalsQ = useQuery({
    queryKey: ['assistant-approvals'],
    queryFn: () => api.get<{ approvals: ApprovalItem[] }>(`/approvals/mine`),
    enabled: open && availQ.data?.aiAvailable === true,
    staleTime: 15_000,
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: 'APPROVED' | 'REJECTED' }) => api.post(`/approvals/${v.id}/decide`, { decision: v.decision }),
    onSuccess: () => { void approvalsQ.refetch(); void briefingQ.refetch(); qc.invalidateQueries({ queryKey: ['approvals'] }); },
  });

  const ask = useMutation({
    // Only real Q&A turns go to the model — error notices are dropped from the sent history.
    mutationFn: (history: Turn[]) => api.post<{ answer: string; proposals: ProposedRef[]; navigate: NavRef[]; memories: MemoryRef[]; tables: QueryTable[] }>(`/assistant/ask`, {
      messages: history.filter((t) => !t.error).slice(-12).map(({ role, content }) => ({ role, content })),
      context: currentProjectId ? { projectId: currentProjectId, tab: currentTab } : undefined,
      lang,
    }),
    onSuccess: (res) => {
      // The new answer lands at the current end of the list; start the typewriter there (unless reduced-motion).
      if (!reduce && res.answer) { setStreamIdx(turnsRef.current.length); setStreamLen(0); }
      setTurns((t) => [...t, { role: 'assistant', content: res.answer, proposals: res.proposals?.length ? res.proposals : undefined, navigate: res.navigate?.length ? res.navigate : undefined, memories: res.memories?.length ? res.memories : undefined, tables: res.tables?.length ? res.tables : undefined }]);
    },
    onError: (e) => setTurns((t) => [...t, { role: 'assistant', content: e instanceof ApiError ? e.message : L.errorGeneric, error: true }]),
  });

  // Feedback on an answer (👍/👎). A 👎 may carry a short correction note that becomes a memory Anett
  // will honor. Fire-and-forget: the rating collapses the buttons immediately.
  const feedback = useMutation({
    mutationFn: (body: { idx: number; rating: 'UP' | 'DOWN'; note?: string }) => {
      const t = turns[body.idx];
      const question = body.idx > 0 && turns[body.idx - 1]?.role === 'user' ? turns[body.idx - 1].content : undefined;
      return api.post<{ id: string; guidanceStored: boolean }>(`/assistant/feedback`, {
        rating: body.rating,
        answer: t?.content ?? '',
        question,
        note: body.note || undefined,
        projectId: currentProjectId || undefined,
      });
    },
  });

  const rate = (idx: number, rating: 'UP' | 'DOWN', note?: string) => {
    setRated((r) => ({ ...r, [idx]: rating === 'UP' ? 'up' : 'down' }));
    setNoteFor(null); setNoteText('');
    feedback.mutate({ idx, rating, note });
  };

  // Persist + keep the view pinned to the latest message (also while the typewriter is revealing).
  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => { try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(turns)); } catch { /* quota */ } }, [turns]);
  // Pin to the latest message on every new turn/stream tick AND whenever the panel (re)opens — so
  // reopening an existing conversation always lands on the last message (jump instantly on open).
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: open && !streaming && !ask.isPending ? 'auto' : reduce ? 'auto' : 'smooth' }); }, [open, shown, turns, ask.isPending, streaming, streamSteps.length, streamLen, reduce]);

  // Typewriter: advance the revealed slice a few chars per frame until the full answer is shown.
  useEffect(() => {
    if (streamIdx === null) return;
    const full = turns[streamIdx]?.content ?? '';
    if (streamLen >= full.length) { setStreamIdx(null); return; }
    const step = Math.max(2, Math.ceil(full.length / 140)); // scale so long answers still finish in ~2s
    const id = setTimeout(() => setStreamLen((n) => Math.min(full.length, n + step)), 16);
    return () => clearTimeout(id);
  }, [streamIdx, streamLen, turns]);

  // Auto-grow the input up to a cap (mirrors max-h-24 = 6rem).
  useEffect(() => {
    const el = inputRef.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [input]);

  // Open transition + focus the input; Escape closes.
  useEffect(() => {
    if (!open) { setShown(false); setMenuOpen(false); abortRef.current?.abort(); recogRef.current?.abort(); recorderRef.current?.stop(); if (TTS_SUPPORTED) window.speechSynthesis.cancel(); audioRef.current?.pause(); return; }
    const raf = requestAnimationFrame(() => setShown(true));
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open]);

  // Load & track available TTS voices (getVoices is async — populated on 'voiceschanged').
  useEffect(() => {
    if (!TTS_SUPPORTED) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load);
  }, []);

  // Stop any in-progress spoken answer (browser or server path).
  const cancelSpeak = () => {
    if (TTS_SUPPORTED) window.speechSynthesis.cancel();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.onended = null; }
    setSpeakingIdx(null);
  };

  // Play an answer as audio via the server (ElevenLabs). Re-listens after it ends in hands-free mode.
  const speakServer = async (idx: number, text: string) => {
    setSpeakingIdx(idx);
    try {
      const res = await fetch(`${API_BASE}/assistant/tts`, { method: 'POST', credentials: 'include', headers: streamHeaders('POST'), body: JSON.stringify({ text: stripMarkdown(text).slice(0, 1200), lang }) });
      if (!res.ok) throw new Error('tts');
      const url = URL.createObjectURL(await res.blob());
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src = url;
      audio.onended = () => { setSpeakingIdx(null); URL.revokeObjectURL(url); if (convoRef.current && openRef.current) startListeningRef.current(); };
      audio.onerror = () => setSpeakingIdx(null);
      await audio.play();
    } catch { setSpeakingIdx(null); }
  };

  // Read one answer aloud (auto-speak effect + per-answer button). Server voice when available, else
  // the browser voice; in hands-free mode, re-opens the mic when it finishes.
  const speakTurn = (idx: number) => {
    const turn = turnsRef.current[idx];
    if (!turn || turn.role !== 'assistant' || turn.error) return;
    cancelSpeak();
    if (voiceServerRef.current) { void speakServer(idx, turn.content); return; }
    if (!TTS_SUPPORTED) return;
    const u = new SpeechSynthesisUtterance(stripMarkdown(turn.content));
    u.lang = lang === 'en' ? 'en-US' : 'id-ID';
    const v = pickVoice(voices, lang, voiceURI); if (v) u.voice = v;
    u.onstart = () => setSpeakingIdx(idx);
    u.onend = () => { setSpeakingIdx(null); if (convoRef.current && openRef.current) startListeningRef.current(); };
    u.onerror = () => setSpeakingIdx(null);
    window.speechSynthesis.speak(u);
  };

  // Auto-read each new assistant answer when the speaker is on. MUST stay above the early return
  // (Rules of Hooks — a hook after an early return crashes with React #310).
  useEffect(() => {
    if (!ttsOn || (!voiceServerRef.current && !TTS_SUPPORTED)) return;
    const idx = turns.length - 1;
    const last = turns[idx];
    if (last && last.role === 'assistant' && !last.error && spokenRef.current !== idx) {
      spokenRef.current = idx;
      speakTurn(idx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, ttsOn]);

  if (!availQ.data?.aiAvailable) return null;

  const busy = ask.isPending || streaming;

  // Stream the answer via SSE so Anett's reasoning steps appear live. Falls back to the plain /ask
  // mutation if streaming isn't available (old server, proxy that buffers, or a network hiccup).
  const runAskStream = async (history: Turn[]) => {
    setStreaming(true); setStreamSteps([]);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    let started = false; // did we receive any well-formed event? (else fall back)
    try {
      const res = await fetch(`${API_BASE}/assistant/ask/stream`, {
        method: 'POST', credentials: 'include', headers: streamHeaders('POST'), signal: ctrl.signal,
        body: JSON.stringify({
          messages: history.filter((t) => !t.error).slice(-12).map(({ role, content }) => ({ role, content })),
          context: currentProjectId ? { projectId: currentProjectId, tab: currentTab } : undefined,
          lang,
        }),
      });
      if (!res.ok || !res.body) throw new Error('stream-unavailable');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let ev: { type: string; label?: string; answer?: string; proposals?: ProposedRef[]; navigate?: NavRef[]; memories?: MemoryRef[]; tables?: QueryTable[]; message?: string };
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          started = true;
          if (ev.type === 'step' && ev.label) {
            setStreamSteps((s) => [...s, ev.label!]);
          } else if (ev.type === 'answer') {
            if (!reduce && ev.answer) { setStreamIdx(turnsRef.current.length); setStreamLen(0); }
            setTurns((t) => [...t, { role: 'assistant', content: ev.answer ?? '', proposals: ev.proposals?.length ? ev.proposals : undefined, navigate: ev.navigate?.length ? ev.navigate : undefined, memories: ev.memories?.length ? ev.memories : undefined, tables: ev.tables?.length ? ev.tables : undefined }]);
          } else if (ev.type === 'error') {
            setTurns((t) => [...t, { role: 'assistant', content: ev.message || L.errorGeneric, error: true }]);
          }
        }
      }
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return; // user cancelled — leave the chat as-is
      if (!started) { setStreaming(false); setStreamSteps([]); ask.mutate(history); return; } // fall back
      setTurns((t) => [...t, { role: 'assistant', content: L.errorGeneric, error: true }]);
    } finally {
      abortRef.current = null;
      setStreaming(false); setStreamSteps([]);
    }
  };

  const sendText = (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    cancelSpeak(); // stop any prior spoken answer
    const next: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns(next);
    setInput('');
    void runAskStream(next);
  };

  // Retry after a failure: drop the trailing error notice and re-ask with the same question intact
  // (the user's message bubble stays put — no duplicate).
  const retry = () => {
    if (busy) return;
    const base = turns.filter((t) => !t.error);
    if (!base.length) return;
    setTurns(base);
    void runAskStream(base);
  };

  const newChat = () => { setTurns([]); setInput(''); setStreamIdx(null); setStreamLen(0); spokenRef.current = -1; cancelSpeak(); try { sessionStorage.removeItem(CHAT_KEY); } catch { /* noop */ } inputRef.current?.focus(); };

  // Stop + release the waveform mic stream.
  const stopMic = () => setMicStream((s) => { s?.getTracks().forEach((t) => t.stop()); return null; });

  // Server-STT (Whisper): record audio → POST /assistant/stt → auto-send the transcript.
  const startServerRecording = async () => {
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { setVoiceError(L.voiceErrDenied); return; }
    setMicStream(stream); setListening(true);
    const chunks: BlobPart[] = [];
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(stream); } catch { stream.getTracks().forEach((t) => t.stop()); setMicStream(null); setListening(false); setVoiceError(L.voiceErrGeneric); return; }
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      setListening(false); recorderRef.current = null;
      stream.getTracks().forEach((t) => t.stop()); setMicStream(null);
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      if (!blob.size) return;
      try {
        const res = await fetch(`${API_BASE}/assistant/stt?lang=${lang}`, { method: 'POST', credentials: 'include', headers: { ...streamHeaders('POST'), 'Content-Type': blob.type || 'audio/webm' }, body: blob });
        if (!res.ok) throw new Error('stt');
        const q = ((await res.json() as { text?: string }).text ?? '').trim();
        if (q) sendText(q);
      } catch { setVoiceError(L.voiceErrGeneric); }
    };
    recorderRef.current = rec; rec.start();
  };

  // Voice input (speech→text): server (Whisper) when available, else browser recognition; auto-sends.
  const stopListening = () => { if (recorderRef.current) recorderRef.current.stop(); else recogRef.current?.stop(); };
  const startListening = () => {
    if (!sttAvailable || listening || busy) return;
    setVoiceError(null);
    // The mic API only works in a secure context (HTTPS / localhost); on plain http it fails silently
    // with no permission prompt — tell the user why instead of doing nothing.
    if (typeof window !== 'undefined' && window.isSecureContext === false) { setVoiceError(L.voiceErrSecure); return; }
    cancelSpeak(); // barge-in: stop any answer being read
    if (voiceServerRef.current) { void startServerRecording(); return; }
    if (!sttCtor) return;
    // Open a parallel stream just for the live level meter (best-effort; STT works without it).
    navigator.mediaDevices?.getUserMedia({ audio: true }).then((s) => setMicStream(s)).catch(() => {});
    let finalText = '';
    const rec = new sttCtor();
    rec.lang = lang === 'en' ? 'en-US' : 'id-ID';
    rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      setInput((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      const code = e?.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') setVoiceError(L.voiceErrDenied);
      else if (code && code !== 'no-speech' && code !== 'aborted') setVoiceError(L.voiceErrGeneric);
      setListening(false); recogRef.current = null; stopMic();
    };
    rec.onend = () => { setListening(false); recogRef.current = null; stopMic(); const q = finalText.trim(); if (q) sendText(q); };
    recogRef.current = rec; setListening(true);
    try { rec.start(); } catch { setListening(false); recogRef.current = null; stopMic(); }
  };
  startListeningRef.current = startListening;

  // Spoken answers (text→speech). Toggling the header speaker on/off; hands-free conversation loop.
  const toggleTts = () => setTtsOn((v) => { const nv = !v; try { localStorage.setItem('anett-tts', nv ? '1' : '0'); } catch { /* quota */ } if (!nv) cancelSpeak(); return nv; });
  const toggleConvo = () => setConvoMode((v) => {
    const nv = !v; try { localStorage.setItem('anett-convo', nv ? '1' : '0'); } catch { /* quota */ }
    if (nv && !ttsOn) toggleTts(); // hands-free needs answers read aloud to know when to re-listen
    if (!nv) cancelSpeak();
    return nv;
  });
  // Per-answer speaker button: read this answer, or stop if it's the one already speaking.
  const toggleSpeak = (idx: number) => { if (speakingIdx === idx) cancelSpeak(); else speakTurn(idx); };

  // Render a query-result cell + export the whole table to CSV (reuses lib/csv).
  const fmtCell = (v: string | number | boolean | null) => (v == null ? '—' : typeof v === 'boolean' ? (v ? '✓' : '–') : String(v));
  const exportTable = (tbl: QueryTable) => {
    const rows = tbl.rows.map((r) => tbl.columns.map((c) => { const v = r[c.key]; return typeof v === 'boolean' ? (v ? 'yes' : 'no') : v; }));
    downloadCsv(`anett-${tbl.entity}.csv`, toCsv(tbl.columns.map((c) => c.label), rows));
  };

  // Contextual starter chips — project-aware when viewing a project; the action chip only when
  // Stage C propose is available. Follow-up chips nudge the next useful question. Both bilingual.
  const chips = L.chips(!!currentProjectId, canPropose);
  const followups = L.followups(!!currentProjectId);
  const lastIsAnswer = turns.length > 0 && turns[turns.length - 1].role === 'assistant' && !turns[turns.length - 1].error;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={L.launcher}
          title="Anett AI Assistant"
          className={`fixed right-5 z-[60] grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-lg shadow-violet-600/30 ring-1 ring-black/5 bottom-[calc(4.75rem+env(safe-area-inset-bottom)+8.5rem)] md:bottom-24 md:right-6 ${reduce ? '' : 'anett-breathe transition-all duration-300 hover:scale-105 active:scale-90'}`}
        >
          <AnettIcon className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Anett AI Assistant"
          className={`fixed right-4 z-[70] flex w-[min(92vw,25rem)] origin-bottom-right flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl bottom-[calc(4.75rem+env(safe-area-inset-bottom)+1rem)] md:bottom-6 md:right-6 dark:border-slate-700 dark:bg-slate-900 ${reduce ? '' : 'transition-all duration-200 ease-out'} ${shown || reduce ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-95 opacity-0'}`}
          style={{ maxHeight: expanded ? 'min(85vh, 46rem)' : 'min(72vh, 34rem)', minHeight: expanded ? 'min(80vh, 40rem)' : undefined }}
        >
          {/* Header — gradient identity band with avatar + status */}
          <div className="flex items-center gap-2.5 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-fuchsia-50 px-3 py-2.5 dark:border-slate-800 dark:from-violet-900/20 dark:to-fuchsia-900/10">
            <AnettAvatar className="h-9 w-9" icon="h-5 w-5" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">Anett AI Assistant</div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> {canPropose ? L.subtitlePropose : L.subtitleRead}
              </div>
            </div>
            <button onClick={() => setExpanded((v) => !v)} aria-label={expanded ? L.shrink : L.enlarge} title={expanded ? L.shrink : L.enlarge} className="hidden h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-white/60 hover:text-violet-600 md:grid dark:text-slate-400 dark:hover:bg-slate-800">
              <ResizeIcon expanded={expanded} />
            </button>
            {/* ⋮ overflow menu — New Chat + voice toggles (kept out of the header row) */}
            {(turns.length > 0 || ttsAvailable) && (
              <div className="relative">
                <button onClick={() => setMenuOpen((v) => !v)} aria-label={L.menuAria} title={L.menuAria} aria-haspopup="menu" aria-expanded={menuOpen} className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-white/60 hover:text-violet-600 dark:text-slate-400 dark:hover:bg-slate-800">
                  <KebabIcon className="h-5 w-5" />
                </button>
                {menuOpen && (
                  <>
                    <button className="fixed inset-0 z-30 cursor-default" aria-hidden tabIndex={-1} onClick={() => setMenuOpen(false)} />
                    <div role="menu" className="absolute right-0 top-9 z-40 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                      {turns.length > 0 && (
                        <button role="menuitem" onClick={() => { newChat(); setMenuOpen(false); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">
                          <span className="w-4 text-center text-base leading-none text-violet-500">＋</span> {L.newChat}
                        </button>
                      )}
                      {sttAvailable && ttsAvailable && (
                        <button role="menuitemcheckbox" aria-checked={convoMode} onClick={() => { toggleConvo(); setMenuOpen(false); }} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 ${convoMode ? 'text-violet-600 dark:text-violet-300' : 'text-slate-700 dark:text-slate-200'}`}>
                          <span className="w-4 text-center text-base leading-none">🗣️</span><span className="flex-1">{L.menuHandsFree}</span>{convoMode && <span className="text-violet-500">✓</span>}
                        </button>
                      )}
                      {ttsAvailable && (
                        <button role="menuitemcheckbox" aria-checked={ttsOn} onClick={() => { toggleTts(); setMenuOpen(false); }} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 ${ttsOn ? 'text-violet-600 dark:text-violet-300' : 'text-slate-700 dark:text-slate-200'}`}>
                          <SpeakerIcon className="h-4 w-4 shrink-0" muted={!ttsOn} /><span className="flex-1">{L.menuReadAloud}</span>{ttsOn && <span className="text-violet-500">✓</span>}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            <button onClick={() => setOpen(false)} aria-label={L.close} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800">✕</button>
          </div>

          {/* Voice picker — pick the natural voice for spoken answers (shown when the speaker is on) */}
          {TTS_SUPPORTED && !voiceServer && ttsOn && voices.some((v) => v.lang?.toLowerCase().startsWith(lang === 'en' ? 'en' : 'id')) && (
            <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-1 dark:border-slate-800">
              <span className="text-[10px] uppercase tracking-wide text-slate-400">{L.voiceLabel}</span>
              <select
                value={voiceURI}
                onChange={(e) => { setVoiceURI(e.target.value); try { localStorage.setItem('anett-voice', e.target.value); } catch { /* quota */ } }}
                className="flex-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <option value="">{L.voiceAuto}</option>
                {voices.filter((v) => v.lang?.toLowerCase().startsWith(lang === 'en' ? 'en' : 'id')).map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
              </select>
            </div>
          )}

          {/* Pending approvals — act on them right here, no need to open the Approvals page */}
          {approvalsQ.data?.approvals && approvalsQ.data.approvals.length > 0 && (
            <div className="border-b border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-900/40 dark:bg-amber-900/15">
              <div className="mb-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200">📥 {L.needsApproval(approvalsQ.data.approvals.length)}</div>
              <div className="space-y-1">
                {approvalsQ.data.approvals.slice(0, 3).map((a) => (
                  <div key={a.id} className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-200" title={a.actionLabel}>{a.actionLabel}{a.project?.code ? <span className="font-mono text-slate-500 dark:text-slate-400"> · {a.project.code}</span> : null}</span>
                    <button onClick={() => decide.mutate({ id: a.id, decision: 'APPROVED' })} disabled={decide.isPending} aria-label={L.approve} className="shrink-0 rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50">✓ {L.approve}</button>
                    <button onClick={() => decide.mutate({ id: a.id, decision: 'REJECTED' })} disabled={decide.isPending} aria-label={L.reject} className="shrink-0 rounded-md border border-rose-300 px-2 py-0.5 text-[11px] font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-900/20">{L.reject}</button>
                  </div>
                ))}
              </div>
              {approvalsQ.data.approvals.length > 3 && (
                <Link to="/approvals" onClick={() => setOpen(false)} className="mt-1 inline-block text-[11px] font-medium text-amber-700 hover:underline dark:text-amber-300">{L.viewAllApprovals(approvalsQ.data.approvals.length - 3)}</Link>
              )}
            </div>
          )}

          <div ref={scrollRef} aria-live="polite" className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {turns.length === 0 && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <AnettAvatar />
                  <div className="rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {L.greetPre}<span className="font-semibold text-violet-600 dark:text-violet-300">Anett</span>{L.greetPost}{canPropose ? L.greetPropose : ''}.
                  </div>
                </div>

                {/* Proactive briefing — overdue tasks needing attention (approvals live in the banner above) */}
                {briefingQ.data && briefingQ.data.projectsWithOverdue.length > 0 && (
                  <div className="ml-10 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 text-xs dark:border-amber-900/50 dark:bg-amber-900/15">
                    <div className="mb-1 font-semibold text-amber-800 dark:text-amber-200">{L.needAttention}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {briefingQ.data.projectsWithOverdue.map((p) => (
                        <button key={p.code} onClick={() => sendText(L.overduePrompt(p.code))} className="rounded-full border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200">
                          ⏰ {L.overdue(p.code, p.count)}
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
                      <div className={i === streamIdx ? 'anett-streaming' : undefined}>
                        <Markdown text={i === streamIdx ? t.content.slice(0, streamLen) : t.content} className="text-sm" />
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span>{t.error ? `⚠️ ${t.content}` : t.content}</span>
                        {t.error && i === turns.length - 1 && (
                          <button onClick={retry} disabled={busy} className="self-start rounded-md bg-amber-600/90 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50">{L.retry}</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {/* Stage C — inline card when Anett staged action proposals this turn (after the typewriter finishes) */}
                {i !== streamIdx && t.proposals && t.proposals.length > 0 && (
                  <div className="ml-10 mt-1.5 rounded-xl border border-violet-200 bg-violet-50/70 p-2.5 text-xs dark:border-violet-800/60 dark:bg-violet-900/20">
                    <div className="mb-1 flex items-center gap-1.5 font-semibold text-violet-700 dark:text-violet-300">{L.proposalsTitle}</div>
                    <ul className="space-y-0.5 text-slate-600 dark:text-slate-300">
                      {t.proposals.map((p, j) => (
                        <li key={j}>• {ACTION_LABELS[p.actionType] ?? p.actionType} · <span className="font-mono">{p.projectCode}</span>{p.routed ? '' : L.waitingApprover}</li>
                      ))}
                    </ul>
                    <Link to="/approvals" onClick={() => setOpen(false)} className="mt-1.5 inline-block font-medium text-violet-700 hover:underline dark:text-violet-300">{L.reviewInApprovals}</Link>
                  </div>
                )}
                {/* Grounded "how-to" navigation — real in-app router links surfaced by the process guide */}
                {i !== streamIdx && t.navigate && t.navigate.length > 0 && (
                  <div className="ml-10 mt-1.5 flex flex-wrap gap-1.5">
                    {t.navigate.map((n, j) => (
                      <Link key={j} to={n.path} onClick={() => setOpen(false)} className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-700 transition hover:bg-violet-50 dark:border-violet-800/60 dark:bg-slate-900 dark:text-violet-300 dark:hover:bg-violet-900/30">
                        {n.label} →
                      </Link>
                    ))}
                  </div>
                )}
                {/* 🧠 Anett stored a durable memory this turn */}
                {i !== streamIdx && t.memories && t.memories.length > 0 && (
                  <div className="ml-10 mt-1.5 flex flex-wrap gap-1.5">
                    {t.memories.map((m, j) => (
                      <span key={j} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-300">
                        🧠 {L.remembering}{m.scope === 'TENANT' ? L.teamSuffix : ''}: {m.content}
                      </span>
                    ))}
                  </div>
                )}
                {/* Data query result — a table Anett built from a natural-language question + CSV export */}
                {i !== streamIdx && t.tables && t.tables.map((tbl, k) => (
                  <div key={k} className="ml-10 mt-1.5 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="max-h-64 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800">
                          <tr>{tbl.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-1 text-left font-semibold text-slate-600 dark:text-slate-300">{c.label}</th>)}</tr>
                        </thead>
                        <tbody>
                          {tbl.rows.map((r, ri) => (
                            <tr key={ri} className="border-t border-slate-100 dark:border-slate-800">
                              {tbl.columns.map((c) => <td key={c.key} className="whitespace-nowrap px-2 py-1 text-slate-700 dark:text-slate-200">{fmtCell(r[c.key])}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                      <span>{L.rowsShown(tbl.rows.length, tbl.total)}</span>
                      <button onClick={() => exportTable(tbl)} className="font-medium text-violet-600 hover:underline dark:text-violet-300">⬇ {L.exportCsv}</button>
                    </div>
                  </div>
                ))}
                {/* Feedback — rate the answer; a 👎 can carry a correction that becomes a memory Anett honors */}
                {t.role === 'assistant' && !t.error && i !== streamIdx && (
                  rated[i] ? (
                    <div className="ml-10 mt-1 text-[11px] text-slate-400 dark:text-slate-500">{rated[i] === 'up' ? L.thanksUp : L.thanksDown}</div>
                  ) : noteFor === i ? (
                    <div className="ml-10 mt-1.5 space-y-1.5">
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        rows={2}
                        maxLength={2000}
                        placeholder={L.notePlaceholder}
                        className="w-full resize-none rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                      <div className="flex gap-1.5">
                        <button onClick={() => rate(i, 'DOWN', noteText.trim())} className="rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700">{L.send}</button>
                        <button onClick={() => rate(i, 'DOWN')} className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">{L.skip}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="ml-10 mt-1 flex items-center gap-1 text-slate-400 dark:text-slate-500">
                      <button onClick={() => rate(i, 'UP')} title={L.likeTitle} aria-label={L.likeAria} className="rounded-md px-1.5 py-0.5 text-sm transition hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-800">👍</button>
                      <button onClick={() => { setNoteFor(i); setNoteText(''); }} title={L.dislikeTitle} aria-label={L.dislikeAria} className="rounded-md px-1.5 py-0.5 text-sm transition hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800">👎</button>
                      {ttsAvailable && (
                        <button onClick={() => toggleSpeak(i)} title={speakingIdx === i ? L.stopReading : L.readAloud} aria-label={speakingIdx === i ? L.stopReading : L.readAloud} className={`grid h-6 w-6 place-items-center rounded-md transition hover:bg-slate-100 dark:hover:bg-slate-800 ${speakingIdx === i ? `text-violet-600 dark:text-violet-300 ${reduce ? '' : 'animate-pulse'}` : 'text-slate-400 hover:text-violet-600'}`}><SpeakerIcon className="h-4 w-4" /></button>
                      )}
                    </div>
                  )
                )}
              </div>
            ))}

            {/* Dynamic follow-up chips after the latest answer — nudge the next useful question */}
            {lastIsAnswer && !busy && streamIdx === null && (
              <div className="ml-10 flex flex-wrap gap-1.5">
                {followups.map((c) => (
                  <button key={c} onClick={() => sendText(c)} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                    {c}
                  </button>
                ))}
              </div>
            )}

            {/* Thinking — live reasoning steps stream in (✓ done), with an active "composing" line */}
            {busy && (
              <div className="flex justify-start gap-2">
                <AnettAvatar thinking />
                <div className="min-w-0 rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2.5 dark:bg-slate-800">
                  {streamSteps.length === 0 ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"><TypingDots reduce={reduce} /><span>{L.thinking}</span></div>
                  ) : (
                    <div className="space-y-1 text-xs">
                      {streamSteps.map((s, k) => (
                        <div key={k} className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><span className="text-emerald-500">✓</span> {s}</div>
                      ))}
                      <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300"><TypingDots reduce={reduce} /><span>{L.composing}</span></div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 p-2 dark:border-slate-800">
            <div className="flex items-end gap-2">
              {listening ? (
                <div className="flex min-h-[2.25rem] flex-1 items-center overflow-hidden rounded-lg border border-rose-300 bg-rose-50/40 dark:border-rose-800/60 dark:bg-rose-900/10">
                  {micStream ? <VoiceListeningBar stream={micStream} /> : <span className={`flex-1 px-3 text-sm text-rose-600 dark:text-rose-400 ${reduce ? '' : 'animate-pulse'}`}>{L.listening}</span>}
                </div>
              ) : (
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(input); } }}
                  placeholder={L.inputPlaceholder}
                  className="max-h-24 min-h-[2.25rem] flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              )}
              {sttAvailable && (
                <button onClick={() => (listening ? stopListening() : startListening())} disabled={busy && !listening} aria-label={listening ? L.voiceStop : L.voiceStart} title={listening ? L.voiceStop : L.voiceStart} className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition disabled:opacity-40 ${listening ? `bg-rose-500 text-white ${reduce ? '' : 'animate-pulse'}` : 'text-slate-500 hover:bg-slate-100 hover:text-violet-600 dark:text-slate-400 dark:hover:bg-slate-800'}`}><MicIcon className="h-5 w-5" /></button>
              )}
              <button onClick={() => sendText(input)} disabled={!input.trim() || busy} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white transition disabled:opacity-40" aria-label={L.send}>➤</button>
            </div>
            {voiceError ? (
              <p className="mt-1 px-1 text-[10px] text-rose-600 dark:text-rose-400">🎤 {voiceError}</p>
            ) : (
              <p className="mt-1 flex items-center gap-1 px-1 text-[10px] text-slate-400 dark:text-slate-500">
                {canPropose ? L.footerPropose : L.footerRead}{L.footerTail}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
