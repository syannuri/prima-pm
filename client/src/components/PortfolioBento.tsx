import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PortfolioSummary, PortfolioHealth, PortfolioEvmTrend, PortfolioRaid } from '../api/types';
import { formatIdrShort, formatDate } from '../lib/format';
import { useLang } from '../context/LanguageContext';
import { smoothPath, areaPath } from './chart/smoothPath';

// Portfolio "Command Center" — the bold bento landing for the desktop portfolio view. One big
// gradient health hero, a tall Needs-attention panel, money tiles, the portfolio S-curve, and a
// project shortlist. Reads the same live endpoints the old widget stack used (/portfolio/summary,
// /portfolio/attention, /portfolio/evm/trend) so no data story is lost — the detailed donuts + EVM
// table still live in Reports and the Project Cards view.

interface Reason { kind: string; n?: number; detail?: string }
interface AttentionItem { projectId: string; code: string; name: string; health: string; reasons: Reason[] }
interface AttentionResponse { items: AttentionItem[]; aiAvailable: boolean }

const statusOf = (spi: number, pv: number): PortfolioHealth =>
  pv <= 0 ? 'NO_DATA' : spi >= 0.95 ? 'GREEN' : spi >= 0.85 ? 'AMBER' : 'RED';

const spineHex = (h: string) => (h === 'RED' ? '#f43f5e' : h === 'AMBER' ? '#f59e0b' : h === 'GREEN' ? '#10b981' : '#94a3b8');

function reasonShort(r: Reason, id: boolean): string {
  switch (r.kind) {
    case 'schedule': return `SPI ${r.detail}`;
    case 'cost': return `CPI ${r.detail}`;
    case 'slip': return id ? `${r.n} hari telat` : `${r.n}d late`;
    case 'overdue': return id ? `${r.n} tugas telat` : `${r.n} overdue`;
    case 'dueSoon': return id ? `${r.n} jatuh tempo` : `${r.n} due soon`;
    case 'risks': return id ? `${r.n} risiko tinggi` : `${r.n} high risks`;
    case 'crs': return id ? `${r.n} CR terbuka` : `${r.n} open CRs`;
    case 'resource': return id ? 'beban resource berlebih' : 'resource over-allocated';
    default: return r.kind;
  }
}

