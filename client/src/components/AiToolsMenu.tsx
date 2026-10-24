import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useLang } from '../context/LanguageContext';
import GuestAiNote, { useIsGuest } from './GuestAiNote';
import ExtractFromNotes from './ExtractFromNotes';

type Tool = 'extract' | null;

// "AI tools" — a single collapsed toggle at the top of the project Overview that gathers the
// project's AI-powered tools (currently Extract-from-notes; room for more) behind one dropdown,
// instead of each tool sitting always-on in the layout. Gated on the project's AI availability so
// the toggle never opens to an empty menu; guests with AI off still see the GuestAiNote nudge.
//
// The dropdown only holds the *triggers*; each tool's modal is rendered here, OUTSIDE the dropdown,
// driven by `tool`. That way launching a tool (which closes the dropdown) does not unmount its modal.
export default function AiToolsMenu({ projectId }: { projectId: string }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const isGuest = useIsGuest();
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool>(null);
  const ref = useRef<HTMLDivElement>(null);

  const aiQ = useQuery({
    queryKey: ['ai-available', projectId],
    queryFn: () => api.get<{ aiAvailable: boolean }>(`/projects/${projectId}/ai-available`),
    staleTime: 5 * 60_000,
  });

  // Close the dropdown on outside-click / Esc. Only active while open, so it never fires once a tool
  // modal has taken over (dropdown already closed).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  if (!aiQ.data?.aiAvailable) return isGuest ? <div className="flex justify-end"><GuestAiNote /></div> : null;

  const label = id ? 'Alat AI' : 'AI tools';
  const launch = (t: Tool) => { setTool(t); setOpen(false); };
  return (
    <div className="flex justify-end">
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-200 dark:hover:bg-violet-500/25"
        >
          <span aria-hidden>✨</span>{label}
          <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </button>
        {open && (
          <div role="menu" className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
            <button role="menuitem" onClick={() => launch('extract')} className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800">
              <span className="mt-0.5 text-base" aria-hidden>✨</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{id ? 'Ekstrak dari catatan' : 'Extract from notes'}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{id ? 'Tarik progres tugas & isu dari catatan rapat' : 'Pull task progress & issues from meeting notes'}</span>
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Tool modals — rendered outside the dropdown so they survive it closing. */}
      <ExtractFromNotes projectId={projectId} open={tool === 'extract'} onClose={() => setTool(null)} />
    </div>
  );
}
