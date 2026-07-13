import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui';
import { useIsMobile } from '../hooks/useIsMobile';

// A "⋯ More" overflow menu for secondary header actions — keeps the primary action prominent
// and tucks the rest away, grouped under headers. On desktop it's a dropdown anchored to the
// trigger; on phones it becomes a full-width bottom sheet (easier to reach, harder to clip).
// Closes on outside-click / Escape / scrim-tap and after any item is chosen.
export default function MoreMenu({ children, title, label = '⋯ More' }: { children: ReactNode; title?: ReactNode; label?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onEsc);
    // Desktop closes on outside-click; the mobile sheet uses an explicit scrim instead.
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (!isMobile) document.addEventListener('mousedown', onDown);
    // Lock body scroll behind the mobile sheet.
    const prevOverflow = isMobile ? document.body.style.overflow : '';
    if (isMobile) document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.removeEventListener('mousedown', onDown);
      if (isMobile) document.body.style.overflow = prevOverflow;
    };
  }, [open, isMobile]);

  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{label}</Button>

      {open && isMobile && (
        // ── Mobile: modal bottom sheet ──
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="prima-slide-up fixed inset-x-0 bottom-0 z-50 flex max-h-[82vh] flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="mx-auto mt-2 h-1.5 w-9 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden />
            <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-2">
              <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200">✕</button>
            </div>
            <div onClick={() => setOpen(false)} className="overflow-y-auto overscroll-contain px-1 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {children}
            </div>
          </div>
        </>
      )}

      {open && !isMobile && (
        // ── Desktop: anchored dropdown ──
        <div role="menu" onClick={() => setOpen(false)}
          className="absolute right-0 z-30 mt-1 max-h-[70vh] min-w-[14rem] overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, disabled, danger, indent, active, icon, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; indent?: boolean; active?: boolean; icon?: ReactNode; children: ReactNode }) {
  const tone = danger
    ? 'text-red-600 dark:text-red-400'
    : active
    ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/25 dark:text-brand-200'
    : indent
    ? 'text-slate-500 dark:text-slate-400'
    : 'text-slate-700 dark:text-slate-200';
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 py-2.5 pr-3 text-left text-sm transition disabled:opacity-50 sm:py-2 ${active ? 'border-l-2 border-brand-500' : 'border-l-2 border-transparent'} ${active ? '' : 'hover:bg-slate-50 dark:hover:bg-slate-800'} ${indent ? 'pl-9 text-[13px]' : 'pl-3'} ${tone}`}
    >
      {/* Keep labels aligned whether or not an item has an icon (indented sub-items get none). */}
      {!indent && <span className="w-4 shrink-0 text-center text-[15px] leading-none">{icon ?? ''}</span>}
      <span className="flex-1 truncate">{children}</span>
      {active && <span aria-hidden className="shrink-0 text-brand-500 dark:text-brand-300">✓</span>}
    </button>
  );
}

// A top-level section label inside the menu (e.g. "Actions", "Jump to").
export function MenuHeader({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</div>;
}

// A second-level group label (e.g. the PMBOK phase groups under "Jump to").
export function MenuGroupHeader({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 flex items-center gap-1.5 px-3 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-brand-600/80 dark:text-brand-400/80">
      <span aria-hidden className="text-[8px]">▸</span>{children}
    </div>
  );
}

export function MenuDivider() {
  return <div className="my-1 border-t border-slate-100 dark:border-slate-800" />;
}
