import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Evm } from '../api/types';
import { Badge, Card, Field, Input, SectionTitle } from './ui';
import { formatDate, formatDateInput, formatIdr, formatNum } from '../lib/format';

// Shared "Project Health (EVM)" panel. Reads `${base}/evm?statusDate=&actualCost=`,
// so it works for the WBS schedule (base = …/schedule) and the agile/hybrid EVM
// (base = …/agile) alike — every methodology renders the same EVM + RAG health.
export default function EvmHealth({
  base,
  sub = 'Earned Value Management — schedule + cost + progress',
  countLabel = 'leaf tasks',
  progressHint = 'Physical % complete — WBS-weighted roll-up (budget-weighted when cost-loaded, else duration-weighted)',
  noBaselineHint,
}: {
  base: string;
  sub?: string;
  countLabel?: string;
  progressHint?: string;
  noBaselineHint?: ReactNode;
}) {
  const [acOverride, setAcOverride] = useState('');
  const [statusDate, setStatusDate] = useState(formatDateInput(new Date()));
  const [showAll, setShowAll] = useState(false);
  const evmQ = useQuery({
    queryKey: ['evm', base, acOverride, statusDate],
    queryFn: () =>
      api.get<Evm>(
        `${base}/evm?statusDate=${statusDate}${acOverride !== '' ? `&actualCost=${Number(acOverride)}` : ''}`,
      ),
  });
  const e = evmQ.data;
  const hColor = e?.health === 'GREEN' ? 'green' : e?.health === 'AMBER' ? 'amber' : e?.health === 'NO_DATA' ? 'slate' : 'red';
  const hLabel = e?.health === 'NO_DATA' ? 'No data' : e?.health;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <SectionTitle sub={sub}>Project Health (EVM)</SectionTitle>
        <div className="flex items-end gap-2">
          <Field label="AC override (blank = recorded)"><Input type="number" placeholder="recorded AC" value={acOverride} onChange={(e2) => setAcOverride(e2.target.value)} /></Field>
          <Field label="Status date"><Input type="date" value={statusDate} onChange={(e2) => setStatusDate(e2.target.value)} /></Field>
        </div>
      </div>
      {e && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <Badge color={hColor}>Health: {hLabel}</Badge>
            <span className="text-sm text-slate-500 dark:text-slate-400" title={progressHint}>{formatNum(e.scheduleProgress * 100, 1)}% complete · {e.leafTaskCount} {countLabel}</span>
          </div>
          {/* Hero metrics — the four decision-drivers, elevated so the eye lands on them first. */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <HeroMetric label="Cost index (CPI)" value={e.ac > 0 ? formatNum(e.cpi, 2) : '—'} warn={e.ac > 0 && e.cpi < 1} good={e.ac > 0 && e.cpi >= 1} title="Cost Performance Index = EV / AC. >1 under budget, <1 over budget." />
            <HeroMetric label="Schedule index (SPI)" value={e.pv > 0 ? formatNum(e.spi, 2) : '—'} warn={e.pv > 0 && e.spi < 1} good={e.pv > 0 && e.spi >= 1} title="Schedule Performance Index = EV / PV. >1 ahead, <1 behind." />
            <HeroMetric label="Budget (BAC)" value={formatIdr(e.bac)} title="Budget at Completion = the Performance Measurement Baseline (direct + indirect + contingency; excludes management reserve)." />
            <HeroMetric label="Forecast (EAC)" value={formatIdr(e.eac)} warn={e.eac > e.bac} title="Estimate at Completion — projected final cost." />
          </div>
          {/* Detailed figures — collapsed by default to keep the panel scannable. */}
          <button
            onClick={() => setShowAll((s) => !s)}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {showAll ? 'Hide' : 'Show'} all EVM figures
            <svg viewBox="0 0 20 20" className={`h-3.5 w-3.5 transition-transform ${showAll ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {showAll && (
            <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <Metric label="PV" value={formatIdr(e.pv)} title="Planned Value (BCWS)" />
              <Metric label="EV" value={formatIdr(e.ev)} title="Earned Value (BCWP)" />
              <Metric label="AC" value={formatIdr(e.ac)} title="Actual Cost (ACWP)" />
              <Metric label="CV" value={formatIdr(e.cv)} warn={e.cv < 0} title="Cost Variance = EV − AC" />
              <Metric label="SV" value={formatIdr(e.sv)} warn={e.sv < 0} title="Schedule Variance = EV − PV" />
              <Metric label="ETC" value={formatIdr(e.etc)} title="Estimate to Complete = EAC − AC" />
              <Metric label="VAC" value={formatIdr(e.vac)} warn={e.vac < 0} title="Variance at Completion = BAC − EAC" />
              <Metric label="TCPI" value={e.bac > e.ac ? formatNum(e.tcpi, 3) : '—'} warn={e.bac > e.ac && e.tcpi > 1} title="To-Complete Performance Index = (BAC − EV) / (BAC − AC)" />
            </div>
          )}
          {/* Schedule baseline variance (finish vs baseline) — shown when a WBS baseline exists. */}
          {e.scheduleBaselinedAt ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500 dark:text-slate-400">Schedule variance:</span>
              <span className="text-slate-700 dark:text-slate-200">finish {formatDate(e.currentFinish)} vs baseline {formatDate(e.baselineFinish)}</span>
              {e.finishVarianceDays != null && (
                <Badge color={e.finishVarianceDays > 0 ? 'red' : e.finishVarianceDays < 0 ? 'green' : 'slate'}>
                  {e.finishVarianceDays > 0 ? `+${e.finishVarianceDays}d late` : e.finishVarianceDays < 0 ? `${e.finishVarianceDays}d early` : 'On schedule'}
                </Badge>
              )}
            </div>
          ) : (
            noBaselineHint && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{noBaselineHint}</p>
          )}
        </>
      )}
    </Card>
  );
}

function HeroMetric({ label, value, warn, good, title }: { label: string; value: string; warn?: boolean; good?: boolean; title?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700/70 dark:bg-slate-800/40" title={title}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-0.5 break-words text-base font-bold leading-tight tabular-nums sm:text-xl ${warn ? 'text-red-600 dark:text-red-400' : good ? 'text-green-600 dark:text-green-400' : 'text-slate-800 dark:text-slate-100'}`}>{value}</div>
    </div>
  );
}

function Metric({ label, value, warn, title }: { label: string; value: string; warn?: boolean; title?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2" title={title}>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-sm font-semibold ${warn ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{value}</div>
    </div>
  );
}
