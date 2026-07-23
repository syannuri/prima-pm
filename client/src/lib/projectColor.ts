// Monday.com-style per-project accent colours. Each project gets a stable colour derived from its
// id (NOT its status) — a decorative identity accent used for card/row spines, the sidebar square
// and tinted surfaces. This deliberately relaxes the older "colour = meaning only" rule for a more
// vivid, colourful light mode (user direction 2026-07-23). All class strings are STATIC literals so
// Tailwind's content scanner keeps them (never build `bg-${x}` dynamically).

export type Accent = {
  solid: string;   // filled square/dot background
  spine: string;   // left border-colour for a card/row spine (pairs with border-l-4)
  tint: string;    // faint tinted surface (light); neutralised in dark
  text: string;    // readable accent text on a light surface
  ring: string;    // subtle ring/border
};

const ACCENTS: Accent[] = [
  { solid: 'bg-blue-600',    spine: 'border-l-blue-600',    tint: 'bg-blue-50 dark:bg-transparent',    text: 'text-blue-700 dark:text-blue-300',      ring: 'ring-blue-200 dark:ring-blue-900' },
  { solid: 'bg-sky-500',     spine: 'border-l-sky-500',     tint: 'bg-sky-50 dark:bg-transparent',     text: 'text-sky-700 dark:text-sky-300',        ring: 'ring-sky-200 dark:ring-sky-900' },
  { solid: 'bg-emerald-600', spine: 'border-l-emerald-600', tint: 'bg-emerald-50 dark:bg-transparent', text: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-200 dark:ring-emerald-900' },
  { solid: 'bg-amber-500',   spine: 'border-l-amber-500',   tint: 'bg-amber-50 dark:bg-transparent',   text: 'text-amber-700 dark:text-amber-300',    ring: 'ring-amber-200 dark:ring-amber-900' },
  { solid: 'bg-orange-600',  spine: 'border-l-orange-600',  tint: 'bg-orange-50 dark:bg-transparent',  text: 'text-orange-700 dark:text-orange-300',  ring: 'ring-orange-200 dark:ring-orange-900' },
  { solid: 'bg-slate-500',   spine: 'border-l-slate-500',   tint: 'bg-slate-50 dark:bg-transparent',   text: 'text-slate-700 dark:text-slate-300',    ring: 'ring-slate-200 dark:ring-slate-800' },
  { solid: 'bg-teal-600',    spine: 'border-l-teal-600',    tint: 'bg-teal-50 dark:bg-transparent',    text: 'text-teal-700 dark:text-teal-300',      ring: 'ring-teal-200 dark:ring-teal-900' },
  { solid: 'bg-cyan-600',    spine: 'border-l-cyan-600',    tint: 'bg-cyan-50 dark:bg-transparent',    text: 'text-cyan-700 dark:text-cyan-300',      ring: 'ring-cyan-200 dark:ring-cyan-900' },
];

// Deterministic hash of the id → a stable accent (same project always same colour).
export function projectAccent(id: string): Accent {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}
