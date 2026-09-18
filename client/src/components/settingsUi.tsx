import type { ReactNode } from 'react';

// ── Settings design system — "inset grouped rows" (Notion/Apple) ─────────────────────────────────
// A titled group is an uppercase caption (+ optional description and a right-aligned action) sitting
// ABOVE a flat, rounded, hairline-bordered container. Two container modes:
//   • flush (row mode)  — hairline dividers between `SettingsRow`s; rows carry their own padding.
//   • panel (default)   — padded box that wraps a form/table (used by the richer setting cards).
// Deliberately NO `overflow-hidden` on the box: it must not clip Select menus / popovers opened
// inside the richer cards (the same reason the shared Card avoids it).

export function SettingsGroup({
  title,
  sub,
  action,
  flush = false,
  children,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section>
      {(title || sub || action) && (
        <div className="mb-2 flex items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            {title && <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</h3>}
            {sub && <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{sub}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div
        className={`rounded-2xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900 ${
          flush ? 'divide-y divide-slate-100 dark:divide-slate-800/70' : 'p-4 sm:p-5'
        }`}
      >
        {children}
      </div>
    </section>
  );
}

// A single setting inside a `flush` group: label (+ optional description) left, control right. Pass
// `align="start"` when the control is tall (e.g. a stacked segmented block) so it tops-aligns.
export function SettingsRow({
  title,
  sub,
  align = 'center',
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  align?: 'center' | 'start';
  children?: ReactNode;
}) {
  return (
    <div className={`flex ${align === 'start' ? 'items-start' : 'items-center'} justify-between gap-4 px-4 py-3.5`}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{title}</div>
        {sub && <div className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{sub}</div>}
      </div>
      {children != null && <div className="shrink-0">{children}</div>}
    </div>
  );
}
