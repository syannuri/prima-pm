import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { CostSummary, Evm } from '../api/types';
import { Card } from './ui';
import { formatIdr, formatIdrShort, formatDateInput } from '../lib/format';

// Cost summary — two proportional bars replace the old 10-tile KPI walls:
//   • Budget (plan) composition:  Direct | Indirect | Contingency | Mgmt Reserve  (over Total Budget)
//   • Actuals & drawdown:         Spent  | Committed | Available                   (over the drawable base)
// Richer presentation pass: gradient segment fills with hairline separators, a spent-of-BAC progress
// ring beside the hero, a mount-in width animation, and refined hero typography. Presentation-only.

const num = (d: unknown): number => (d == null ? 0 : Number(d));

interface Seg { key: string; label: string; value: number; grad: string }

// A proportional stacked bar with gradient segments, hairline separators (the 2px flex gap shows the
// track colour through), an inner shadow, and a width transition that plays once `mounted` flips true.
function StackBar({ segs, over, mounted }: { segs: Seg[]; over: number; mounted: boolean }) {
  const denom = over > 0 ? over : segs.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  return (
    <div className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full bg-slate-100 shadow-inner ring-1 ring-slate-900/5 dark:bg-slate-800 dark:ring-white/5">
      {segs.map((s) => {
        const pct = Math.max(0, Math.min(100, (Math.max(0, s.value) / denom) * 100));
        if (pct <= 0) return null;
        return (
          <div
            key={s.key}
            className={`h-full bg-gradient-to-b ${s.grad} transition-[width] duration-700 ease-out first:rounded-l-full last:rounded-r-full`}
            style={{ width: mounted ? `${pct}%` : '0%' }}
            title={`${s.label}: ${formatIdr(s.value)}`}
          />
        );
      })}
    </div>
  );
}

function Legend({ segs }: { segs: Seg[] }) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
      {segs.map((s) => (
        <div key={s.key} className="flex items-center gap-1.5" title={formatIdr(s.value)}>
          <span className={`h-2 w-2 shrink-0 rounded-full bg-gradient-to-b ${s.grad}`} />
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{s.label}</span>
          <span className="text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatIdrShort(s.value)}</span>
        </div>
      ))}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</p>;
}

// A compact progress ring (spent as a share of BAC). Animates its sweep in with `mounted`.
function SpentRing({ pct, stroke, mounted }: { pct: number; stroke: string; mounted: boolean }) {
  const r = 26;
  const C = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = mounted ? C * (1 - clamped / 100) : C;
  return (
    <div className="relative h-[68px] w-[68px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-slate-100 dark:stroke-slate-800" />
        <circle
          cx="32" cy="32" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
          className={stroke}
          strokeDasharray={C}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 800ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{Math.round(clamped)}%</span>
        <span className="text-[9px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">spent</span>
      </div>
    </div>
  );
}

// Hero amount: a muted "Rp" prefix + a large, tight, tabular figure.
function Hero({ value }: { value: string }) {
  const m = value.match(/^(Rp)\s*(.*)$/);
  return (
    <p className="mt-1 flex items-baseline gap-1.5 text-slate-900 dark:text-white">
      {m ? (
        <>
          <span className="text-lg font-semibold text-slate-400 dark:text-slate-500">{m[1]}</span>
          <span className="text-[30px] font-bold leading-none tracking-tight tabular-nums">{m[2]}</span>
        </>
      ) : (
        <span className="text-[30px] font-bold tracking-tight tabular-nums">{value}</span>
      )}
    </p>
  );
}

