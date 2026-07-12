import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui';

// A "⋯ More" overflow dropdown for secondary header actions — keeps the primary action prominent
// and tucks the rest away. Closes on outside-click / Escape and after any item is chosen.
export default function MoreMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" onClick={() => setOpen((o) => !o)}>⋯ More</Button>
      {open && (
        <div role="menu" onClick={() => setOpen(false)}
          className="absolute right-0 z-30 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, disabled, danger, indent, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; indent?: boolean; children: ReactNode }) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 py-2 pr-3 text-left text-sm transition disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800 ${indent ? 'pl-7' : 'pl-3'} ${danger ? 'text-red-600 dark:text-red-400' : indent ? 'text-slate-500 dark:text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}
    >
      {children}
    </button>
  );
}

// A small non-interactive section label inside the menu.
export function MenuHeader({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</div>;
}

export function MenuDivider() {
  return <div className="my-1 border-t border-slate-100 dark:border-slate-800" />;
}
