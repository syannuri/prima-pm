import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PortfolioSummary as Summary, PortfolioHealth } from '../api/types';
import { Card } from './ui';
import { useAuth } from '../context/AuthContext';
import MobileDashboardSkeleton from './MobileDashboardSkeleton';
import { formatIdrShort, formatNum, formatDateInput } from '../lib/format';
import { haptic } from '../lib/haptics';
import PlanningReminders from './PlanningReminders';
import AwaitingActivation from './AwaitingActivation';
import AwaitingClosure from './AwaitingClosure';
import PendingApprovals from './PendingApprovals';

const RAG: Record<PortfolioHealth, { c: string; dot: string; label: string }> = {
  GREEN: { c: '#16a34a', dot: '#22c55e', label: 'On track' },
  AMBER: { c: '#d97706', dot: '#f59e0b', label: 'At risk' },
  RED: { c: '#dc2626', dot: '#ef4444', label: 'Behind' },
  NO_DATA: { c: '#64748b', dot: '#94a3b8', label: 'No data' },
};
const RANK: Record<string, number> = { RED: 0, AMBER: 1, GREEN: 2, NO_DATA: 3 };
// Hero gradient follows portfolio health (literal classes so Tailwind's JIT keeps them).
const HERO: Record<PortfolioHealth, { grad: string; shadow: string }> = {
  GREEN: { grad: 'from-emerald-500 to-green-600', shadow: 'shadow-emerald-500/30' },
  AMBER: { grad: 'from-amber-500 to-orange-600', shadow: 'shadow-amber-500/30' },
  RED: { grad: 'from-rose-500 to-red-600', shadow: 'shadow-red-500/30' },
  NO_DATA: { grad: 'from-slate-500 to-slate-700', shadow: 'shadow-slate-500/30' },
};

// A phone-tailored portfolio dashboard (PM & PMO): a glanceable, card-first view —
// gradient health hero, KPI tiles, the "needs attention" queues, and project cards
// with progress bars. Rendered instead of the desktop stack on < sm screens.
const ICON = {
  reports: 'M18 20V10M12 20V4M6 20v-6',
  resources: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM21 21v-2a4 4 0 0 0-3-3.87',
  plus: 'M12 5v14M5 12h14',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7v5l3 2',
};

export default function MobileDashboard() {
  const { user } = useAuth();
  const isPmo = !!user && ['ADMIN', 'PMO'].includes(user.role);
  const [statusDate] = useState(formatDateInput(new Date()));
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio', statusDate],
    queryFn: () => api.get<Summary>(`/portfolio/summary?statusDate=${statusDate}`),
  });

  if (isLoading) return <MobileDashboardSkeleton />;
  if (!data || data.totals.count === 0) return <Card><p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No projects in the portfolio yet.</p></Card>;

  const t = data.totals;
  const pct = Math.round(t.scheduleProgress * 100);
  const status: PortfolioHealth = t.pv <= 0 ? 'NO_DATA' : t.spi >= 0.95 ? 'GREEN' : t.spi >= 0.85 ? 'AMBER' : 'RED';
  const cv = t.ev - t.ac;
  const projects = [...data.projects].sort((a, b) => (RANK[a.health] - RANK[b.health]) || a.spi - b.spi);

  // Quick actions — route shortcuts most useful for PM/PMO on the go.
  // ("New project" lives on the floating action button, not here.)
  const actions: { label: string; icon: string; grad: string; glow: string; halo: string; to?: string; onClick?: () => void }[] = [
    { label: 'Reports', icon: ICON.reports, grad: 'from-sky-400 to-blue-600', glow: 'shadow-blue-500/40', halo: 'bg-sky-400', to: '/reports' },
    isPmo
      ? { label: 'Resources', icon: ICON.resources, grad: 'from-violet-400 to-indigo-600', glow: 'shadow-indigo-500/40', halo: 'bg-violet-400', to: '/admin/resources' }
      : { label: 'Timesheet', icon: ICON.clock, grad: 'from-amber-400 to-orange-500', glow: 'shadow-orange-500/40', halo: 'bg-amber-400', to: '/my-timesheet' },
  ];
  const actionCols = actions.length >= 3 ? 'grid-cols-3' : 'grid-cols-2';

  return (
    <div className="space-y-4">
      {/* Hero — portfolio health at a glance */}
      <div className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${HERO[status].grad} p-5 text-white shadow-lg ${HERO[status].shadow}`}>
        <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-4">
          <Ring pct={pct} />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/80">Portfolio health</div>
            <div className="mt-0.5 text-xl font-bold leading-tight">{RAG[status].label}</div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-white/90">
              <span><span className="text-white/70">SPI</span> <span className="font-semibold">{t.pv > 0 ? formatNum(t.spi, 2) : '—'}</span></span>
              <span><span className="text-white/70">CPI</span> <span className="font-semibold">{t.ac > 0 ? formatNum(t.cpi, 2) : '—'}</span></span>
              <span className="font-semibold">{t.count} <span className="font-normal text-white/70">projects</span></span>
            </div>
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap gap-2">
          {(['GREEN', 'AMBER', 'RED', 'NO_DATA'] as PortfolioHealth[]).map((h) => (data.byHealth[h] ?? 0) > 0 && (
            <span key={h} className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: RAG[h].dot }} />{RAG[h].label} {data.byHealth[h]}
            </span>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className={`grid gap-2.5 ${actionCols}`}>
        {actions.map((a) => <QuickAction key={a.label} {...a} />)}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3">
        <KpiTile label="Total budget" value={formatIdrShort(t.bac)} />
        <KpiTile label="Earned value" value={formatIdrShort(t.ev)} />
        <KpiTile label="Actual cost" value={formatIdrShort(t.ac)} />
        <KpiTile label="Cost variance" value={formatIdrShort(cv)} tone={cv < 0 ? 'red' : 'green'} />
      </div>

      {/* Needs attention — the action queues (each renders nothing when empty) */}
      <PlanningReminders />
      <AwaitingActivation />
      <AwaitingClosure />
      <PendingApprovals />

      {/* Projects — worst health first */}
      <div>
        <h3 className="mb-2 px-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Projects</h3>
        <div className="space-y-2.5">
          {projects.map((p, i) => {
            const ppct = Math.round(p.scheduleProgress * 100);
            const rag = RAG[p.health];
            return (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="prima-rise relative block overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50/60 p-4 shadow-sm ring-1 ring-black/[0.02] transition active:scale-[.99] dark:border-slate-700/60 dark:from-slate-800/80 dark:to-slate-900/90 dark:ring-white/[0.03]"
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              >
                {/* Top sheen — unifies with the quick-action + KPI tiles. */}
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/10" />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-800 dark:text-slate-100">{p.name}</div>
                    <div className="text-[11px] text-slate-400">{p.code}{p.pm ? ` · ${p.pm}` : ''}</div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${rag.c}1a`, color: rag.c }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: rag.c }} />{rag.label}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-brand-500" style={{ width: `${ppct}%` }} /></div>
                  <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-slate-500 dark:text-slate-400">{ppct}%</span>
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  <span>SPI <span className={p.pv > 0 && p.spi < 1 ? 'font-medium text-red-600 dark:text-red-400' : 'font-medium text-slate-700 dark:text-slate-200'}>{p.pv > 0 ? p.spi.toFixed(2) : '—'}</span></span>
                  <span>CPI <span className={p.ac > 0 && p.cpi < 1 ? 'font-medium text-red-600 dark:text-red-400' : 'font-medium text-slate-700 dark:text-slate-200'}>{p.ac > 0 ? p.cpi.toFixed(2) : '—'}</span></span>
                  <span className="ml-auto text-slate-400">{formatIdrShort(p.bac)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// White %-complete donut on the coloured hero (track = translucent white, arc = white).
function Ring({ pct }: { pct: number }) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * circ;
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="7" />
        <circle cx="36" cy="36" r={r} fill="none" stroke="white" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-lg font-bold">{pct}%</span>
        <span className="mt-0.5 text-[9px] uppercase tracking-wide text-white/70">done</span>
      </div>
    </div>
  );
}

