import type { ReactNode } from 'react';

// Reusable KPI icon-chips for the Cost + Overview cards. No icon dependency — hand-picked
// inline SVGs (24×24 stroke, matching the app's existing inline-SVG style), each paired with a
// semantic accent so a card's theme reads at a glance:
//   cool tones (blue/violet/indigo/sky/teal) = budget & plan structure
//   amber = risk reserve · slate = locked reserve
//   orange = money going out · emerald/teal = headroom & positive result.
export type Accent =
  | 'blue' | 'violet' | 'amber' | 'slate' | 'emerald'
  | 'teal' | 'indigo' | 'orange' | 'sky' | 'rose';

// Static literal class strings only — Tailwind must see the full class name to keep it.
const CHIP: Record<Accent, string> = {
  blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300',
  violet: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300',
  amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
  slate: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300',
  emerald: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300',
  teal: 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300',
  indigo: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300',
  orange: 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300',
  sky: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300',
  rose: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300',
};

// Soft themed card surface per accent — a faint top-tinted gradient (colour → the card's own
// white/slate base) plus a matching hairline border, so a card's whole surface echoes its theme
// without hurting text contrast. Pass to a `Card`/`Panel` via className. `!border-*` beats the
// Card's default slate border; the gradient is a background-image layered over the base colour.
const SURFACE: Record<Accent, string> = {
  blue: 'bg-gradient-to-b from-blue-50 to-white !border-blue-300/70 dark:from-blue-950/40 dark:to-slate-900 dark:!border-blue-900/50',
  violet: 'bg-gradient-to-b from-violet-50 to-white !border-violet-300/70 dark:from-violet-950/40 dark:to-slate-900 dark:!border-violet-900/50',
  amber: 'bg-gradient-to-b from-amber-50 to-white !border-amber-300/70 dark:from-amber-950/40 dark:to-slate-900 dark:!border-amber-900/50',
  slate: 'bg-gradient-to-b from-slate-100 to-white !border-slate-300/70 dark:from-slate-800/50 dark:to-slate-900 dark:!border-slate-700/60',
  emerald: 'bg-gradient-to-b from-emerald-50 to-white !border-emerald-300/70 dark:from-emerald-950/40 dark:to-slate-900 dark:!border-emerald-900/50',
  teal: 'bg-gradient-to-b from-teal-50 to-white !border-teal-300/70 dark:from-teal-950/40 dark:to-slate-900 dark:!border-teal-900/50',
  indigo: 'bg-gradient-to-b from-indigo-50 to-white !border-indigo-300/70 dark:from-indigo-950/40 dark:to-slate-900 dark:!border-indigo-900/50',
  orange: 'bg-gradient-to-b from-orange-50 to-white !border-orange-300/70 dark:from-orange-950/40 dark:to-slate-900 dark:!border-orange-900/50',
  sky: 'bg-gradient-to-b from-sky-50 to-white !border-sky-300/70 dark:from-sky-950/40 dark:to-slate-900 dark:!border-sky-900/50',
  rose: 'bg-gradient-to-b from-rose-50 to-white !border-rose-300/70 dark:from-rose-950/40 dark:to-slate-900 dark:!border-rose-900/50',
};

// The themed card-surface classes for an accent (see SURFACE).
export function accentSurface(accent: Accent) {
  return SURFACE[accent];
}

export type IconName =
  | 'box' | 'layers' | 'shield' | 'lock' | 'target' | 'wallet'
  | 'link' | 'outflow' | 'coins' | 'check' | 'trendingUp'
  | 'listChecks' | 'clock' | 'lineChart' | 'activity';

const PATHS: Record<IconName, ReactNode> = {
  box: (<><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></>),
  layers: (<><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" /></>),
  shield: (<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />),
  lock: (<><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
  target: (<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>),
  wallet: (<><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></>),
  link: (<><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><line x1="8" x2="16" y1="12" y2="12" /></>),
  outflow: (<><circle cx="12" cy="12" r="10" /><path d="M12 8v8" /><path d="m8 12 4 4 4-4" /></>),
  coins: (<><circle cx="8" cy="8" r="6" /><path d="M18.09 10.37A6 6 0 1 1 10.34 18" /><path d="M7 6h1v4" /><path d="m16.71 13.88.7.71-2.82 2.82" /></>),
  check: (<><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>),
  trendingUp: (<><path d="M16 7h6v6" /><path d="m22 7-8.5 8.5-5-5L2 17" /></>),
  listChecks: (<><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></>),
  clock: (<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>),
  lineChart: (<><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="m19 9-5 5-4-4-3 3" /></>),
  activity: (<path d="M22 12h-4l-3 9L9 3l-3 9H2" />),
};

// A rounded, tinted chip carrying a themed icon. Default box is 7×7 with a 4×4 glyph — the
// caller can override sizing via `className` (e.g. 'h-6 w-6' for tighter headers).
export function KpiIcon({ name, accent, className }: { name: IconName; accent: Accent; className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-lg ${CHIP[accent]} ${className ?? 'h-7 w-7'}`}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {PATHS[name]}
      </svg>
    </span>
  );
}
