import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { CostSummary, Evm } from '../api/types';
import { Card } from './ui';
import { formatIdr, formatIdrShort, formatDateInput } from '../lib/format';

// Cost summary — replaces the two 10-tile KPI grids with two proportional bars:
//   • Budget (plan) composition:  Direct | Indirect | Contingency | Mgmt Reserve  (over Total Budget)
//   • Actuals & drawdown:         Spent  | Committed | Available                   (over the drawable base)
// The bars make the relationships (which the old tiles only hid in tooltips) visible, use a restrained
// palette, and put the cost-health verdict (CPI) up top. Presentation-only; every figure is preserved.

const num = (d: unknown): number => (d == null ? 0 : Number(d));

interface Seg { key: string; label: string; value: number; cls: string; dot: string }

// A proportional stacked bar with a legend. `over` is the denominator (bar = 100%).
function StackBar({ segs, over }: { segs: Seg[]; over: number }) {
  const denom = over > 0 ? over : segs.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-900/5 dark:bg-slate-800 dark:ring-white/5">
      {segs.map((s) => {
        const pct = Math.max(0, Math.min(100, (Math.max(0, s.value) / denom) * 100));
        if (pct <= 0) return null;
        return <div key={s.key} className={s.cls} style={{ width: `${pct}%` }} title={`${s.label}: ${formatIdr(s.value)}`} />;
      })}
    </div>
  );
}

function Legend({ segs }: { segs: Seg[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
      {segs.map((s) => (
        <div key={s.key} className="flex items-center gap-1.5" title={formatIdr(s.value)}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{s.label}</span>
          <span className="text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatIdrShort(s.value)}</span>
        </div>
      ))}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</p>;
}

export default function CostSummaryPanel({ summary, projectId }: { summary: CostSummary; projectId: string }) {
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

  // Cost health from CPI (EV/AC) — the page's headline verdict, surfaced up top.
  const scheduleBase = `/projects/${projectId}/schedule`;
  const { data: evm } = useQuery({
    queryKey: ['evm', scheduleBase, '', formatDateInput(new Date())],
    queryFn: () => api.get<Evm>(`${scheduleBase}/evm?statusDate=${formatDateInput(new Date())}`),
  });
  const cpi = evm?.cpi ?? null;
  const ac = evm?.ac ?? 0;
  const health = ac <= 0 || cpi == null
    ? { label: 'No spend yet', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
    : cpi >= 0.95 ? { label: 'On budget', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' }
    : cpi >= 0.85 ? { label: 'At risk', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' }
    : { label: 'Over budget', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' };

  const overspent = drawable > 0 && spent > drawable;

  const budgetSegs: Seg[] = [
    { key: 'direct', label: 'Direct', value: direct, cls: 'bg-indigo-500', dot: 'bg-indigo-500' },
    { key: 'indirect', label: 'Indirect', value: indirect, cls: 'bg-violet-400', dot: 'bg-violet-400' },
    { key: 'contingency', label: 'Contingency', value: contingency, cls: 'bg-amber-400', dot: 'bg-amber-400' },
    { key: 'mgmt', label: 'Mgmt Reserve', value: mgmt, cls: 'bg-slate-300 dark:bg-slate-600', dot: 'bg-slate-300 dark:bg-slate-600' },
  ];
  const drawSegs: Seg[] = [
    { key: 'spent', label: 'Spent', value: spent, cls: overspent ? 'bg-red-500' : 'bg-orange-400', dot: overspent ? 'bg-red-500' : 'bg-orange-400' },
    { key: 'committed', label: 'Committed', value: committed, cls: 'bg-indigo-400', dot: 'bg-indigo-400' },
    { key: 'available', label: 'Available', value: Math.max(0, available), cls: 'bg-emerald-400', dot: 'bg-emerald-400' },
  ];

  return (
    <Card>
      {/* Header: hero total + BAC + cost-health verdict */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Total budget</p>
          <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white" title={formatIdr(total)}>{formatIdrShort(total)}</p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">BAC (PMB) <span className="font-semibold text-slate-700 dark:text-slate-200" title={formatIdr(bac)}>{formatIdrShort(bac)}</span> · excl. mgmt reserve</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${health.cls}`}>
            {cpi != null && ac > 0 ? `CPI ${cpi.toFixed(2)} · ${health.label}` : health.label}
          </span>
        </div>
      </div>

      {/* Budget composition (plan) */}
      <div className="mt-5">
        <GroupLabel>Budget (plan)</GroupLabel>
        <StackBar segs={budgetSegs} over={total} />
        <Legend segs={budgetSegs} />
      </div>

      {/* Actuals & drawdown — deep-link target for budget/overspend notifications (?focus=spent). */}
      <div data-cost-focus="spent" className="mt-5">
        <div className="mb-1.5 flex items-center justify-between">
          <GroupLabel>Actuals &amp; drawdown</GroupLabel>
          <span className={`text-[11px] font-semibold tabular-nums ${remaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`} title={`Remaining budget: ${formatIdr(remaining)}`}>
            {formatIdrShort(remaining)} remaining
          </span>
        </div>
        <StackBar segs={drawSegs} over={drawable} />
        <Legend segs={drawSegs} />
        {overspent && <p className="mt-1.5 text-[11px] font-medium text-red-600 dark:text-red-400">Spend exceeds the Direct + Indirect budget.</p>}
      </div>
    </Card>
  );
}
