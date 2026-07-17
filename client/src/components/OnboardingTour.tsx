import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOnboarding } from '../context/OnboardingContext';
import { useLang } from '../context/LanguageContext';
import { TOUR_STEPS } from '../lib/onboarding';

const PAD = 8;          // breathing room around the highlighted element
const POP_W = 340;      // popover width
const MARGIN = 12;      // gap between element and popover / viewport edges

// Renders the guided tour: a dimmed backdrop with a "hole" cut around the current step's target
// element (via 4 rectangles, so the target stays clickable), a highlight ring, and a popover with
// step copy + controls. When a modal/confirm dialog is open, it docks to a small bottom card so it
// never blocks the dialog. Falls back to a centered card when the step has no on-screen anchor.
export default function OnboardingTour() {
  const { active, index, total, next, back, finish, skip } = useOnboarding();
  const { lang } = useLang();
  const step = active ? TOUR_STEPS[index] : null;

  const [rect, setRect] = useState<DOMRect | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const lastEl = useRef<Element | null>(null);

  // Never carry a stale "skip?" prompt into a fresh run (e.g. a replay via the header).
  useEffect(() => { if (active) setConfirmSkip(false); }, [active]);

  // Track the target element's position (it may appear late, move, or vanish across pages).
  useLayoutEffect(() => {
    if (!step) { setRect(null); lastEl.current = null; return; }
    lastEl.current = null;
    const measure = () => {
      // A real app modal/confirm (they set aria-modal="true") takes priority — dock out of its way.
      // Note: our own popover card uses role="dialog" WITHOUT aria-modal, so it isn't matched here.
      const dialog = document.querySelector('[aria-modal="true"]');
      setModalOpen(!!dialog);
      // A step's anchor may appear on more than one element (e.g. a desktop button + a mobile FAB);
      // pick the first one that's actually visible so we never spotlight a display:none duplicate.
      const el = step.anchor && !dialog
        ? Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${step.anchor}"]`))
            .find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) ?? null
        : null;
      if (el) {
        if (lastEl.current !== el) { lastEl.current = el; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        setRect(el.getBoundingClientRect());
      } else {
        lastEl.current = null;
        setRect(null);
      }
    };
    measure();
    const id = window.setInterval(measure, 300);
    const onMove = () => measure();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => { window.clearInterval(id); window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true); };
  }, [step]);

  // Keyboard: Esc skips, →/← navigate.
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setConfirmSkip((c) => !c); return; } // open the skip prompt, or cancel it
      if (confirmSkip) return; // arrows are inert while confirming
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active, next, back, confirmSkip]);

  if (!step) return null;

  // "Skip the whole tour?" confirmation — a clear centered takeover so the guest doesn't dismiss
  // the tour by accident. Reassures them it can be reopened from the header.
  if (confirmSkip) {
    return createPortal(
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
        <div className="prima-rise w-[340px] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900" role="dialog" aria-label="Skip tour">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{lang === 'id' ? 'Lewati panduan?' : 'Skip the tour?'}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {lang === 'id'
              ? 'Anda bisa membukanya lagi kapan saja lewat ikon kompas 🧭 di header.'
              : 'You can reopen it anytime from the compass icon 🧭 in the header.'}
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button onClick={() => setConfirmSkip(false)} className="rounded-lg bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700">
              {lang === 'id' ? 'Lanjutkan panduan' : 'Keep touring'}
            </button>
            <button onClick={skip} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
              {lang === 'id' ? 'Ya, lewati' : 'Yes, skip'}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  const isLast = index === total - 1;
  const spotlight = !!rect && !modalOpen;

  // Popover placement: below the target if there's room, else above; clamped to the viewport.
  let popTop = 0, popLeft = 0;
  if (spotlight && rect) {
    const below = rect.bottom + PAD + MARGIN;
    const vh = window.innerHeight, vw = window.innerWidth;
    popLeft = Math.min(Math.max(rect.left, MARGIN), vw - POP_W - MARGIN);
    popTop = below + 220 < vh ? below : Math.max(MARGIN, rect.top - PAD - MARGIN - 220);
  }

  const card = (
    <div
      className="prima-rise pointer-events-auto w-[340px] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      role="dialog"
      aria-label="Onboarding"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-2xl" aria-hidden>{step.emoji}</span>
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{index + 1} / {total}</span>
      </div>
      <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{step.title[lang]}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{step.body[lang]}</p>

      {/* progress dots */}
      <div className="mt-3 flex gap-1" aria-hidden>
        {TOUR_STEPS.map((s, i) => (
          <span key={s.id} className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button onClick={() => setConfirmSkip(true)} className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          {lang === 'id' ? 'Lewati' : 'Skip'}
        </button>
        <div className="flex items-center gap-2">
          {index > 0 && (
            <button onClick={back} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              {lang === 'id' ? 'Kembali' : 'Back'}
            </button>
          )}
          <button
            onClick={isLast ? finish : next}
            className="rounded-lg bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            {isLast ? (lang === 'id' ? 'Selesai' : 'Done') : (lang === 'id' ? 'Lanjut' : 'Next')}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      {spotlight && rect ? (
        <>
          {/* Four dim panes leave a clickable hole over the target. */}
          <div className="fixed left-0 top-0 w-full bg-black/65" style={{ height: Math.max(0, rect.top - PAD) }} />
          <div className="fixed left-0 w-full bg-black/65" style={{ top: rect.bottom + PAD, bottom: 0 }} />
          <div className="fixed bg-black/65" style={{ top: rect.top - PAD, left: 0, width: Math.max(0, rect.left - PAD), height: rect.height + 2 * PAD }} />
          <div className="fixed bg-black/65" style={{ top: rect.top - PAD, left: rect.right + PAD, right: 0, height: rect.height + 2 * PAD }} />
          {/* Highlight ring around the target (does not block its clicks). */}
          <div
            className="pointer-events-none fixed rounded-xl ring-2 ring-brand-400 ring-offset-2 ring-offset-transparent animate-pulse motion-reduce:animate-none"
            style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD, boxShadow: '0 0 0 4px rgba(244,103,95,0.25)' }}
          />
          {/* Popover anchored near the target. */}
          <div className="fixed" style={{ top: popTop, left: popLeft }}>{card}</div>
        </>
      ) : (
        // Centered mode: welcome/finish, or a step whose anchor isn't on screen yet (e.g. a modal is
        // open, or a tab hasn't been opened) — the copy still tells the guest what to do next.
        <div className={`fixed inset-0 flex p-4 ${modalOpen ? 'items-end justify-center pb-24' : 'items-center justify-center bg-black/65 backdrop-blur-sm'}`}>
          {card}
        </div>
      )}
    </div>,
    document.body,
  );
}
