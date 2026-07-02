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
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="BAC" value={formatIdr(e.bac)} title="Budget at Completion = Performance Measurement Baseline (direct + indirect + contingency; excludes management reserve)" />
            <Metric label="PV" value={formatIdr(e.pv)} title="Planned Value (BCWS)" />
            <Metric label="EV" value={formatIdr(e.ev)} title="Earned Value (BCWP)" />
            <Metric label="AC" value={formatIdr(e.ac)} title="Actual Cost (ACWP)" />
            <Metric label="CV" value={formatIdr(e.cv)} warn={e.cv < 0} title="Cost Variance = EV − AC" />
            <Metric label="SV" value={formatIdr(e.sv)} warn={e.sv < 0} title="Schedule Variance = EV − PV" />
            <Metric label="CPI" value={e.ac > 0 ? formatNum(e.cpi, 3) : '—'} warn={e.ac > 0 && e.cpi < 1} title="Cost Performance Index = EV / AC" />
            <Metric label="SPI" value={e.pv > 0 ? formatNum(e.spi, 3) : '—'} warn={e.pv > 0 && e.spi < 1} title="Schedule Performance Index = EV / PV" />
            <Metric label="EAC" value={formatIdr(e.eac)} title="Estimate at Completion" />
            <Metric label="ETC" value={formatIdr(e.etc)} title="Estimate to Complete = EAC − AC" />
            <Metric label="VAC" value={formatIdr(e.vac)} warn={e.vac < 0} title="Variance at Completion = BAC − EAC" />
            <Metric label="TCPI" value={e.bac > e.ac ? formatNum(e.tcpi, 3) : '—'} warn={e.bac > e.ac && e.tcpi > 1} title="To-Complete Performance Index = (BAC − EV) / (BAC − AC)" />
          </div>
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

function Metric({ label, value, warn, title }: { label: string; value: string; warn?: boolean; title?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2" title={title}>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-sm font-semibold ${warn ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{value}</div>
    </div>
  );
}
