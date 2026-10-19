import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PortfolioSummary as Summary, PortfolioHealth } from '../api/types';
import { Card, EmptyState } from './ui';
import { useLang } from '../context/LanguageContext';
import MobileDashboardSkeleton from './MobileDashboardSkeleton';
import { formatIdrShort, formatDateInput } from '../lib/format';
import { haptic } from '../lib/haptics';
import { useBookmarks } from '../hooks/useBookmarks';
import PlanningReminders from './PlanningReminders';
import AwaitingActivation from './AwaitingActivation';
import AwaitingClosure from './AwaitingClosure';
import PendingApprovals from './PendingApprovals';
import { useTheme } from '../context/ThemeContext';

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
// a progress-ring health hero with side stats, KPI tiles, the "needs attention" queues, and
// project cards with progress bars. Rendered instead of the desktop stack on < sm screens.
// (Reports/Resources shortcuts live in the bottom tab bar now — no on-dashboard quick actions.)
export default function MobileDashboard() {
  const { lang } = useLang();
  const { theme } = useTheme();
  // Phones are dark-only; `light` only matters if this ever renders on a small light-themed canvas.
  const light = theme === 'light';
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
  if (!data || data.totals.count === 0) return <Card><EmptyState title="No projects yet" hint="Projects in your portfolio will show up here with their live health." /></Card>;

  const t = data.totals;
  const pct = Math.round(t.scheduleProgress * 100);
  const status: PortfolioHealth = t.pv <= 0 ? 'NO_DATA' : t.spi >= 0.95 ? 'GREEN' : t.spi >= 0.85 ? 'AMBER' : 'RED';
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

  // Hero side-stats + KPI figures (prototype): active vs off-track projects, and the "slipped"
  // count (active projects whose health is AMBER/RED). The two mini-bars read on-track share and
  // earned share of budget.
  const active = data.projects.filter((p) => isActive(p.status)).length;
  const offTrack = data.projects.filter((p) => isActive(p.status) && (p.health === 'RED' || p.health === 'AMBER')).length;
  const onTrackFrac = active > 0 ? (active - offTrack) / active : 0;
  const earnedFrac = t.bac > 0 ? t.ev / t.bac : 0;
  const spiStr = t.pv > 0 ? t.spi.toFixed(2) : '—';
  const cpiStr = t.ac > 0 ? t.cpi.toFixed(2) : '—';
  const spiBehind = t.pv > 0 && t.spi < 1;
  const cpiBad = t.ac > 0 && t.cpi < 1;
  const id = lang === 'id';

  return (
    <div className="space-y-3">
      {/* Hero — a progress-ring health dial with side stats (per the Mobile v2 prototype). */}
      <div className={`relative overflow-hidden rounded-3xl p-4 shadow-lg ring-1 sm:p-5 ${light ? 'bg-gradient-to-br from-white to-slate-50 text-slate-900 ring-slate-200' : 'bg-gradient-to-br from-slate-900 via-violet-950/40 to-slate-950 text-white ring-white/10'}`}>
        {/* Ambient violet glow top-right for the premium prism feel. */}
        <div aria-hidden className="pointer-events-none absolute -right-14 -top-16 h-48 w-48 rounded-full blur-3xl" style={{ backgroundColor: '#7c3aed', opacity: light ? 0.1 : 0.3 }} />
        <div className="relative flex items-center justify-between gap-2">
          <div className={`text-[11px] font-semibold uppercase tracking-wide ${light ? 'text-slate-500' : 'text-white/70'}`}>Portfolio health</div>
          {/* SPI status pill — amber when behind, emerald when on track. */}
          <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1" style={{ color: RAG[status].c, backgroundColor: `${RAG[status].c}1f`, borderColor: `${RAG[status].c}55` }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: RAG[status].c }} />
            SPI {spiStr} · {id ? (spiBehind ? 'tertunda' : 'sesuai') : RAG[status].label}
          </span>
        </div>
        <div className="relative mt-3 flex items-center gap-4">
          <PortfolioRing pct={pct} light={light} label={id ? 'selesai' : 'complete'} />
          <div className="min-w-0 flex-1 space-y-3">
            <HeroStat light={light} label={id ? 'Proyek aktif' : 'Active projects'} value={`${active}${offTrack > 0 ? ` · ${offTrack} off-track` : ''}`} frac={onTrackFrac} />
            <HeroStat light={light} label="Total BAC" value={formatIdrShort(t.bac)} frac={earnedFrac} />
          </div>
        </div>
      </div>

      {/* KPI tiles — the portfolio's four headline figures (prototype): schedule & cost indices,
          earned value, and the count of slipped projects. Each carries a status dot + muted sub-line. */}
      <div className="grid grid-cols-2 gap-3">
        <KpiTile label={id ? 'Portfolio SPI' : 'Portfolio SPI'} value={spiStr} dot={spiBehind ? '#f59e0b' : '#22c55e'} valueCls={spiBehind ? 'text-amber-400' : 'text-emerald-400'} sub={id ? (spiBehind ? 'jadwal · di bawah 1.0' : 'jadwal · sehat') : (spiBehind ? 'schedule · below 1.0' : 'schedule · healthy')} />
        <KpiTile label={id ? 'Portfolio CPI' : 'Portfolio CPI'} value={cpiStr} dot={cpiBad ? '#fb7185' : '#22c55e'} valueCls={cpiBad ? 'text-rose-400' : 'text-emerald-400'} sub={id ? (cpiBad ? 'biaya · di bawah 1.0' : 'biaya · sehat') : (cpiBad ? 'cost · below 1.0' : 'cost · healthy')} />
        <KpiTile label={id ? 'Earned value' : 'Earned value'} value={formatIdrShort(t.ev)} dot="#22c55e" valueCls="text-slate-800 dark:text-white" sub={`${id ? 'dari' : 'of'} ${formatIdrShort(t.bac)}`} />
        <KpiTile label={id ? 'Slipped' : 'Slipped'} value={String(offTrack)} dot={offTrack > 0 ? '#fb7185' : '#64748b'} valueCls={offTrack > 0 ? 'text-rose-400' : 'text-slate-700 dark:text-slate-200'} sub={id ? 'butuh perhatian' : 'need attention'} />
      </div>

      {/* Needs attention — the action queues (each renders nothing when empty) */}
      <PlanningReminders />
      <AwaitingActivation />
      <AwaitingClosure />
      <PendingApprovals />

      {/* Projects — worst health first, filterable by lifecycle status */}
      <div>
        {/* Heading + filter kept left-aligned (not justify-between) so the chips don't sit under the bottom-right FAB. */}
        <div className="mb-2.5 flex items-center gap-3 px-1">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Projects</h3>
          <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {([['all', 'All'], ['active', 'Active'], ['closed', 'Closed']] as const).map(([key, label]) => (
              <button key={key} onClick={() => { haptic(); setFilter(key); }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${filter === key ? 'bg-brand-500 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>
                {label} <span className="tabular-nums opacity-60">{counts[key]}</span>
              </button>
            ))}
          </div>
        </div>
        {projects.length === 0 && <p className="rounded-2xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400 dark:border-slate-700">No {filter !== 'all' ? filter : ''} projects.</p>}
        <div data-tour="sample-projects" className="space-y-2.5">
          {projects.map((p, i) => {
            const ppct = Math.round(p.scheduleProgress * 100);
            const rag = RAG[p.health];
            return (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className={`prima-rise relative block overflow-hidden rounded-2xl border bg-gradient-to-b from-white to-slate-50/60 p-4 shadow-sm transition active:scale-[.99] dark:from-white/[0.07] dark:to-white/[0.03] dark:backdrop-blur-xl ${pinned.has(p.id) ? 'border-amber-300 ring-2 ring-amber-400/50 dark:border-amber-500/40' : 'border-slate-200 ring-1 ring-black/[0.05] dark:border-white/10 dark:ring-white/[0.04]'}`}
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              >
                {/* Top sheen — unifies with the quick-action + KPI tiles. */}
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/10" />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-800 dark:text-slate-100">{p.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{p.code}{p.pm ? ` · ${p.pm}` : ''}</div>
                  </div>
                  {/* Bookmark toggle — pin a project to the top; preventDefault so it doesn't navigate. */}
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); haptic(); togglePin(p.id); }}
                    aria-label={pinned.has(p.id) ? (lang === 'id' ? 'Hapus bookmark' : 'Remove bookmark') : (lang === 'id' ? 'Bookmark proyek' : 'Bookmark project')}
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

// The hero health dial: a gradient progress ring (violet→indigo→cyan) reading schedule % complete,
// matching the prototype. The big centre figure uses the same gradient as a clipped text fill.
function PortfolioRing({ pct, light, label }: { pct: number; light: boolean; label: string }) {
  const R = 50, C = 2 * Math.PI * R;
  const dash = Math.max(0, Math.min(100, pct)) / 100 * C;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 120 120" className="h-28 w-28 -rotate-90">
        <defs>
          <linearGradient id="pring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#a78bfa" /><stop offset="0.5" stopColor="#818cf8" /><stop offset="1" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="11" className={light ? 'stroke-slate-200' : 'stroke-white/10'} />
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="11" strokeLinecap="round" stroke="url(#pring-grad)" strokeDasharray={`${dash} ${C}`} className="transition-[stroke-dasharray] duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="bg-gradient-to-r from-violet-400 to-sky-400 bg-clip-text text-3xl font-extrabold tabular-nums leading-none text-transparent">{pct}%</span>
        <span className={`mt-1 text-[10px] font-semibold uppercase tracking-wider ${light ? 'text-slate-400' : 'text-white/50'}`}>{label}</span>
      </div>
    </div>
  );
}

// A labelled hero side-stat with a gradient mini progress bar (right column of the hero).
function HeroStat({ light, label, value, frac }: { light: boolean; label: string; value: string; frac: number }) {
  return (
    <div>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${light ? 'text-slate-400' : 'text-white/55'}`}>{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums leading-tight ${light ? 'text-slate-900' : 'text-white'}`}>{value}</div>
      <div className={`mt-1.5 h-1.5 w-full overflow-hidden rounded-full ${light ? 'bg-slate-200' : 'bg-white/10'}`}>
        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-sky-400 transition-[width] duration-700" style={{ width: `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%` }} />
      </div>
    </div>
  );
}

// A KPI tile: a status dot + uppercase label, a big colour-coded value, and a muted sub-line.
function KpiTile({ label, value, sub, dot, valueCls }: { label: string; value: string; sub?: string; dot: string; valueCls: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/60 p-4 shadow-sm ring-1 ring-black/[0.05] dark:border-white/10 dark:from-white/[0.07] dark:to-white/[0.03] dark:ring-white/[0.04] dark:backdrop-blur-xl">
      {/* Top sheen — matches the KPI/project tiles so the dashboard reads as one set. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/10" />
      <div className="relative flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} />{label}
      </div>
      <div className={`relative mt-1 text-xl font-bold tabular-nums ${valueCls}`}>{value}</div>
      {sub && <div className="relative mt-0.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">{sub}</div>}
    </div>
  );
}