export default function CostSummaryPanel({ summary, projectId }: { summary: CostSummary; projectId: string }) {
  // Play the fill/sweep animation once, just after first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(t); }, []);

  const b = summary.baseline;
  const allLines = [...summary.directCosts, ...summary.indirectCosts];
  const spent = allLines.reduce((s, l) => s + l.actualToDate, 0);
  const remaining = allLines.reduce((s, l) => s + l.remaining, 0);
  const committed = summary.committedTotal ?? 0;
  const available = summary.availableTotal ?? 0;

  const direct = num(b?.directTotal);
  const indirect = num(b?.indirectTotal);
  const contingency = num(b?.contingencyReserve);
  const mgmt = num(b?.managementReserve);
  const bac = num(b?.costBaseline);
  const total = num(b?.budgetAtCompletion) || direct + indirect + contingency + mgmt;
  const drawable = direct + indirect; // reserves aren't drawn down by actuals
  const spentPct = bac > 0 ? (spent / bac) * 100 : 0;

  // Cost health from CPI (EV/AC) — drives the chip + the ring colour.
  const scheduleBase = `/projects/${projectId}/schedule`;
  const { data: evm } = useQuery({
    queryKey: ['evm', scheduleBase, '', formatDateInput(new Date())],
    queryFn: () => api.get<Evm>(`${scheduleBase}/evm?statusDate=${formatDateInput(new Date())}`),
  });
  const cpi = evm?.cpi ?? null;
  const ac = evm?.ac ?? 0;
  const health = ac <= 0 || cpi == null
    ? { label: 'No spend yet', chip: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400', dot: 'bg-slate-400', stroke: 'stroke-slate-300 dark:stroke-slate-600' }
    : cpi >= 0.95 ? { label: 'On budget', chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-emerald-500', stroke: 'stroke-emerald-500' }
    : cpi >= 0.85 ? { label: 'At risk', chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', dot: 'bg-amber-500', stroke: 'stroke-amber-500' }
    : { label: 'Over budget', chip: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', dot: 'bg-red-500', stroke: 'stroke-red-500' };

  const overspent = drawable > 0 && spent > drawable;

  const budgetSegs: Seg[] = [
    { key: 'direct', label: 'Direct', value: direct, grad: 'from-indigo-500 to-indigo-400' },
    { key: 'indirect', label: 'Indirect', value: indirect, grad: 'from-violet-500 to-violet-400' },
    { key: 'contingency', label: 'Contingency', value: contingency, grad: 'from-amber-400 to-amber-300' },
    { key: 'mgmt', label: 'Mgmt Reserve', value: mgmt, grad: 'from-slate-300 to-slate-200 dark:from-slate-600 dark:to-slate-700' },
  ];
  const drawSegs: Seg[] = [
    { key: 'spent', label: 'Spent', value: spent, grad: overspent ? 'from-red-500 to-red-400' : 'from-orange-500 to-orange-400' },
    { key: 'committed', label: 'Committed', value: committed, grad: 'from-indigo-400 to-indigo-300' },
    { key: 'available', label: 'Available', value: Math.max(0, available), grad: 'from-emerald-500 to-emerald-400' },
  ];

  return (
    <Card className="relative overflow-hidden">
      {/* Faint health-tinted wash behind the hero for depth (very low opacity). */}
      <div aria-hidden className={`pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full blur-3xl ${health.dot} opacity-[0.06]`} />

      {/* Header: hero total + BAC on the left, spent-of-BAC ring + CPI verdict on the right */}
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Total budget</p>
          <Hero value={formatIdrShort(total)} />
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            BAC (PMB) <span className="font-semibold text-slate-700 dark:text-slate-200" title={formatIdr(bac)}>{formatIdrShort(bac)}</span> · excl. mgmt reserve
          </p>
        </div>
        <div className="flex items-center gap-4">
          {bac > 0 && <SpentRing pct={spentPct} stroke={health.stroke} mounted={mounted} />}
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${health.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${health.dot}`} />
            {cpi != null && ac > 0 ? `CPI ${cpi.toFixed(2)} · ${health.label}` : health.label}
          </span>
        </div>
      </div>

      {/* Budget composition (plan) */}
      <div className="mt-5 border-t border-slate-100 pt-5 dark:border-slate-800">
        <GroupLabel>Budget (plan)</GroupLabel>
        <StackBar segs={budgetSegs} over={total} mounted={mounted} />
        <Legend segs={budgetSegs} />
      </div>

      {/* Actuals & drawdown — deep-link target for budget/overspend notifications (?focus=spent). */}
      <div data-cost-focus="spent" className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <GroupLabel>Actuals &amp; drawdown</GroupLabel>
          <span className={`text-[11px] font-semibold tabular-nums ${remaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`} title={`Remaining budget: ${formatIdr(remaining)}`}>
            {formatIdrShort(remaining)} remaining
          </span>
        </div>
        <StackBar segs={drawSegs} over={drawable} mounted={mounted} />
        <Legend segs={drawSegs} />
        {overspent && <p className="mt-1.5 text-[11px] font-medium text-red-600 dark:text-red-400">Spend exceeds the Direct + Indirect budget.</p>}
      </div>
    </Card>
  );
}
