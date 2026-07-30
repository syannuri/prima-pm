import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Forecast } from '../../api/types';
import { Card, Input, SectionTitle, Spinner } from '../../components/ui';
import { formatIdr, formatDate, formatDateInput, formatNum } from '../../lib/format';
import ForecastChart from '../../components/ForecastChart';
import InfoTip from '../../components/InfoTip';

const money = (n: number) => formatIdr(n);

export default function ForecastPanel({ projectId }: { projectId: string }) {
  const today = formatDateInput(new Date());
  const [statusDate, setStatusDate] = useState(today);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['forecast', projectId, statusDate],
    queryFn: () => api.get<Forecast>(`/projects/${projectId}/forecast?statusDate=${statusDate}`),
  });

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!data) return <Card>No forecast available.</Card>;

  const f = data;
  const costDelta = f.eac.likely - f.bac; // + = projected over budget
  const isOver = costDelta > 0.5; // wording: over vs under budget
  // Three-state verdict so a marginal overrun isn't alarmist red: within 2% of BAC = "watch"
  // (amber), beyond that = "over" (red), on/under budget = "ok" (green).
  const overPct = f.bac > 0 ? costDelta / f.bac : (isOver ? 1 : 0);
  const status: 'over' | 'watch' | 'ok' = overPct > 0.02 ? 'over' : isOver ? 'watch' : 'ok';
  const cardTone = status === 'over' ? 'border-red-200 bg-red-50/50 dark:border-red-900/40 dark:bg-red-900/10'
    : status === 'watch' ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-900/10'
    : 'border-green-200 bg-green-50/50 dark:border-green-900/40 dark:bg-green-900/10';
  const figTone = status === 'over' ? 'text-red-600 dark:text-red-400'
    : status === 'watch' ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400';
  const statusIcon = status === 'ok' ? '✓' : '⚠'; // shape cue independent of colour
  const marginDrop = f.margin.planned - f.margin.projected;
  const days = f.schedule.varianceDays;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle sub="Where this project is heading, from current cost & schedule performance (EVM).">Forecast at Completion</SectionTitle>
        <label className="flex items-center text-xs text-slate-500 dark:text-slate-400">
          {isFetching && !isLoading && <span className="mr-2 animate-pulse text-[11px] text-slate-400 dark:text-slate-500">updating…</span>}
          <span className="mr-2 uppercase tracking-wide">Status date</span>
          {/* Cap at today — a future status date advances PV while AC stays flat, faking an
              "under budget / ahead" forecast. */}
          <Input type="date" max={today} value={statusDate} onChange={(e) => setStatusDate(e.target.value)} className="!w-40 !py-1.5" />
        </label>
      </div>

      {!f.hasData ? (
        <Card><p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No progress or actual cost recorded yet by this date — update task progress and record Actual Cost to project a forecast. Try a later status date.</p></Card>
      ) : (
        <>
          {/* Plain-language verdict */}
          <Card className={`!p-3 ${cardTone}`}>
            <p className="text-sm text-slate-700 dark:text-slate-200">
              <span aria-hidden className={`mr-1 ${figTone}`}>{statusIcon}</span>
              At the current pace this project is forecast to finish at{' '}
              <strong className={figTone}>{money(f.eac.likely)}</strong>{' '}
              — <strong>{isOver ? `over budget by ${money(Math.abs(costDelta))}` : `under budget by ${money(Math.abs(costDelta))}`}</strong>
              {days != null && (
                <> and <strong>{days > 0 ? `${days} day${days === 1 ? '' : 's'} late` : days < 0 ? `${-days} day${days === -1 ? '' : 's'} early` : 'on schedule'}</strong></>
              )}. Projected margin: <strong className={f.margin.projected < 0 ? 'text-red-600 dark:text-red-400' : ''}>{money(f.margin.projected)}</strong>
              {marginDrop > 0.5 && <> (down {money(marginDrop)} from plan)</>}.
            </p>
          </Card>

          {/* EAC scenarios */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Scenario label="Best case" hint="Most favourable of the EVM scenarios" value={f.eac.optimistic} bac={f.bac} />
            <Scenario label="Likely (BAC ÷ CPI)" hint="If the current cost trend continues" value={f.eac.likely} bac={f.bac} emphasise />
            <Scenario label="Worst case" hint="If cost & schedule drag both continue" value={f.eac.pessimistic} bac={f.bac} />
          </div>

          {/* Metrics + schedule + margin */}
          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="!p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Completion metrics</div>
              <Row label="ETC — cost to complete" value={money(f.etc)} />
              <Row label="VAC — variance at completion" value={money(f.vac)} tone={f.vac < 0 ? 'red' : 'green'} />
              <Row label="TCPI — efficiency needed" value={f.tcpi ? formatNum(f.tcpi, 2) : '—'} tone={f.tcpi > 1.05 ? 'red' : undefined} hint="Cost efficiency required on remaining work to still hit BAC. >1 = must improve." />
              <Row label="CPI · SPI" value={`${formatNum(f.cpi, 2)} · ${formatNum(f.spi, 2)}`} />
            </Card>

            <Card className="!p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Schedule forecast</div>
              <Row label="Planned finish" value={formatDate(f.schedule.plannedFinish)} />
              <Row label="Forecast finish" value={formatDate(f.schedule.forecastFinish)} tone={days != null && days > 0 ? 'red' : days != null && days < 0 ? 'green' : undefined} />
              <Row label="Schedule variance" value={days == null ? '—' : days === 0 ? 'On schedule' : days > 0 ? `${days}d late` : `${-days}d early`} tone={days != null && days > 0 ? 'red' : days != null && days < 0 ? 'green' : undefined} />
              <Row label="SPI" value={formatNum(f.spi, 2)} />
            </Card>

            <Card className="!p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Margin forecast</div>
              <Row label="Revenue" value={money(f.margin.revenue)} />
              <Row label="Planned margin (Rev − BAC)" value={money(f.margin.planned)} />
              <Row label="Projected margin (Rev − EAC)" value={money(f.margin.projected)} tone={f.margin.projected < f.margin.planned ? 'red' : 'green'} strong />
            </Card>
          </div>

          <ForecastChart data={f} />
        </>
      )}
    </div>
  );
}

function Scenario({ label, hint, value, bac, emphasise }: { label: string; hint: string; value: number; bac: number; emphasise?: boolean }) {
  const delta = value - bac;
  const over = delta > 0.5;
  return (
    <Card className={`!p-3 ${emphasise ? 'ring-1 ring-brand-300 dark:ring-brand-700' : ''}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${over ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>{money(value)}</div>
      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        {Math.abs(delta) < 0.5 ? 'on budget' : over ? `▲ ${money(delta)} over BAC` : `▼ ${money(-delta)} under BAC`}
      </div>
      <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{hint}</div>
    </Card>
  );
}

function Row({ label, value, tone, strong, hint }: { label: string; value: string; tone?: 'red' | 'green'; strong?: boolean; hint?: string }) {
  const c = tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'green' ? 'text-green-600 dark:text-green-400' : 'text-slate-800 dark:text-slate-100';
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0 dark:border-slate-800">
      <span className="flex items-center text-xs text-slate-500 dark:text-slate-400">{label}{hint && <InfoTip text={hint} />}</span>
      <span className={`text-sm tabular-nums ${strong ? 'font-bold' : 'font-medium'} ${c}`}>
        {/* Shape cue so status doesn't rely on colour alone (▲ worse · ▼ better). */}
        {tone && <span aria-hidden className="mr-1 text-[9px]">{tone === 'red' ? '▲' : '▼'}</span>}
        {value}
      </span>
    </div>
  );
}