export default function PortfolioBento() {
  const { lang } = useLang();
  const id = lang === 'id';

  const { data: summary } = useQuery({ queryKey: ['portfolio-summary'], queryFn: () => api.get<PortfolioSummary>('/portfolio/summary') });
  const { data: attn } = useQuery({ queryKey: ['portfolio-attention'], queryFn: () => api.get<AttentionResponse>('/portfolio/attention'), refetchInterval: 5 * 60_000 });
  const { data: trend } = useQuery({ queryKey: ['portfolio-evm-trend'], queryFn: () => api.get<PortfolioEvmTrend>('/portfolio/evm/trend') });
  const { data: raid } = useQuery({ queryKey: ['portfolio-raid'], queryFn: () => api.get<PortfolioRaid>('/portfolio/raid') });

  if (!summary) return null;
  const t = summary.totals;
  if (t.count === 0) {
    return (
      <div className="pbento-card rounded-2xl p-10 text-center text-slate-500 dark:text-slate-400">
        {id ? 'Belum ada proyek di portfolio Anda.' : 'No projects in your portfolio yet.'}
      </div>
    );
  }

  const pct = Math.round(t.scheduleProgress * 100);
  const status = statusOf(t.spi, t.pv);
  const STAT: Record<PortfolioHealth, { label: string; chip: string }> = {
    GREEN: { label: id ? 'Sesuai rencana' : 'On track', chip: 'bg-emerald-400/20 text-emerald-200 ring-emerald-300/40' },
    AMBER: { label: id ? 'Perlu dipantau' : 'At risk', chip: 'bg-amber-400/20 text-amber-100 ring-amber-300/40' },
    RED: { label: id ? 'Di belakang' : 'Behind', chip: 'bg-rose-400/20 text-rose-100 ring-rose-300/40' },
    NO_DATA: { label: id ? 'Tanpa data' : 'No data', chip: 'bg-white/15 text-white ring-white/30' },
  };
  const onTrackPct = t.count > 0 ? Math.round(((summary.byHealth.GREEN ?? 0) / t.count) * 100) : 0;
  const active = summary.projects.filter((p) => p.status === 'IN_PROGRESS').length;

  // Ring geometry (r=68 → circumference ≈ 427.3).
  const CIRC = 427.3;
  const ringOffset = CIRC * (1 - Math.min(100, Math.max(0, pct)) / 100);

  // S-curve from the rolled-up EVM trend (planned=pv, earned=ev, actual=ac). Smoothed + luminous,
  // matching the elevated per-project S-curve (shared smoothPath/areaPath).
  const series = trend?.series ?? [];
  const W = 640, H = 180, PAD = 8;
  const bacV = trend?.bac ?? 0;
  const maxV = Math.max(bacV, ...series.flatMap((s) => [s.pv, s.ev, s.ac]), 1);
  const xi = (i: number) => (series.length > 1 ? (i / (series.length - 1)) * W : 0);
  const yv = (v: number) => H - (v / maxV) * (H - PAD);
  const pts = (key: 'pv' | 'ev' | 'ac') => series.map((s, i) => ({ x: xi(i), y: yv(s[key]) }));

  const items = (attn?.items ?? []).slice(0, 4);
  const projects = [...summary.projects]
    .filter((p) => p.status === 'IN_PROGRESS')
    .sort((a, b) => b.scheduleProgress - a.scheduleProgress)
    .slice(0, 6);
  const projChip = (h: string) => (h === 'RED' ? 'bg-rose-500/20 text-rose-300' : h === 'AMBER' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300');
  const projBar = (h: string) => (h === 'RED' ? 'from-rose-400 to-pink-400' : h === 'AMBER' ? 'from-amber-400 to-orange-400' : 'from-emerald-400 to-teal-400');

  return (
    <div className="pbento grid grid-cols-12 gap-4">

      {/* HERO — gradient command tile. The ring is the live focal gauge (big % centred, animated
          glowing arc); the left column carries context + the inline KPI stats. */}
      <div className="pbento-hero col-span-12 p-7 lg:col-span-8 lg:row-span-2">
        <div className="relative z-10 flex h-full flex-col">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-md">
              <span className="dash-eyebrow text-violet-100/90">{id ? 'Kesehatan portfolio' : 'Portfolio health'}</span>
              <div className="mt-2.5">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${STAT[status].chip}`}>● {STAT[status].label}</span>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-white/80">
                {id
                  ? `Agregat kemajuan atas ${t.count} proyek · status ${formatDate(summary.statusDate)}. SPI ${t.spi.toFixed(2)}, CPI ${t.cpi.toFixed(2)}.`
                  : `Aggregate completion across ${t.count} projects · status ${formatDate(summary.statusDate)}. SPI ${t.spi.toFixed(2)}, CPI ${t.cpi.toFixed(2)}.`}
              </p>
            </div>
            {/* big gauge ring with the % at its centre */}
            <div className="relative hidden h-[180px] w-[180px] shrink-0 sm:block">
              <svg viewBox="0 0 170 170" className="h-full w-full -rotate-90">
                <defs><linearGradient id="pb-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset=".5" stopColor="#c4b5fd" /><stop offset="1" stopColor="#67e8f9" /></linearGradient></defs>
                <circle cx="85" cy="85" r="68" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="14" />
                <circle className="pbento-ring" cx="85" cy="85" r="68" fill="none" stroke="url(#pb-ring)" strokeWidth="14" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={ringOffset} style={{ filter: 'drop-shadow(0 0 12px rgba(167,139,250,.65))' }} />
              </svg>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <div className="dash-display text-[42px] font-extrabold leading-none text-white drop-shadow-[0_4px_16px_rgba(0,0,0,.3)]">{pct}<span className="text-xl text-white/70">%</span></div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-white/70">{id ? 'selesai' : 'complete'}</div>
                </div>
              </div>
            </div>
          </div>
          {/* inline hero stats */}
          <div className="mt-auto grid grid-cols-2 gap-3 pt-6 sm:grid-cols-4">
            {[
              { k: 'SPI', v: t.spi.toFixed(2), tone: t.spi >= 1 ? 'text-emerald-200' : 'text-amber-200' },
              { k: 'CPI', v: t.cpi.toFixed(2), tone: t.cpi >= 1 ? 'text-emerald-200' : 'text-amber-200' },
              { k: id ? 'On track' : 'On track', v: `${onTrackPct}%`, tone: 'text-white' },
              { k: id ? 'Aktif' : 'Active', v: String(active), tone: 'text-white' },
            ].map((s) => (
              <div key={s.k} className="rounded-2xl border border-white/25 bg-white/10 px-4 py-3 backdrop-blur">
                <div className="text-[11px] text-white/70">{s.k}</div>
                <div className={`dash-display text-[22px] font-extrabold ${s.tone}`}>{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* NEEDS ATTENTION — tall panel */}
      <div className="pbento-card pbento-tile col-span-12 overflow-hidden p-6 lg:col-span-4 lg:row-span-2">
        <div className="flex items-center justify-between">
          <span className="dash-eyebrow text-rose-500 dark:text-rose-300">{id ? 'Perlu perhatian' : 'Needs attention'}</span>
          <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/25 dark:text-rose-200 dark:ring-rose-300/40">{items.length} {id ? 'terbuka' : 'open'}</span>
        </div>
        <div className="mt-4 space-y-2.5">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
              {id ? '✓ Semua aman — tidak ada yang perlu perhatian.' : "✓ All caught up — nothing needs attention."}
            </div>
          ) : items.map((it) => (
            <Link key={it.projectId} to={`/projects/${it.projectId}`} style={{ '--spine': spineHex(it.health) } as CSSProperties} className="pbento-spine block rounded-2xl border border-slate-200 bg-white/70 py-3 pl-5 pr-3.5 transition hover:bg-white dark:border-white/10 dark:bg-white/[.03] dark:hover:bg-white/[.06]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-bold text-slate-900 dark:text-white">{it.name}</span>
                <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-slate-400">{it.code}</span>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-slate-500 dark:text-slate-400">{it.reasons.slice(0, 2).map((r) => reasonShort(r, id)).join(' · ')}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* MONEY TILES */}
      {([
        { label: id ? 'Anggaran · BAC' : 'Budget · BAC', value: formatIdrShort(t.bac), bar: 'from-violet-500 to-blue-500', pct: 100 },
        { label: id ? 'Earned · EV' : 'Earned · EV', value: formatIdrShort(t.ev), bar: 'from-emerald-500 to-teal-500', pct: t.bac > 0 ? (t.ev / t.bac) * 100 : 0 },
        { label: id ? 'Aktual · AC' : 'Actual · AC', value: formatIdrShort(t.ac), bar: 'from-cyan-500 to-sky-500', pct: t.bac > 0 ? (t.ac / t.bac) * 100 : 0 },
      ]).map((m) => (
        <div key={m.label} className="pbento-card pbento-tile col-span-12 p-5 sm:col-span-6 lg:col-span-4">
          <div className="dash-eyebrow text-slate-500 dark:text-slate-400">{m.label}</div>
          <div className="dash-display mt-1 text-[32px] font-extrabold text-slate-900 dark:text-white">{m.value}</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10"><div className={`h-full rounded-full bg-gradient-to-r ${m.bar}`} style={{ width: `${Math.min(100, m.pct)}%` }} /></div>
        </div>
      ))}

      {/* S-CURVE */}
      <div className="pbento-card pbento-tile col-span-12 p-6 lg:col-span-8">
        <div className="mb-1 flex items-center justify-between">
          <span className="dash-eyebrow text-slate-500 dark:text-slate-400">{id ? 'S-curve portfolio' : 'Portfolio S-curve'}</span>
          <div className="flex gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-slate-400" />{id ? 'Rencana' : 'Planned'}</span>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-cyan-500 dark:bg-cyan-400" />{id ? 'Earned' : 'Earned'}</span>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-violet-500 dark:bg-violet-400" />{id ? 'Aktual' : 'Actual'}</span>
          </div>
        </div>
        {series.length < 2 ? (
          <div className="grid h-[200px] place-items-center text-sm text-slate-400">{id ? 'Belum cukup snapshot EVM untuk kurva.' : 'Not enough EVM snapshots for a curve yet.'}</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[200px] w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="pb-ev-st" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#22d3ee" /><stop offset="100%" stopColor="#818cf8" /></linearGradient>
              <linearGradient id="pb-ev-ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity="0.28" /><stop offset="60%" stopColor="#818cf8" stopOpacity="0.08" /><stop offset="100%" stopColor="#818cf8" stopOpacity="0" /></linearGradient>
            </defs>
            <g stroke="currentColor" className="text-slate-900/[.06] dark:text-white/[.06]"><line x1="0" y1="45" x2={W} y2="45" /><line x1="0" y1="90" x2={W} y2="90" /><line x1="0" y1="135" x2={W} y2="135" /></g>
            {/* BAC / target line */}
            {bacV > 0 && <line x1="0" x2={W} y1={yv(bacV)} y2={yv(bacV)} className="text-slate-300 dark:text-slate-600" stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />}
            {/* Earned — luminous area + gradient draw-on line, like the per-project chart. */}
            <path d={areaPath(pts('ev'), H)} fill="url(#pb-ev-ar)" className="evm-fade" />
            <path d={smoothPath(pts('pv'))} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 6" vectorEffect="non-scaling-stroke" />
            <path d={smoothPath(pts('ac'))} fill="none" className="text-violet-600 dark:text-violet-400" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <path d={smoothPath(pts('ev'))} fill="none" stroke="url(#pb-ev-st)" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.16" vectorEffect="non-scaling-stroke" />
            <path d={smoothPath(pts('ev'))} fill="none" stroke="url(#pb-ev-st)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} className="evm-draw" vectorEffect="non-scaling-stroke" />
            {/* "You are here" — latest rolled-up earned point. */}
            {(() => { const e = pts('ev')[series.length - 1]; if (!e) return null; return (
              <g>
                <circle cx={e.x} cy={e.y} r="7" fill="#06b6d4" opacity="0.18" />
                <circle cx={e.x} cy={e.y} r="5" fill="none" stroke="#67e8f9" strokeWidth="1.3" className="evm-pulse" />
                <circle cx={e.x} cy={e.y} r="3.4" fill="#06b6d4" stroke="#fff" strokeWidth="1.5" />
              </g>
            ); })()}
          </svg>
        )}
      </div>

      {/* PROJECTS */}
      <div className="pbento-card pbento-tile col-span-12 p-5 lg:col-span-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="dash-eyebrow text-slate-500 dark:text-slate-400">{id ? 'Proyek Anda' : 'Your projects'}</span>
          <span className="text-[11px] text-slate-400">{active} {id ? 'aktif' : 'active'}</span>
        </div>
        <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="block rounded-2xl border border-slate-200 bg-white/70 p-3.5 transition hover:border-brand-300 dark:border-white/10 dark:bg-white/[.03] dark:hover:border-white/20">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-bold text-slate-900 dark:text-white">{p.name}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${projChip(p.health)}`}>{Math.round(p.scheduleProgress * 100)}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10"><div className={`h-full rounded-full bg-gradient-to-r ${projBar(p.health)}`} style={{ width: `${Math.round(p.scheduleProgress * 100)}%` }} /></div>
            </Link>
          ))}
        </div>
      </div>

      {/* RAID roll-up — fills the bottom band with governance signal (risks/issues/dependencies). */}
      {raid && (
        <div className="pbento-card pbento-tile col-span-12 p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="dash-eyebrow text-slate-500 dark:text-slate-400">{id ? 'RAID portfolio' : 'Portfolio RAID'}</span>
            <span className="text-[11px] text-slate-400">{id ? `${raid.projectCount} proyek` : `${raid.projectCount} projects`}</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:col-span-5">
              {([
                { label: id ? 'Risiko tinggi' : 'High risks', value: raid.counts.risksHigh, tone: 'text-rose-600 dark:text-rose-300' },
                { label: id ? 'Isu terbuka' : 'Open issues', value: raid.counts.issues, tone: 'text-amber-600 dark:text-amber-300' },
                { label: id ? 'Dep. berisiko' : 'Deps at risk', value: raid.counts.dependenciesAtRisk, tone: 'text-amber-600 dark:text-amber-300' },
                { label: id ? 'Asumsi' : 'Assumptions', value: raid.counts.assumptions, tone: 'text-slate-700 dark:text-slate-200' },
              ]).map((c) => (
                <div key={c.label} className="rounded-xl border border-slate-200 bg-white/60 px-3 py-2.5 dark:border-white/10 dark:bg-white/[.03]">
                  <div className="dash-eyebrow leading-tight text-slate-500 dark:text-slate-400">{c.label}</div>
                  <div className={`dash-display mt-1 text-[24px] font-extrabold ${c.tone}`}>{c.value}</div>
                </div>
              ))}
            </div>
            <div className="lg:col-span-7">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{id ? 'Risiko teratas' : 'Top risks'}</div>
              {raid.risks.length === 0 ? (
                <p className="text-sm text-slate-400">{id ? 'Tidak ada risiko tinggi terbuka.' : 'No high risks open.'}</p>
              ) : (
                <ul className="space-y-2">
                  {raid.risks.slice(0, 3).map((r, i) => (
                    <li key={i} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 dark:border-white/10 dark:bg-white/[.03]">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${r.severity === 'CRITICAL' || r.severity === 'HIGH' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300' : r.severity === 'MEDIUM' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300' : 'bg-slate-500/15 text-slate-500 dark:text-slate-300'}`}>{r.severity}</span>
                      <span className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-100">{r.title}</span>
                      <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[10px] text-slate-400">{r.code}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
