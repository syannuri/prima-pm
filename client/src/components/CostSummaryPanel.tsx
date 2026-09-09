import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { CostSummary, Evm, Project } from '../api/types';
import { Card } from './ui';
import { formatIdr, formatIdrShort, formatDateInput } from '../lib/format';
import { StackBar, Legend, SpentRing, type Seg } from './budgetViz';

// Cost summary — two proportional bars replace the old 10-tile KPI walls:
//   • Budget (plan) composition:  Direct | Indirect | Contingency | Mgmt Reserve  (over Total Budget)
//   • Actuals & drawdown:         Spent  | Committed | Available                   (over the drawable base)
// Bars/ring/legend come from the shared budgetViz primitives, so this and the dashboard's Portfolio
// budget band read as one design language. Presentation-only.

const num = (d: unknown): number => (d == null ? 0 : Number(d));

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</p>;
}

// Hero amount: a muted "Rp" prefix + a large, tight, tabular figure.
function Hero({ value }: { value: string }) {
  const m = value.match(/^(Rp)\s*(.*)$/);
  return (
    <p className="mt-0.5 flex items-baseline gap-1.5 text-slate-900 dark:text-white">
      {m ? (
        <>
          <span className="text-sm font-semibold text-slate-400 dark:text-slate-500">{m[1]}</span>
          <span className="text-xl font-bold leading-none tracking-tight tabular-nums">{m[2]}</span>
        </>
      ) : (
        <span className="text-xl font-bold tracking-tight tabular-nums">{value}</span>
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
  // Baseline lock status — a read-only signal here (the setup/lock action lives on the header gate).
  // Shares the ['project'] cache key, so no extra fetch.
  const { data: projectData } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<{ project: Project }>(`/projects/${projectId}`),
  });
  const baselineLocked = !!projectData?.project?.baselineLockedAt;

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
    <Card className="relative overflow-hidden !p-3.5">
      {/* Faint health-tinted wash behind the hero for depth (very low opacity). */}
      <div aria-hidden className={`pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full blur-3xl ${health.dot} opacity-[0.06]`} />

      {/* Header: hero total + BAC on the left, spent-of-BAC ring + CPI verdict on the right */}
      <div className="relative flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Total budget</p>
          <Hero value={formatIdrShort(total)} />
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span>BAC (PMB) <span className="font-semibold text-slate-700 dark:text-slate-200" title={formatIdr(bac)}>{formatIdrShort(bac)}</span> · excl. mgmt reserve</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                baselineLocked
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
              title={baselineLocked ? 'Cost lines & schedule baseline are frozen' : 'Baseline is editable — set it up from the header'}
            >
              {baselineLocked ? '🔒 Baseline locked' : '🔓 Baseline editable'}
            </span>
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
      <div className="mt-2.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
        <GroupLabel>Budget (plan)</GroupLabel>
        <StackBar segs={budgetSegs} over={total} mounted={mounted} />
        <Legend segs={budgetSegs} />
      </div>

      {/* Actuals & drawdown — deep-link target for budget/overspend notifications (?focus=spent). */}
      <div data-cost-focus="spent" className="mt-2.5">
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
