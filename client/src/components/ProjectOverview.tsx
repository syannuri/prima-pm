import { useId, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Evm, EvmTrend } from '../api/types';
import { Card, Spinner } from './ui';
import { formatIdr, formatIdrShort } from '../lib/format';
import { formatNum } from '../lib/format';
import HealthGauge from './HealthGauge';
import EvmTrendChart from './EvmTrendChart';
import { useLang } from '../context/LanguageContext';

// Graphic-first, mobile-friendly project summary — the default landing on phones.
// Reuses the existing SVG charts (HealthGauge speedometer + EvmTrendChart S-curve) and
// adds a progress ring, an EV/AC/PV cost-bar comparison, and colour-coded metric tiles,
// so a PM sees where the project stands at a glance without swiping through 19 tabs.

const RING = {
  GREEN: ['#34d399', '#10b981'],
  AMBER: ['#fbbf24', '#f59e0b'],
  RED: ['#fb7185', '#ef4444'],
  NO_DATA: ['#cbd5e1', '#94a3b8'],
} as const;

type Health = keyof typeof RING;

function ProgressRing({ pct, health }: { pct: number; health: Health }) {
  const gid = useId().replace(/:/g, '');
  const R = 34;
  const C = 2 * Math.PI * R;
  const clamped = Math.max(0, Math.min(100, pct));
  const [from, to] = RING[health] ?? RING.NO_DATA;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <defs>
          <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx="40" cy="40" r={R} fill="none" strokeWidth="7" className="stroke-slate-100 dark:stroke-slate-800" />
        <circle
          cx="40" cy="40" r={R} fill="none" strokeWidth="7" strokeLinecap="round"
          stroke={`url(#${gid})`}
          className="transition-[stroke-dasharray] duration-700"
          strokeDasharray={`${(clamped / 100) * C} ${C}`}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-lg font-bold tabular-nums text-slate-700 dark:text-slate-100">
        {Math.round(clamped)}%
      </span>
    </div>
  );
}

// One labelled horizontal bar scaled against a shared maximum (so EV/AC/PV are comparable).
function Bar({ label, value, max, color, sub }: { label: string; value: number; max: number; color: string; sub?: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between text-xs">
        <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
        <span className="tabular-nums text-slate-500 dark:text-slate-400">{formatIdrShort(value)}{sub && <span className="ml-1 text-[10px] text-slate-400">{sub}</span>}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full ${color} transition-[width] duration-700`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

// Card that becomes a tappable drill-down when `onClick` is set (Card itself takes no onClick).
function Panel({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  if (!onClick) return <Card>{children}</Card>;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick(); } }}
      className="cursor-pointer"
    >
      <Card className="transition hover:border-brand-300 dark:hover:border-brand-700">{children}</Card>
    </div>
  );
}

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: 'good' | 'warn'; hint?: string }) {
  const c = tone === 'warn' ? 'text-red-600 dark:text-red-400' : tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-100';
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40" title={hint}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${c}`}>{value}</div>
    </div>
  );
}

