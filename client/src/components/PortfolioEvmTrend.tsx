import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { EvmTrend, PortfolioEvmTrend as Trend } from '../api/types';
import { Button, Card, Input, SectionTitle, Spinner } from './ui';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';
import { formatIdr, formatDate, formatDateInput, formatNum } from '../lib/format';
import EvmTrendChart, { CpiSpiTrend } from './EvmTrendChart';

// Portfolio-wide EVM trend: rolls up every visible project's captured snapshots into
// one cost S-curve + CPI/SPI history. "Capture all" freezes a status snapshot for
// every visible non-DRAFT project at once, so the whole portfolio advances together.
// Reuses the per-project trend charts by adapting the rolled-up series to their shape.
export default function PortfolioEvmTrend() {
  const { user } = useAuth();
  const canWrite = !!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER'].includes(user.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [statusDate, setStatusDate] = useState(formatDateInput(new Date()));

  const { data, isLoading } = useQuery({
    queryKey: ['portfolio-evm-trend'],
    queryFn: () => api.get<Trend>('/portfolio/evm/trend'),
  });

  const captureAll = useMutation({
    mutationFn: () => api.post<{ captured: number; failed: number; total: number }>('/portfolio/evm/capture-all', { statusDate }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['portfolio-evm-trend'] });
      qc.invalidateQueries({ queryKey: ['evm-trend'] }); // per-project tabs too
      toast.success(`Captured ${r.captured} of ${r.total} project${r.total === 1 ? '' : 's'} for ${formatDate(statusDate)}${r.failed ? ` (${r.failed} skipped)` : ''}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Capture failed'),
  });

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;

  const series = data?.series ?? [];
  const latest = series.length ? series[series.length - 1] : null;
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const arrow = (a: number, b: number) => (Math.abs(b - a) < 0.01 ? '·' : b > a ? '▲' : '▼');

  // Adapt the rolled-up series to the per-project trend charts' EvmTrend shape.
  const adapted: EvmTrend = {
    projectId: 'portfolio',
    statusDate,
    bac: data?.bac ?? 0,
    plannedStart: null,
    plannedFinish: null,
    plannedCurve: series.map((s) => ({ t: s.statusDate, pv: s.pv })),
    snapshots: series.map((s) => ({
      id: s.statusDate,
      statusDate: s.statusDate,
      bac: data?.bac ?? 0,
      pv: s.pv, ev: s.ev, ac: s.ac, cpi: s.cpi, spi: s.spi,
      weightedProgress: data && data.bac > 0 ? s.ev / data.bac : 0,
      note: null, createdByName: null, createdAt: s.statusDate,
    })),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle sub="Rolled-up earned-value history across the whole portfolio, built from captured project snapshots.">Portfolio EVM trend</SectionTitle>
        {canWrite && (
          <div className="flex items-end gap-2">
            <label className="text-xs text-slate-500 dark:text-slate-400">
              <span className="mr-2 uppercase tracking-wide">Status date</span>
              <Input type="date" value={statusDate} onChange={(e) => setStatusDate(e.target.value)} className="!w-auto !py-1.5" />
            </label>
            <Button onClick={() => captureAll.mutate()} disabled={captureAll.isPending}>📸 Capture all</Button>
          </div>
        )}
      </div>

      {series.length === 0 ? (
        <Card><p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No portfolio snapshots yet.{canWrite ? ' Press “Capture all” to freeze a status point for every project at once.' : ' Ask a PMO/PM to capture a portfolio status.'}</p></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Kpi label="Latest CPI" value={latest && latest.cpi ? formatNum(latest.cpi, 2) : '—'} sub={prev ? `${arrow(prev.cpi, latest!.cpi)} vs prev` : 'first point'} tone={latest && latest.cpi > 0 && latest.cpi < 1 ? 'red' : latest && latest.cpi >= 1 ? 'green' : undefined} />
            <Kpi label="Latest SPI" value={latest && latest.spi ? formatNum(latest.spi, 2) : '—'} sub={prev ? `${arrow(prev.spi, latest!.spi)} vs prev` : 'first point'} tone={latest && latest.spi > 0 && latest.spi < 1 ? 'red' : latest && latest.spi >= 1 ? 'green' : undefined} />
            <Kpi label="Earned value" value={latest ? formatIdr(latest.ev) : '—'} sub={`of ${formatIdr(data?.bac ?? 0)} BAC`} />
            <Kpi label="Projects tracked" value={String(data?.projectCount ?? 0)} sub={`${series.length} status point${series.length === 1 ? '' : 's'}`} />
          </div>
          <EvmTrendChart data={adapted} />
          <CpiSpiTrend data={adapted} />
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'green' }) {
  const c = tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'green' ? 'text-green-600 dark:text-green-400' : 'text-slate-900 dark:text-white';
  return (
    <Card className="!p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${c}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{sub}</div>}
    </Card>
  );
}
