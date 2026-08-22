import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGuidedSetup } from '../context/GuidedSetupContext';
import { useLang } from '../context/LanguageContext';
import { GUIDED_STEPS } from '../lib/guidedSetup';

// Non-blocking coach-mark for the guided setup: a pulsing ring around the CURRENT step's target
// element (data-tour anchor) plus a small tooltip with the step title + hint. Deliberately NOT a
// full-screen dim overlay — the user must freely interact with the real form/button being pointed
// at. Hides when the target isn't on the current page (the checklist's hint + "Go" cover that) or
// when an app modal is open. Advancement is automatic (see GuidedSetupContext).
export default function GuidedCoachmark() {
  const g = useGuidedSetup();
  const { lang } = useLang();
  const id = lang === 'id';
  const step = g.active && !g.allDone ? GUIDED_STEPS[g.currentIndex] : undefined;
  const anchor = g.currentAnchor; // step 3 is two-phase (add-task → schedule-baseline)
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!anchor) { setRect(null); return; }
    let last: Element | null = null;
    const measure = () => {
      const dialog = document.querySelector('[aria-modal="true"]'); // stay out of the way of app modals
      const el = !dialog
        ? Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)).find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) ?? null
        : null;
      if (el) {
        if (last !== el) { last = el; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        setRect(el.getBoundingClientRect());
      } else { last = null; setRect(null); }
    };
    measure();
    const iv = window.setInterval(measure, 400);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => { window.clearInterval(iv); window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); };
  }, [anchor]);

  if (!step || !rect) return null;

  const vh = window.innerHeight, vw = window.innerWidth;
  const below = rect.bottom < vh - 170;                 // room for the tooltip under the target?
  const tipTop = below ? rect.bottom + 12 : Math.max(12, rect.top - 12 - 128);
  const tipLeft = Math.min(Math.max(12, rect.left), vw - 300 - 12);

  return createPortal(
    <>
      {/* pulsing highlight ring — pointer-events-none so the target stays fully clickable */}
      <div
        aria-hidden
        className="pointer-events-none fixed z-[45] rounded-xl ring-4 ring-brand-500/70 transition-all duration-300 motion-safe:animate-pulse"
        style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: '0 0 0 9999px rgba(15,23,42,0.02)' }}
      />
      {/* tooltip callout */}
      <div className="fixed z-[46] w-[300px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-brand-200 bg-white p-3 shadow-2xl dark:border-brand-800 dark:bg-slate-900" style={{ left: tipLeft, top: tipTop }}>
        <div className="mb-1 flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[11px] font-bold text-white">{g.currentIndex + 1}</span>
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{step.title[id ? 'id' : 'en']}</span>
        </div>
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{step.hint[id ? 'id' : 'en']}</p>
        <div className="mt-2 text-right">
          <button onClick={g.dismiss} className="text-[11px] font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{id ? 'Lewati' : 'Skip'}</button>
        </div>
      </div>
    </>,
    document.body,
  );
}
