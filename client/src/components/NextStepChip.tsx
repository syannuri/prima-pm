import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { NextStep, NextStepsResult } from '../api/types';
import { IconCompass } from './icons';

// Where each header lifecycle control lives, so an action cue can point the user to it.
const ACTION_HINT: Record<NonNullable<NextStep['action']>, string> = {
  activate: 'Use the “▶ Activate” button at the top of this page.',
  resume: 'Use the “▶ Resume” button at the top of this page.',
  close: 'Use the “Close project” button at the top of this page.',
};

// Compact header chip for the lifecycle "what to do next" guide. Replaces the old full-width
// coral card: coral (= the brand accent) read as an error/alert for what is really neutral
// guidance, so this is an INFORMATIONAL indigo chip that shows the primary next step inline and,
// on click, expands a small popover with the detail + any further steps. Renders nothing when
// there's nothing pending (e.g. a closed project). Closes on outside-click / Esc.
export default function NextStepChip({ projectId, onJump }: { projectId: string; onJump: (tab: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['next-steps', projectId],
    queryFn: () => api.get<{ nextSteps: NextStepsResult }>(`/projects/${projectId}/next-steps`).then((r) => r.nextSteps),
  });

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onEsc);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onEsc); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  if (!data || !data.steps.length) return null;
  const steps = data.steps;
  const primary = steps[0];
  const jump = (tab: string) => { onJump(tab); setOpen(false); };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Next: ${primary.title}${primary.detail ? ` — ${primary.detail}` : ''}`}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700 ring-1 ring-inset ring-indigo-200 transition hover:bg-indigo-100 dark:bg-indigo-900/25 dark:text-indigo-300 dark:ring-indigo-800/60 dark:hover:bg-indigo-900/40"
      >
        <IconCompass className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
        <span className="text-indigo-400 dark:text-indigo-500">Next:</span>
        <span className="max-w-[11rem] truncate font-medium">{primary.title}</span>
        {steps.length > 1 && (
          <span className="rounded-full bg-indigo-100 px-1.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300">+{steps.length - 1}</span>
        )}
        <span aria-hidden className="text-[9px] text-indigo-400 dark:text-indigo-500">▾</span>
      </button>

      {/* z-40 clears the sticky project tab strip (z-[31]) — the popover opens downward into that
          band, so z-30 let the strip paint over it (same fix as the header Margin popover). */}
      {open && (
        <div role="dialog" aria-label="Next steps" className="absolute left-0 z-40 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 flex items-center gap-1.5">
            <IconCompass className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">Next steps</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">· {data.stage}</span>
          </div>
          <ol className="space-y-2.5">
            {steps.map((s, i) => (
              <li key={s.key} className="flex items-start gap-2.5">
                <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                  i === 0 ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                }`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-100">{s.title}</div>
                  {s.detail && <div className="text-[11px] text-slate-500 dark:text-slate-400">{s.detail}</div>}
                  {s.action && <div className="mt-0.5 text-[11px] italic text-slate-400 dark:text-slate-500">{ACTION_HINT[s.action]}</div>}
                  {s.tab && (
                    <button
                      onClick={() => jump(s.tab!)}
                      className="mt-1 inline-flex items-center rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800/60 dark:bg-indigo-900/25 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
                    >
                      Open {s.tab} →
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