export default function ProjectOverview({ projectId, onJump }: { projectId: string; onJump?: (tab: string) => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const evmQ = useQuery({
    queryKey: ['evm', `/projects/${projectId}`, '', 'overview'],
    queryFn: () => api.get<Evm>(`/projects/${projectId}/evm`),
  });
  const trendQ = useQuery({
    queryKey: ['evm-trend', projectId, 'overview'],
    queryFn: () => api.get<EvmTrend>(`/projects/${projectId}/evm/trend`),
  });

  if (evmQ.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  const e = evmQ.data;
  if (!e) return <Card><p className="py-6 text-center text-slate-500 dark:text-slate-400">{id ? 'Data EVM belum tersedia.' : 'No EVM data yet.'}</p></Card>;

  const health = (e.health ?? 'NO_DATA') as Health;
  const pct = Math.round((e.scheduleProgress ?? 0) * 100);
  const ragLabel = health === 'NO_DATA' ? (id ? 'Tanpa data' : 'No data') : health.charAt(0) + health.slice(1).toLowerCase();
  const costMax = Math.max(e.bac, e.ac, e.ev, e.pv, 1);
  const overBudget = e.ac > 0 && e.cpi < 1;

  return (
    <div className="space-y-4">
      {/* Health & progress at a glance */}
      <Card className="flex flex-col items-center gap-4 sm:flex-row sm:justify-around">
        <div className="flex items-center gap-4">
          <ProgressRing pct={pct} health={health} />
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{id ? 'Progres' : 'Complete'}</div>
            <div className="text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">{pct}%</div>
            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${health === 'GREEN' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : health === 'AMBER' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : health === 'RED' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>{ragLabel}</span>
          </div>
        </div>
        <HealthGauge spi={e.spi} cpi={e.cpi} pct={pct} status={health} statusLabel={ragLabel} />
      </Card>

      {/* Cost picture — EV vs AC vs PV against the budget */}
      <Panel onClick={onJump ? () => onJump('Cost') : undefined}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{id ? 'Biaya (EVM)' : 'Cost (EVM)'}</h3>
          <span className={`text-xs font-medium ${overBudget ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            CPI {e.ac > 0 ? formatNum(e.cpi, 2) : '—'}
          </span>
        </div>
        <div className="space-y-2.5">
          <Bar label={id ? 'Anggaran (BAC)' : 'Budget (BAC)'} value={e.bac} max={costMax} color="bg-slate-400 dark:bg-slate-500" />
          <Bar label={id ? 'Nilai diperoleh (EV)' : 'Earned (EV)'} value={e.ev} max={costMax} color="bg-emerald-500" />
          <Bar label={id ? 'Biaya aktual (AC)' : 'Actual (AC)'} value={e.ac} max={costMax} color={overBudget ? 'bg-red-500' : 'bg-brand-500'} />
        </div>
      </Panel>

      {/* S-curve trend (PV / EV / AC over time) */}
      <Panel onClick={onJump ? () => onJump('EVM Trend') : undefined}>
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{id ? 'Kurva-S (PV · EV · AC)' : 'S-curve (PV · EV · AC)'}</h3>
        {trendQ.isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : trendQ.data ? (
          <EvmTrendChart data={trendQ.data} />
        ) : (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{id ? 'Belum ada baseline/snapshot.' : 'No baseline or snapshots yet.'}</p>
        )}
      </Panel>

      {/* Key figures */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label="EAC" value={formatIdrShort(e.eac)} tone={e.eac > e.bac ? 'warn' : undefined} hint={`Estimate at Completion — ${formatIdr(e.eac)}`} />
        <Tile label="VAC" value={formatIdrShort(e.vac)} tone={e.vac < 0 ? 'warn' : 'good'} hint={`Variance at Completion = BAC − EAC — ${formatIdr(e.vac)}`} />
        <Tile label="CV" value={formatIdrShort(e.cv)} tone={e.cv < 0 ? 'warn' : 'good'} hint={`Cost Variance = EV − AC — ${formatIdr(e.cv)}`} />
        <Tile label="SV" value={formatIdrShort(e.sv)} tone={e.sv < 0 ? 'warn' : 'good'} hint={`Schedule Variance = EV − PV — ${formatIdr(e.sv)}`} />
        <Tile label="SPI" value={e.pv > 0 ? formatNum(e.spi, 2) : '—'} tone={e.pv > 0 ? (e.spi < 1 ? 'warn' : 'good') : undefined} hint="Schedule Performance Index" />
        <Tile
          label={id ? 'Selisih selesai' : 'Finish var.'}
          value={e.finishVarianceDays == null ? '—' : `${e.finishVarianceDays > 0 ? '+' : ''}${e.finishVarianceDays}d`}
          tone={e.finishVarianceDays == null ? undefined : e.finishVarianceDays > 0 ? 'warn' : 'good'}
          hint={id ? 'Selisih tanggal selesai vs baseline (hari)' : 'Finish date variance vs baseline (days)'}
        />
      </div>
    </div>
  );
}
