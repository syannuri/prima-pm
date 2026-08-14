import type { ReactNode } from 'react';

// Shared building blocks for the platform (super-admin) "Control Plane" console — reused by the
// Tenants and Guests pages so both read as the same ops surface. See [[prima-pm-platform-console]].

export const KPI_TONE = {
  indigo: 'text-indigo-600 dark:text-indigo-300',
  violet: 'text-violet-600 dark:text-violet-300',
  emerald: 'text-emerald-600 dark:text-emerald-300',
  amber: 'text-amber-600 dark:text-amber-300',
  red: 'text-red-600 dark:text-red-300',
  slate: 'text-slate-700 dark:text-slate-200',
} as const;

export function Kpi({ label, value, tone, hint, pulse }: { label: string; value: ReactNode; tone: keyof typeof KPI_TONE; hint?: string; pulse?: boolean }) {
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      {pulse && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_0_3px_theme(colors.amber.400/0.2)] motion-safe:animate-pulse" />}
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${KPI_TONE[tone]}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</div>}
    </div>
  );
}

// Indigo→fuchsia hero — the visual anchor that sets every platform page apart from tenant pages.
export function ConsoleHero({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-violet-300/40 bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 p-5 text-white shadow-lg dark:border-violet-500/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70">
            <span aria-hidden>◆</span> {eyebrow}
          </div>
          <h1 className="mt-1 text-xl font-bold">{title}</h1>
          <p className="mt-0.5 text-sm text-white/85">{subtitle}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

// Pill-style status filter chips (active = indigo). Generic over the filter key union.
export function FilterChips<T extends string>({ options, value, onChange, labels }: { options: readonly T[]; value: T; onChange: (v: T) => void; labels: Record<T, string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${value === f ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}
        >
          {labels[f]}
        </button>
      ))}
    </div>
  );
}
