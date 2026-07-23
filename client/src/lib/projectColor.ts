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
  { solid: 'bg-violet-500',  spine: 'border-l-violet-500',  tint: 'bg-violet-50 dark:bg-transparent',  text: 'text-violet-700 dark:text-violet-300',  ring: 'ring-violet-200 dark:ring-violet-900' },
  { solid: 'bg-sky-500',     spine: 'border-l-sky-500',     tint: 'bg-sky-50 dark:bg-transparent',     text: 'text-sky-700 dark:text-sky-300',        ring: 'ring-sky-200 dark:ring-sky-900' },
  { solid: 'bg-emerald-500', spine: 'border-l-emerald-500', tint: 'bg-emerald-50 dark:bg-transparent', text: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-200 dark:ring-emerald-900' },
  { solid: 'bg-amber-500',   spine: 'border-l-amber-500',   tint: 'bg-amber-50 dark:bg-transparent',   text: 'text-amber-700 dark:text-amber-300',    ring: 'ring-amber-200 dark:ring-amber-900' },
  { solid: 'bg-orange-500',  spine: 'border-l-orange-500',  tint: 'bg-orange-50 dark:bg-transparent',  text: 'text-orange-700 dark:text-orange-300',  ring: 'ring-orange-200 dark:ring-orange-900' },
  { solid: 'bg-pink-500',    spine: 'border-l-pink-500',    tint: 'bg-pink-50 dark:bg-transparent',    text: 'text-pink-700 dark:text-pink-300',      ring: 'ring-pink-200 dark:ring-pink-900' },
  { solid: 'bg-teal-500',    spine: 'border-l-teal-500',    tint: 'bg-teal-50 dark:bg-transparent',    text: 'text-teal-700 dark:text-teal-300',      ring: 'ring-teal-200 dark:ring-teal-900' },
  { solid: 'bg-indigo-500',  spine: 'border-l-indigo-500',  tint: 'bg-indigo-50 dark:bg-transparent',  text: 'text-indigo-700 dark:text-indigo-300',  ring: 'ring-indigo-200 dark:ring-indigo-900' },
];

// Deterministic hash of the id → a stable accent (same project always same colour).
export function projectAccent(id: string): Accent {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}
