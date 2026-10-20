import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PortfolioSummary as Summary, PortfolioRow, PortfolioHealth } from '../api/types';
import { Card, EmptyState } from './ui';
import { useLang } from '../context/LanguageContext';
import { formatIdrShort, formatDateInput } from '../lib/format';
import { haptic } from '../lib/haptics';
import MobileDashboardSkeleton from './MobileDashboardSkeleton';

// Health → a spine/bar colour + a status word (prototype's ON TRACK / AT RISK / OFF TRACK).
const HEALTH: Record<PortfolioHealth, { c: string; en: string; id: string }> = {
  GREEN: { c: '#22c55e', en: 'On track', id: 'Sesuai' },
  AMBER: { c: '#f59e0b', en: 'At risk', id: 'Berisiko' },
  RED: { c: '#ef4444', en: 'Off track', id: 'Terlambat' },
  NO_DATA: { c: '#64748b', en: 'No data', id: 'Tanpa data' },
};
const RANK: Record<string, number> = { RED: 0, AMBER: 1, GREEN: 2, NO_DATA: 3 };

type Filter = 'all' | 'active' | 'atrisk' | 'closed';

// The phone "Projects" tab — a searchable, filterable portfolio list (per the Mobile v2 prototype):
// a glass search field, scrollable filter chips, and glass project cards with a health spine, a big
// schedule %, a status word, and SPI/CPI/budget chips. Rendered instead of the desktop card grid.
export default function MobileProjects() {
  const { lang } = useLang();
  const id = lang === 'id';
  const [statusDate] = useState(formatDateInput(new Date()));
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio', statusDate],
    queryFn: () => api.get<Summary>(`/portfolio/summary?statusDate=${statusDate}`),
  });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  if (isLoading) return <MobileDashboardSkeleton />;
  if (!data || data.projects.length === 0) return <Card><EmptyState title={id ? 'Belum ada proyek' : 'No projects yet'} hint={id ? 'Proyek di portofoliomu akan muncul di sini.' : 'Projects in your portfolio will show up here.'} /></Card>;

  const isActive = (p: PortfolioRow) => p.status === 'IN_PROGRESS';
  const isAtRisk = (p: PortfolioRow) => isActive(p) && (p.health === 'RED' || p.health === 'AMBER');
  const counts = {
    all: data.projects.length,
    active: data.projects.filter((p) => p.status !== 'CLOSED').length,
    atrisk: data.projects.filter(isAtRisk).length,
    closed: data.projects.filter((p) => p.status === 'CLOSED').length,
  };
  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: id ? 'Semua' : 'All' },
    { key: 'active', label: id ? 'Aktif' : 'Active' },
    { key: 'atrisk', label: id ? 'At risk' : 'At risk' },
    { key: 'closed', label: id ? 'Closed' : 'Closed' },
  ];
  const needle = q.trim().toLowerCase();
  const list = data.projects
    .filter((p) => filter === 'all'
      || (filter === 'active' && p.status !== 'CLOSED')
      || (filter === 'atrisk' && isAtRisk(p))
      || (filter === 'closed' && p.status === 'CLOSED'))
    .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle) || (p.pm || '').toLowerCase().includes(needle))
    .sort((a, b) => (Number(isActive(b)) - Number(isActive(a))) || (RANK[a.health] - RANK[b.health]) || (a.spi - b.spi));

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={id ? 'Cari proyek, kode, PM…' : 'Search projects, code, PM…'}
          aria-label={id ? 'Cari proyek' : 'Search projects'}
          className="lg-card w-full rounded-2xl py-3 pl-10 pr-11 text-sm text-slate-800 outline-none ring-brand-500/40 transition placeholder:text-slate-400 focus:ring-2 dark:text-white dark:placeholder:text-slate-500"
        />
        {q && (
          <button
            type="button"
            onClick={() => { haptic(); setQ(''); }}
            aria-label={id ? 'Hapus pencarian' : 'Clear search'}
            className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition hover:bg-black/5 hover:text-slate-600 active:scale-90 dark:hover:bg-white/10 dark:hover:text-slate-200"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      {/* Filter chips — horizontally scrollable, active chip gets the prism gradient. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chips.map((c) => {
          const on = filter === c.key;
          return (
            <button
              key={c.key}
              onClick={() => { haptic(); setFilter(c.key); }}
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${on
                ? 'bg-gradient-to-r from-violet-500 to-sky-500 text-white shadow-md shadow-violet-600/30'
                : 'lg-chrome text-slate-600 dark:text-slate-300'}`}
            >
              {c.label} <span className="tabular-nums opacity-70">· {counts[c.key]}</span>
            </button>
          );
        })}
      </div>

      {/* Cards */}
      {list.length === 0
        ? <p className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400 dark:border-slate-700">{id ? 'Tidak ada proyek.' : 'No projects.'}</p>
        : (
          <div data-tour="sample-projects" className="space-y-2.5">
            {list.map((p, i) => {
              const pct = Math.round(Math.min(1, Math.max(0, p.scheduleProgress)) * 100);
              const h = HEALTH[p.health];
              const word = isActive(p) ? (id ? h.id : h.en).toUpperCase() : p.status;
              return (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className="lg-card prima-rise relative block overflow-hidden rounded-2xl p-4 pl-5 transition active:scale-[.99]"
                  style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                >
                  {/* health colour spine */}
                  <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: isActive(p) ? h.c : '#64748b' }} />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[11px] text-slate-400 dark:text-slate-500">{p.code}</div>
                      <h3 className="mt-0.5 truncate font-semibold text-slate-800 dark:text-slate-100" title={p.name}>{p.name}</h3>
                      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, backgroundColor: isActive(p) ? h.c : '#94a3b8' }} />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-2xl font-extrabold tabular-nums leading-none text-slate-800 dark:text-white">{pct}%</div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: isActive(p) ? h.c : '#94a3b8' }}>{word}</div>
                    </div>
                  </div>
                  {/* SPI / CPI / budget chips */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Chip label="SPI" value={p.pv > 0 ? p.spi.toFixed(2) : '—'} bad={p.pv > 0 && p.spi < 1} />
                    <Chip label="CPI" value={p.ac > 0 ? p.cpi.toFixed(2) : '—'} bad={p.ac > 0 && p.cpi < 1} />
                    <Chip label="" value={formatIdrShort(p.bac)} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
    </div>
  );
}

function Chip({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium tabular-nums ${bad
      ? 'border-rose-400/30 bg-rose-500/10 text-rose-500 dark:text-rose-300'
      : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300'}`}>
      {label && <span className="opacity-60">{label}</span>}{value}
    </span>
  );
}