function QuickAction({ label, icon, grad, glow, halo, to, onClick }: { label: string; icon: string; grad: string; glow: string; halo: string; to?: string; onClick?: () => void }) {
  const cls =
    'group relative flex flex-col items-center overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50/60 p-3.5 shadow-sm ring-1 ring-black/[0.02] transition-all duration-200 active:scale-95 active:shadow-inner dark:border-slate-700/60 dark:from-slate-800/80 dark:to-slate-900/90 dark:ring-white/[0.03]';
  const inner = (
    <>
      {/* Soft coloured halo behind the icon — clipped by the card for an elegant glow. */}
      <span aria-hidden className={`pointer-events-none absolute left-1/2 top-0 h-20 w-20 -translate-x-1/2 -translate-y-6 rounded-full opacity-45 blur-2xl transition-opacity duration-200 group-hover:opacity-70 ${halo}`} />
      {/* Top sheen on the card for a glossy, premium finish. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/10" />
      {/* 3D gradient "app icon": vibrant diagonal gradient, a top gloss highlight for the
          light-from-above read, a colour-matched elevation shadow, and a white glyph that
          floats above it via a soft drop-shadow. */}
      <span className={`relative grid h-12 w-12 place-items-center rounded-[1rem] bg-gradient-to-br text-white shadow-lg ring-1 ring-white/25 transition-transform duration-200 group-active:scale-90 ${grad} ${glow}`}>
        <span aria-hidden className="pointer-events-none absolute inset-x-1 top-1 h-1/2 rounded-[0.75rem] bg-gradient-to-b from-white/45 to-transparent" />
        <svg viewBox="0 0 24 24" className="relative h-6 w-6 drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)]" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
      </span>
      <span className="relative mt-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">{label}</span>
    </>
  );
  return to
    ? <Link to={to} onClick={() => haptic()} className={cls}>{inner}</Link>
    : <button type="button" onClick={() => { haptic(); onClick?.(); }} className={cls}>{inner}</button>;
}

function KpiTile({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'green' }) {
  const valClass = tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'green' ? 'text-green-600 dark:text-green-400' : 'text-slate-800 dark:text-white';
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50/60 p-4 shadow-sm ring-1 ring-black/[0.02] dark:border-slate-700/60 dark:from-slate-800/80 dark:to-slate-900/90 dark:ring-white/[0.03]">
      {/* Top sheen — matches the quick-action tiles so the dashboard reads as one set. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/10" />
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${valClass}`}>{value}</div>
    </div>
  );
}
