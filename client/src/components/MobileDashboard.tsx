import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PortfolioSummary as Summary, PortfolioHealth } from '../api/types';
import { Card } from './ui';
import { useAuth } from '../context/AuthContext';
import MobileDashboardSkeleton from './MobileDashboardSkeleton';
import { formatIdrShort, formatDateInput } from '../lib/format';
import { haptic } from '../lib/haptics';
import { useBookmarks } from '../hooks/useBookmarks';
import PlanningReminders from './PlanningReminders';
import AwaitingActivation from './AwaitingActivation';
import AwaitingClosure from './AwaitingClosure';
import PendingApprovals from './PendingApprovals';
import HealthGauge from './HealthGauge';

const RAG: Record<PortfolioHealth, { c: string; dot: string; label: string }> = {
  GREEN: { c: '#16a34a', dot: '#22c55e', label: 'On track' },
  AMBER: { c: '#d97706', dot: '#f59e0b', label: 'At risk' },
  RED: { c: '#dc2626', dot: '#ef4444', label: 'Behind' },
  NO_DATA: { c: '#64748b', dot: '#94a3b8', label: 'No data' },
};
const RANK: Record<string, number> = { RED: 0, AMBER: 1, GREEN: 2, NO_DATA: 3 };

// Lifecycle status → a friendly label + badge colours. "Active" (IN_PROGRESS) is where
// EVM health applies; CLOSED is a calm neutral (it's done, not "on track").
const STATUS_META: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Draft', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  CHARTERED: { label: 'Chartered', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  IN_PROGRESS: { label: 'Active', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  ON_HOLD: { label: 'On hold', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  CLOSED: { label: 'Closed', cls: 'bg-slate-200 text-slate-500 dark:bg-slate-700/70 dark:text-slate-400' },
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
  // Bookmarked projects (synced per-user via the server) float to the very top with an
  // amber highlight.
  const { pinned, toggle: togglePin } = useBookmarks();
  const [filter, setFilter] = useState<'all' | 'active' | 'closed'>('all');

  if (isLoading) return <MobileDashboardSkeleton />;
  if (!data || data.totals.count === 0) return <Card><p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No projects in the portfolio yet.</p></Card>;

  const t = data.totals;
  const pct = Math.round(t.scheduleProgress * 100);
  const status: PortfolioHealth = t.pv <= 0 ? 'NO_DATA' : t.spi >= 0.95 ? 'GREEN' : t.spi >= 0.85 ? 'AMBER' : 'RED';
  const cv = t.ev - t.ac;
  const isActive = (s: string) => s === 'IN_PROGRESS';
  const sorted = [...data.projects].sort((a, b) =>
    (Number(pinned.has(b.id)) - Number(pinned.has(a.id)))         // bookmarked first
    || (Number(isActive(b.status)) - Number(isActive(a.status)))  // then active (in-progress)
    || (RANK[a.health] - RANK[b.health])                          // then worst health
    || (a.spi - b.spi),
  );
  // Filter chips: All / Active (not closed) / Closed.
  const counts = {
    all: data.projects.length,
    active: data.projects.filter((p) => p.status !== 'CLOSED').length,
    closed: data.projects.filter((p) => p.status === 'CLOSED').length,
  };
  const projects = sorted.filter((p) => filter === 'all' || (filter === 'active' ? p.status !== 'CLOSED' : p.status === 'CLOSED'));

  // Quick actions — route shortcuts most useful for PM/PMO on the go.
  // ("New project" lives on the floating action button, not here.)
  const actions: { label: string; icon: string; grad: string; glow: string; halo: string; tint: string; to?: string; onClick?: () => void }[] = [
    { label: 'Reports', icon: ICON.reports, grad: 'from-sky-400 to-blue-600', glow: 'shadow-blue-500/40', halo: 'bg-sky-400', tint: 'from-sky-500/25 to-blue-600/10', to: '/reports' },
    isPmo
      ? { label: 'Resources', icon: ICON.resources, grad: 'from-violet-400 to-indigo-600', glow: 'shadow-indigo-500/40', halo: 'bg-violet-400', tint: 'from-violet-500/25 to-indigo-600/10', to: '/admin/resources' }
      : { label: 'Timesheet', icon: ICON.clock, grad: 'from-amber-400 to-orange-500', glow: 'shadow-orange-500/40', halo: 'bg-amber-400', tint: 'from-amber-500/25 to-orange-600/10', to: '/my-timesheet' },
  ];
  const actionCols = actions.length >= 3 ? 'grid-cols-3' : 'grid-cols-2';

  return (
    <div className="space-y-4">
      {/* Hero — a 3D speedometer of portfolio schedule health on a premium dark dial. */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 to-slate-950 p-5 text-white shadow-lg ring-1 ring-white/10">
        {/* Health-tinted glow so the card still signals RAG at a glance. */}
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-14 h-48 w-48 rounded-full blur-2xl" style={{ backgroundColor: RAG[status].dot, opacity: 0.22 }} />
        <div className="relative flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Portfolio health</div>
          <span className="text-[11px] font-medium text-white/60">{t.count} projects</span>
        </div>
        <div className="relative mt-1">
          <HealthGauge spi={t.spi} cpi={t.cpi} pct={pct} status={status} statusLabel={RAG[status].label} />
        </div>
        <div className="relative mt-3 flex flex-wrap justify-center gap-2">
          {(['GREEN', 'AMBER', 'RED', 'NO_DATA'] as PortfolioHealth[]).map((h) => (data.byHealth[h] ?? 0) > 0 && (
            <span key={h} className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs backdrop-blur-sm ring-1 ring-white/10">
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
        <KpiTile label="Total budget" value={formatIdrShort(t.bac)} tint="from-indigo-500/20 to-blue-600/10" />
        <KpiTile label="Earned value" value={formatIdrShort(t.ev)} tint="from-emerald-500/20 to-teal-600/10" />
        <KpiTile label="Actual cost" value={formatIdrShort(t.ac)} tint="from-amber-500/20 to-orange-600/10" />
        <KpiTile label="Cost variance" value={formatIdrShort(cv)} tone={cv < 0 ? 'red' : 'green'} tint="from-rose-500/20 to-pink-600/10" />
      </div>

      {/* Needs attention — the action queues (each renders nothing when empty) */}
      <PlanningReminders />
      <AwaitingActivation />
      <AwaitingClosure />
      <PendingApprovals />

      {/* Projects — worst health first, filterable by lifecycle status */}
      <div>
        <div className="mb-2.5 flex items-center justify-between px-1">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Projects</h3>
          <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {([['all', 'All'], ['active', 'Active'], ['closed', 'Closed']] as const).map(([key, label]) => (
              <button key={key} onClick={() => { haptic(); setFilter(key); }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${filter === key ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                {label} <span className="tabular-nums opacity-60">{counts[key]}</span>
              </button>
            ))}
          </div>
        </div>
        {projects.length === 0 && <p className="rounded-2xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400 dark:border-slate-700">No {filter !== 'all' ? filter : ''} projects.</p>}
        <div className="space-y-2.5">
          {projects.map((p, i) => {
            const ppct = Math.round(p.scheduleProgress * 100);
            const rag = RAG[p.health];
            return (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className={`prima-rise relative block overflow-hidden rounded-2xl border bg-gradient-to-b from-white to-slate-50/60 p-4 shadow-sm transition active:scale-[.99] dark:from-slate-800/80 dark:to-slate-900/90 ${pinned.has(p.id) ? 'border-amber-300 ring-2 ring-amber-400/50 dark:border-amber-500/40' : 'border-slate-200/70 ring-1 ring-black/[0.02] dark:border-slate-700/60 dark:ring-white/[0.03]'}`}
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              >
                {/* Top sheen — unifies with the quick-action + KPI tiles. */}
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/10" />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-800 dark:text-slate-100">{p.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-400">{p.code}{p.pm ? ` · ${p.pm}` : ''}</div>
                  </div>
                  {/* Bookmark toggle — pin a project to the top; preventDefault so it doesn't navigate. */}
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); haptic(); togglePin(p.id); }}
                    aria-label={pinned.has(p.id) ? 'Hapus bookmark' : 'Bookmark proyek'}
                    className={`-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg transition ${pinned.has(p.id) ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500 dark:text-slate-600 dark:hover:text-amber-400'}`}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill={pinned.has(p.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                    </svg>
                  </button>
                </div>
                {/* Lifecycle status (always) + EVM health (only while active — a closed project isn't "on track"). */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${(STATUS_META[p.status] ?? STATUS_META.DRAFT).cls}`}>
                    {(STATUS_META[p.status] ?? STATUS_META.DRAFT).label}
                  </span>
                  {isActive(p.status) && (
                    <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${rag.c}1a`, color: rag.c }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: rag.c }} />{rag.label}
                    </span>
                  )}
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full" style={{ width: `${ppct}%`, backgroundColor: isActive(p.status) ? rag.dot : '#94a3b8' }} /></div>
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

function QuickAction({ label, icon, grad, glow, halo, tint, to, onClick }: { label: string; icon: string; grad: string; glow: string; halo: string; tint: string; to?: string; onClick?: () => void }) {
  const cls =
    'group relative flex flex-col items-center overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50/60 p-3.5 shadow-sm ring-1 ring-black/[0.02] transition-all duration-200 active:scale-95 active:shadow-inner dark:border-slate-700/60 dark:from-slate-800/80 dark:to-slate-900/90 dark:ring-white/[0.03]';
  const inner = (
    <>
      {/* Elegant coloured wash over the whole tile (Spektrum palette, one hue per action). */}
      <span aria-hidden className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tint}`} />
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

function KpiTile({ label, value, tone, tint }: { label: string; value: string; tone?: 'red' | 'green'; tint: string }) {
  const valClass = tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'green' ? 'text-green-600 dark:text-green-400' : 'text-slate-800 dark:text-white';
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50/60 p-4 shadow-sm ring-1 ring-black/[0.02] dark:border-slate-700/60 dark:from-slate-800/80 dark:to-slate-900/90 dark:ring-white/[0.03]">
      {/* Elegant coloured wash (Spektrum palette, one hue per KPI). */}
      <span aria-hidden className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tint}`} />
      {/* Top sheen — matches the quick-action tiles so the dashboard reads as one set. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/10" />
      <div className="relative text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`relative mt-1 text-xl font-bold tabular-nums ${valClass}`}>{value}</div>
    </div>
  );
}
