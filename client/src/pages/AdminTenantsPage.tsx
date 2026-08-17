import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { PlatformTenant, PlatformActivity, PlatformTenantDetail, PlatformGeoRow } from '../api/types';
import { Badge, Button, Card, Field, Input, Modal, SectionTitle, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { formatDate, formatIdrShort, formatBytes, timeAgo } from '../lib/format';
import { tenantStats, type Plan } from '../lib/tenantStats';
import { PLAN_LIMITS, atCapacity } from '../lib/planLimits';
import { describeActivity } from '../lib/activityDescribe';
import { triage, type TriageItem } from '../lib/triage';
import { growthSeries, type GrowthPoint } from '../lib/growthSeries';
import { smoothPath, areaPath, type Pt } from '../components/chart/smoothPath';
import { toCsv, downloadCsv } from '../lib/csv';
import { countryFlag, countryName } from '../lib/country';
import { appBaseDomain } from '../lib/workspaceHost';
import { Kpi, ConsoleHero, FilterChips, QuotaBar } from '../components/platform/ConsoleUI';

// Platform (super-admin) console — provision & manage TENANTS (organizations). Gated by the global
// User.isPlatformAdmin flag; backed by the /admin/tenants API. Distinct from per-tenant admin.
export default function AdminTenantsPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const id = lang === 'id';
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: () => api.get<{ tenants: PlatformTenant[] }>('/admin/tenants'),
    enabled: !!user?.isPlatformAdmin,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['platform-tenants'] });

  if (!user?.isPlatformAdmin) {
    return <Card><p className="py-6 text-center text-slate-500 dark:text-slate-400">{id ? 'Butuh hak Platform Admin untuk mengelola organisasi.' : 'You need Platform Admin privilege to manage tenants.'}</p></Card>;
  }

  const tenants = data?.tenants ?? [];
  const corporate = tenants.filter((t) => !t.isPersonal);
  const stats = tenantStats(tenants);
  const pending = corporate.filter((t) => t.status === 'PENDING');
  const atCap = corporate.filter(atCapacity).length;

  const exportCsv = () => {
    const rows = corporate.map((t) => [
      t.name, t.slug, t.status, t.plan, t.memberCount, t.projectCount, formatBytes(t.storageBytes), t.customDomain ?? '', formatDate(t.createdAt), formatDate(t.updatedAt),
    ]);
    downloadCsv(`tenants-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(
      ['Name', 'Slug', 'Status', 'Plan', 'Members', 'Projects', 'Storage', 'Custom domain', 'Created', 'Updated'], rows,
    ));
  };

  return (
    <div className="space-y-5">
      <ConsoleHero
        eyebrow={id ? 'Konsol Platform' : 'Platform Console'}
        title={id ? 'Organisasi' : 'Organizations'}
        subtitle={id ? 'Provisi, tangguhkan, dan kelola setiap organisasi lintas platform.' : 'Provision, suspend and manage every organization across the platform.'}
        action={(
          <div className="flex shrink-0 gap-2">
            <button onClick={exportCsv} disabled={!corporate.length} className="rounded-lg border border-white/40 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50">
              ⬇ CSV
            </button>
            <button onClick={() => setCreating(true)} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm transition hover:bg-white/90">
              + {id ? 'Buat organisasi' : 'Provision tenant'}
            </button>
          </div>
        )}
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <>
          {/* Headline metrics — derived client-side from the tenant list. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Kpi label={id ? 'Organisasi' : 'Tenants'} value={stats.total} tone="indigo" />
            <Kpi label={id ? 'Aktif' : 'Active'} value={stats.active} tone="emerald" />
            <Kpi label={id ? 'Menunggu' : 'Pending'} value={stats.pending} tone="amber" pulse={stats.pending > 0} />
            <Kpi label={id ? 'Ditangguhkan' : 'Suspended'} value={stats.suspended} tone="red" />
            <Kpi label={id ? 'Anggota' : 'Members'} value={stats.members} tone="slate" hint={stats.personal > 0 ? `+${stats.personal} sandbox` : undefined} />
            <Kpi label={id ? 'MRR (est.)' : 'MRR (est.)'} value={formatIdrShort(stats.mrr)} tone="violet" hint={stats.paying > 0 ? `${stats.paying} ${id ? 'berbayar' : 'paying'} · ARPA ${formatIdrShort(stats.arpa)}` : (id ? 'belum ada berbayar' : 'no paying tenants')} />
            <Kpi label={id ? 'Kuota penuh' : 'At capacity'} value={atCap} tone={atCap > 0 ? 'red' : 'slate'} pulse={atCap > 0} hint={id ? 'di/atas batas paket' : 'at/over a plan cap'} />
          </div>

          <NeedsAttention corporate={corporate} id={id} />

          <GrowthTrends corporate={corporate} id={id} />

          <div className="grid gap-3 lg:grid-cols-3">
            <PlanBar split={stats.planSplit} total={stats.total} id={id} />
            <Leaderboard corporate={corporate} id={id} />
            <ActivityFeed id={id} />
          </div>

          <GeoPanel id={id} />

          {pending.length > 0 && <PendingSpotlight pending={pending} onChange={invalidate} id={id} />}

          <TenantTable corporate={corporate} personal={stats.personal} onChange={invalidate} id={id} />
        </>
      )}

      {creating && (
        <Modal onClose={() => setCreating(false)} title={id ? 'Buat organisasi' : 'Provision tenant'} size="lg">
          <CreateTenant bare onChange={invalidate} onDone={() => setCreating(false)} />
        </Modal>
      )}
    </div>
  );
}

// ── Platform-console presentational pieces (Kpi / ConsoleHero / FilterChips are shared) ─────────

function PlanBar({ split, total, id }: { split: Record<Plan, number>; total: number; id: boolean }) {
  const seg: { k: Plan; n: number; c: string }[] = [
    { k: 'TRIAL', n: split.TRIAL, c: 'bg-slate-400' },
    { k: 'PRO', n: split.PRO, c: 'bg-indigo-500' },
    { k: 'ENTERPRISE', n: split.ENTERPRISE, c: 'bg-violet-600' },
  ];
  return (
    <Card>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{id ? 'Distribusi paket' : 'Plan distribution'}</div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {total > 0 && seg.filter((s) => s.n > 0).map((s) => (
          <div key={s.k} className={s.c} style={{ width: `${(s.n / total) * 100}%` }} title={`${s.k}: ${s.n}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        {seg.map((s) => (
          <span key={s.k} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${s.c}`} />{s.k} <b className="tabular-nums">{s.n}</b>
          </span>
        ))}
      </div>
    </Card>
  );
}

// Free-vs-subscriber segmentation by country (from Cloudflare geo capture). Users get a stacked bar
// (subscriber vs free); org counts shown alongside. Hidden until there's any geo data.
function GeoPanel({ id }: { id: boolean }) {
  const lang = id ? 'id' : 'en';
  const { data, isLoading } = useQuery({
    queryKey: ['platform-geo'],
    queryFn: () => api.get<{ byCountry: PlatformGeoRow[] }>('/admin/tenants/geo'),
    refetchInterval: 300_000,
  });
  const rows = data?.byCountry ?? [];
  if (!isLoading && rows.length === 0) return null;
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{id ? 'Menurut negara · Gratis vs Pelanggan' : 'By country · Free vs Subscriber'}</span>
        <span className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-indigo-500" />{id ? 'Pelanggan' : 'Subscriber'}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300 dark:bg-slate-600" />{id ? 'Gratis' : 'Free'}</span>
        </span>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 10).map((r) => {
            const users = r.freeUsers + r.subscriberUsers;
            const subPct = users ? (r.subscriberUsers / users) * 100 : 0;
            const orgs = r.freeTenants + r.paidTenants;
            return (
              <li key={r.country} className="flex items-center gap-2.5 text-sm">
                <span className="text-lg leading-none" title={r.country}>{countryFlag(r.country)}</span>
                <span className="w-28 shrink-0 truncate text-slate-700 dark:text-slate-200">{countryName(r.country, lang)}</span>
                <div className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" title={`${r.subscriberUsers} subscriber · ${r.freeUsers} free`}>
                  <div className="bg-indigo-500" style={{ width: `${subPct}%` }} />
                  <div className="bg-slate-300 dark:bg-slate-600" style={{ width: `${100 - subPct}%` }} />
                </div>
                <span className="shrink-0 tabular-nums text-xs text-slate-500 dark:text-slate-400">
                  <b className="text-indigo-600 dark:text-indigo-300">{r.subscriberUsers}</b> / {users}
                  {orgs > 0 && <span className="ml-2 text-slate-400 dark:text-slate-500">· {orgs} {id ? 'org' : 'orgs'}{r.paidTenants > 0 ? ` (${r.paidTenants} ${id ? 'bayar' : 'paid'})` : ''}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// "Needs attention" — the super-admin triage panel: tenants over a cap, suspended-with-data, pending,
// or empty. Hidden when nothing needs action. Client-only (from the tenant payload).
const TRIAGE_ICON: Record<string, string> = { 'over-cap': '⚠', 'suspended-data': '⏸', pending: '★', empty: '○' };
const TRIAGE_COLOR: Record<string, string> = { high: 'text-red-500', medium: 'text-amber-500', low: 'text-slate-400 dark:text-slate-500' };
function NeedsAttention({ corporate, id }: { corporate: PlatformTenant[]; id: boolean }) {
  const items = useMemo(() => triage(corporate), [corporate]);
  if (items.length === 0) return null;
  const reason = (it: TriageItem): string => {
    if (it.kind === 'over-cap') {
      const dimLabel = it.dim === 'members' ? (id ? 'anggota' : 'member') : it.dim === 'projects' ? (id ? 'proyek' : 'project') : (id ? 'penyimpanan' : 'storage');
      const fmt = it.dim === 'storage' ? formatBytes : (n: number) => String(n);
      return id ? `melebihi batas ${dimLabel} (${fmt(it.used ?? 0)}/${fmt(it.cap ?? 0)})` : `over ${dimLabel} cap (${fmt(it.used ?? 0)}/${fmt(it.cap ?? 0)})`;
    }
    if (it.kind === 'suspended-data') return id ? `ditangguhkan · ${it.tenant.projectCount} proyek` : `suspended · ${it.tenant.projectCount} project${it.tenant.projectCount === 1 ? '' : 's'}`;
    if (it.kind === 'pending') { const days = Math.floor((Date.now() - +new Date(it.tenant.createdAt)) / 86_400_000); return id ? `pendaftaran menunggu ${days}h` : `signup pending ${days}d`; }
    return id ? '0 proyek (stagnan)' : '0 projects (stale)';
  };
  return (
    <Card className="border-amber-300/60 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
        <span aria-hidden>⚠</span> {id ? 'Perlu perhatian' : 'Needs attention'} ({items.length})
      </div>
      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {items.slice(0, 8).map((it) => (
          <li key={it.tenant.id} className="flex items-center gap-2 text-sm">
            <span className={`shrink-0 ${TRIAGE_COLOR[it.severity]}`} aria-hidden>{TRIAGE_ICON[it.kind]}</span>
            <span className="min-w-0 truncate"><b className="font-medium text-slate-700 dark:text-slate-200">{it.tenant.name}</b> <span className="text-slate-500 dark:text-slate-400">— {reason(it)}</span></span>
          </li>
        ))}
      </ul>
      {items.length > 8 && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">+{items.length - 8} {id ? 'lainnya' : 'more'}</p>}
    </Card>
  );
}

// Growth trends — cumulative tenants + est. MRR over the last 6 months, reusing the S-curve
// smoothing engine for a modern area sparkline. Client-only (from createdAt + current plan).
function TrendSpark({ values, color }: { values: number[]; color: string }) {
  const W = 300, H = 72, padT = 10, padB = 10, padL = 4, padR = 6;
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const n = values.length;
  const X = (i: number) => padL + (n <= 1 ? 0 : i / (n - 1)) * (W - padL - padR);
  const Y = (v: number) => padT + (1 - (v - min) / ((max - min) || 1)) * (H - padT - padB);
  const pts: Pt[] = values.map((v, i) => ({ x: X(i), y: Y(v) }));
  const last = pts[pts.length - 1];
  const gradId = `grow-${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" preserveAspectRatio="none" role="img" aria-label="growth trend">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {pts.length > 1 && <path d={areaPath(pts, H - padB)} fill={`url(#${gradId})`} stroke="none" />}
      {pts.length > 1 && <path d={smoothPath(pts)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      {last && <circle cx={last.x} cy={last.y} r="2.6" fill={color} stroke="#fff" strokeWidth="1" />}
    </svg>
  );
}

function TrendPanel({ title, series, pick, fmt, color }: { title: string; series: GrowthPoint[]; pick: (p: GrowthPoint) => number; fmt: (n: number) => string; color: string }) {
  const values = series.map(pick);
  const latest = values[values.length - 1] ?? 0;
  const delta = latest - (values[values.length - 2] ?? 0);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</span>
        {delta !== 0 && (
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${delta > 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
            {delta > 0 ? '+' : '−'}{fmt(Math.abs(delta))}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-xl font-bold tabular-nums text-slate-800 dark:text-slate-100">{fmt(latest)}</div>
      <TrendSpark values={values} color={color} />
      <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500">
        <span>{series[0]?.label}</span><span>{series[series.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function GrowthTrends({ corporate, id }: { corporate: PlatformTenant[]; id: boolean }) {
  const series = useMemo(() => growthSeries(corporate, 6), [corporate]);
  return (
    <Card>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{id ? 'Pertumbuhan (6 bln terakhir)' : 'Growth (last 6 months)'}</div>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <TrendPanel title={id ? 'Total organisasi' : 'Total tenants'} series={series} pick={(p) => p.tenants} fmt={(n) => String(n)} color="#6366f1" />
        <TrendPanel title="MRR (est.)" series={series} pick={(p) => p.mrr} fmt={formatIdrShort} color="#8b5cf6" />
      </div>
    </Card>
  );
}

// Top tenants by a selectable usage metric (members / projects / storage) — a quick "biggest
// accounts" panel. Client-only: the metrics already ride in the tenant payload.
type LeaderMetric = 'members' | 'projects' | 'storage';
function Leaderboard({ corporate, id }: { corporate: PlatformTenant[]; id: boolean }) {
  const [metric, setMetric] = useState<LeaderMetric>('members');
  const val = (t: PlatformTenant) => (metric === 'members' ? t.memberCount : metric === 'projects' ? t.projectCount : t.storageBytes);
  const fmt = metric === 'storage' ? formatBytes : (n: number) => String(n);
  const ranked = [...corporate].sort((a, b) => val(b) - val(a)).slice(0, 5);
  const max = Math.max(1, ...ranked.map(val));
  const labels: Record<LeaderMetric, string> = { members: id ? 'Anggota' : 'Members', projects: id ? 'Proyek' : 'Projects', storage: id ? 'Penyimpanan' : 'Storage' };
  return (
    <Card className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{id ? 'Organisasi teratas' : 'Top tenants'}</span>
        <div className="flex gap-1">
          {(['members', 'projects', 'storage'] as LeaderMetric[]).map((m) => (
            <button key={m} onClick={() => setMetric(m)} className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${metric === m ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}>{labels[m]}</button>
          ))}
        </div>
      </div>
      {ranked.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-3 text-center text-sm text-slate-500 dark:text-slate-400">{id ? 'Belum ada organisasi.' : 'No tenants yet.'}</p>
      ) : (
        <ol className="space-y-2">
          {ranked.map((t, i) => {
            const v = val(t);
            return (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span className="w-4 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-400 dark:text-slate-500">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium text-slate-700 dark:text-slate-200">{t.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{fmt(v)}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-indigo-500 transition-[width] duration-500" style={{ width: `${Math.max(3, (v / max) * 100)}%` }} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

// Cross-tenant platform activity — the super-admin's oversight feed (who did what, when).
const TONE_DOT: Record<string, string> = { good: 'bg-emerald-500', bad: 'bg-red-500', neutral: 'bg-indigo-400' };
function ActivityFeed({ id }: { id: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['platform-activity'],
    queryFn: () => api.get<{ activity: PlatformActivity[] }>('/admin/tenants/activity'),
    refetchInterval: 60_000,
  });
  const events = data?.activity ?? [];
  return (
    <Card className="flex h-full flex-col">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{id ? 'Aktivitas terbaru' : 'Recent activity'}</div>
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center py-4"><Spinner /></div>
      ) : events.length === 0 ? (
        <p className="py-3 text-center text-sm text-slate-500 dark:text-slate-400">{id ? 'Belum ada aktivitas platform.' : 'No platform activity yet.'}</p>
      ) : (
        <ul className="-my-1 max-h-56 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
          {events.map((e) => {
            const d = describeActivity(e, id);
            return (
              <li key={e.id} className="flex items-center gap-2.5 py-2 text-sm">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[d.tone]}`} />
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                  {e.actorName && <b className="font-medium">{e.actorName}</b>} {d.text}
                </span>
                <span className="shrink-0 tabular-nums text-xs text-slate-400 dark:text-slate-500" title={formatDate(e.createdAt)}>{timeAgo(e.createdAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// Signups awaiting review — hoisted out of the table into a spotlight so the queue can't be missed.
function PendingSpotlight({ pending, onChange, id }: { pending: PlatformTenant[]; onChange: () => void; id: boolean }) {
  return (
    <Card className="border-amber-300/60 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
        <span aria-hidden>★</span> {id ? `${pending.length} pendaftaran menunggu persetujuan` : `${pending.length} signup${pending.length === 1 ? '' : 's'} awaiting approval`}
      </div>
      <div className="space-y-2">
        {pending.map((t) => <PendingItem key={t.id} t={t} onChange={onChange} id={id} />)}
      </div>
    </Card>
  );
}

function PendingItem({ t, onChange, id }: { t: PlatformTenant; onChange: () => void; id: boolean }) {
  const { review, approve, reject } = useTenantActions(t, onChange);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 dark:border-amber-900/40 dark:bg-slate-900">
      <div className="min-w-0">
        <span className="font-medium text-slate-700 dark:text-slate-200">{t.name}</span>
        <span className="ml-2 font-mono text-xs text-slate-500 dark:text-slate-400">{t.slug} · {t.memberCount} {id ? 'anggota' : 'members'}</span>
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" onClick={approve} disabled={review.isPending} className="text-green-600 dark:text-green-400">{id ? 'Setujui' : 'Approve'}</Button>
        <Button variant="ghost" onClick={reject} disabled={review.isPending} className="text-red-600 dark:text-red-400">{id ? 'Tolak' : 'Reject'}</Button>
      </div>
    </div>
  );
}

const STATUS_FILTERS = ['ALL', 'ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];
const PLAN_RANK: Record<Plan, number> = { TRIAL: 0, PRO: 1, ENTERPRISE: 2 };
type SortKey = 'name' | 'memberCount' | 'plan' | 'createdAt' | 'updatedAt';

// A clickable, sortable column header — toggles asc/desc, shows the active arrow.
function SortTh({ label, k, sort, setSort, align }: { label: string; k: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; setSort: (s: { key: SortKey; dir: 'asc' | 'desc' }) => void; align?: 'right' }) {
  const active = sort.key === k;
  return (
    <th
      onClick={() => setSort(active ? { key: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'name' ? 'asc' : 'desc' })}
      className={`cursor-pointer select-none whitespace-nowrap hover:text-slate-700 dark:hover:text-slate-200 ${align === 'right' ? 'text-right' : ''} ${active ? 'text-indigo-600 dark:text-indigo-300' : ''}`}
    >
      {label}<span className="ml-0.5 text-[9px]">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </th>
  );
}

// Bulk-action bar for the selected tenants — loops the existing per-tenant endpoints (suspend /
// reactivate / set plan / export), with Promise.allSettled so one failure doesn't abort the rest.
function BulkBar({ tenants, onClear, onChange, id }: { tenants: PlatformTenant[]; onClear: () => void; onChange: () => void; id: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const n = tenants.length;
  const apply = async (fn: (t: PlatformTenant) => Promise<unknown>) => {
    setBusy(true);
    const results = await Promise.allSettled(tenants.map(fn));
    setBusy(false);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    if (ok) toast.success(id ? `${ok} organisasi diperbarui${fail ? `, ${fail} gagal` : ''}` : `${ok} tenant${ok === 1 ? '' : 's'} updated${fail ? `, ${fail} failed` : ''}`);
    else toast.error(id ? 'Semua gagal' : 'All failed');
    onChange();
    onClear();
  };
  const suspend = async () => {
    if (!(await confirm({ title: id ? 'Tangguhkan terpilih?' : 'Suspend selected?', message: id ? <>Tangguhkan <strong>{n}</strong> organisasi? Semua anggotanya langsung terkunci.</> : <>Suspend <strong>{n}</strong> tenant{n === 1 ? '' : 's'}? All their members are immediately locked out.</>, confirmLabel: id ? 'Tangguhkan' : 'Suspend', danger: true }))) return;
    apply((t) => api.patch(`/admin/tenants/${t.id}`, { status: 'SUSPENDED' }));
  };
  const reactivate = () => apply((t) => api.patch(`/admin/tenants/${t.id}`, { status: 'ACTIVE' }));
  const setPlan = async (plan: PlatformTenant['plan']) => {
    if (!(await confirm({ title: id ? `Ubah paket → ${plan}?` : `Set plan → ${plan}?`, message: id ? <>Ubah paket <strong>{n}</strong> organisasi menjadi <strong>{plan}</strong>?</> : <>Change <strong>{n}</strong> tenant{n === 1 ? '' : 's'} to the <strong>{plan}</strong> plan?</>, confirmLabel: id ? 'Ubah' : 'Change' }))) return;
    apply((t) => api.patch(`/admin/tenants/${t.id}`, { plan }));
  };
  const exportAll = async () => {
    setBusy(true);
    for (const t of tenants) { try { await api.download(`/admin/tenants/${t.id}/export`, `tenant-${t.slug}-export.json`); } catch { /* skip */ } }
    setBusy(false);
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-900/50 dark:bg-indigo-950/30">
      <span className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">{n} {id ? 'terpilih' : 'selected'}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" disabled={busy} onClick={suspend} className="text-red-600 dark:text-red-400">{id ? 'Tangguhkan' : 'Suspend'}</Button>
        <Button variant="secondary" disabled={busy} onClick={reactivate} className="text-green-600 dark:text-green-400">{id ? 'Aktifkan' : 'Reactivate'}</Button>
        <select disabled={busy} defaultValue="" onChange={(e) => { if (e.target.value) { setPlan(e.target.value as PlatformTenant['plan']); e.target.value = ''; } }} title={id ? 'Ubah paket' : 'Set plan'} className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <option value="" disabled>{id ? 'Paket…' : 'Plan…'}</option>
          {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <Button variant="secondary" disabled={busy} onClick={exportAll}>{id ? 'Ekspor' : 'Export'}</Button>
      </div>
      <button onClick={onClear} className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">{id ? 'Bersihkan' : 'Clear'}</button>
    </div>
  );
}

// The tenant registry with a search box, status-filter chips, and sortable columns. Table on sm+,
// cards on phones. Default sort: newest first.
function TenantTable({ corporate, personal, onChange, id }: { corporate: PlatformTenant[]; personal: number; onChange: () => void; id: boolean }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'createdAt', dir: 'desc' });
  const filterLabel: Record<StatusFilter, string> = {
    ALL: id ? 'Semua' : 'All', ACTIVE: id ? 'Aktif' : 'Active', PENDING: id ? 'Menunggu' : 'Pending',
    SUSPENDED: id ? 'Ditangguhkan' : 'Suspended', REJECTED: id ? 'Ditolak' : 'Rejected',
  };
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = corporate.filter((t) => {
      if (filter !== 'ALL' && t.status !== filter) return false;
      if (!needle) return true;
      return t.name.toLowerCase().includes(needle) || t.slug.toLowerCase().includes(needle) || (t.customDomain ?? '').toLowerCase().includes(needle);
    });
    const cmp = (a: PlatformTenant, b: PlatformTenant): number => {
      switch (sort.key) {
        case 'name': return a.name.localeCompare(b.name);
        case 'memberCount': return a.memberCount - b.memberCount;
        case 'plan': return PLAN_RANK[a.plan] - PLAN_RANK[b.plan];
        case 'createdAt': return +new Date(a.createdAt) - +new Date(b.createdAt);
        case 'updatedAt': return +new Date(a.updatedAt) - +new Date(b.updatedAt);
      }
    };
    return [...filtered].sort((a, b) => (sort.dir === 'asc' ? cmp(a, b) : -cmp(a, b)));
  }, [corporate, q, filter, sort]);

  // Bulk selection — checkbox per row + select-all over the visible (filtered) rows.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (tid: string) => setSelected((s) => { const n = new Set(s); if (n.has(tid)) n.delete(tid); else n.add(tid); return n; });
  const clear = () => setSelected(new Set());
  const visibleIds = rows.map((r) => r.id);
  const allSel = visibleIds.length > 0 && visibleIds.every((i) => selected.has(i));
  const someSel = visibleIds.some((i) => selected.has(i)) && !allSel;
  const toggleAll = () => setSelected((s) => { const n = new Set(s); if (allSel) visibleIds.forEach((i) => n.delete(i)); else visibleIds.forEach((i) => n.add(i)); return n; });
  const selectedTenants = corporate.filter((t) => selected.has(t.id));

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={id ? 'Cari nama / slug / domain…' : 'Search name / slug / domain…'} />
        </div>
        <FilterChips options={STATUS_FILTERS} value={filter} onChange={setFilter} labels={filterLabel} />
      </div>

      {selectedTenants.length > 0 && <BulkBar tenants={selectedTenants} onClear={clear} onChange={onChange} id={id} />}

      {!corporate.length ? (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{id ? 'Belum ada organisasi korporat. Buat yang pertama lewat tombol di atas.' : 'No corporate tenants yet — create the first one from the button above.'}</p>
      ) : !rows.length ? (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{id ? 'Tidak ada yang cocok dengan filter.' : 'Nothing matches the current filter.'}</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="prima-rows w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                  <th className="w-8"><input type="checkbox" checked={allSel} ref={(el) => { if (el) el.indeterminate = someSel; }} onChange={toggleAll} aria-label={id ? 'Pilih semua' : 'Select all'} className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /></th>
                  <SortTh label={id ? 'Nama' : 'Name'} k="name" sort={sort} setSort={setSort} />
                  <th>Slug</th>
                  <th>{id ? 'Status' : 'Status'}</th>
                  <SortTh label={id ? 'Paket' : 'Plan'} k="plan" sort={sort} setSort={setSort} />
                  <SortTh label={id ? 'Anggota' : 'Members'} k="memberCount" sort={sort} setSort={setSort} align="right" />
                  <SortTh label={id ? 'Dibuat' : 'Created'} k="createdAt" sort={sort} setSort={setSort} />
                  <SortTh label={id ? 'Diubah' : 'Updated'} k="updatedAt" sort={sort} setSort={setSort} />
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => <TenantRow key={t.id} t={t} onChange={onChange} selected={selected.has(t.id)} onToggle={() => toggle(t.id)} />)}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 sm:hidden">
            {rows.map((t) => <TenantCard key={t.id} t={t} onChange={onChange} selected={selected.has(t.id)} onToggle={() => toggle(t.id)} />)}
          </div>
        </>
      )}
      {personal > 0 && (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
          {id ? `+ ${personal} sandbox pribadi tamu (tidak dikelola di sini).` : `+ ${personal} personal guest sandbox${personal === 1 ? '' : 'es'} (not managed here).`}
        </p>
      )}
    </Card>
  );
}

function useTenantActions(t: PlatformTenant, onChange: () => void) {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const confirm = useConfirm();
  const { impersonate } = useAuth();
  const navigate = useNavigate();
  const [entering, setEntering] = useState(false);
  const enter = async () => {
    setEntering(true);
    try { await impersonate(t.id, t.name); navigate('/'); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setEntering(false); }
  };
  const patch = useMutation({
    mutationFn: (body: { status?: 'ACTIVE' | 'SUSPENDED'; name?: string; plan?: PlatformTenant['plan'] }) => api.patch(`/admin/tenants/${t.id}`, body),
    onSuccess: () => { onChange(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  // Self-serve signup queue (option C): approve (→ ACTIVE, owner can sign in) / reject (→ REJECTED).
  const review = useMutation({
    mutationFn: (action: 'approve' | 'reject') => api.post(`/admin/tenants/${t.id}/${action}`, {}),
    onSuccess: (_d, action) => { onChange(); toast.success(action === 'approve' ? (id ? `${t.name} disetujui` : `${t.name} approved`) : (id ? `${t.name} ditolak` : `${t.name} rejected`)); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const approve = () => review.mutate('approve');
  const reject = async () => {
    if (!(await confirm({
      title: id ? 'Tolak pendaftaran?' : 'Reject signup?',
      message: id ? <>Tolak permintaan workspace <strong>{t.name}</strong>? Workspace ditandai DITOLAK dan pemiliknya tetap tidak bisa masuk (bisa dihapus permanen nanti).</> : <>Reject the <strong>{t.name}</strong> workspace request? It's marked REJECTED and its owner stays locked out (you can hard-delete it later).</>,
      confirmLabel: id ? 'Tolak' : 'Reject',
      danger: true,
    }))) return;
    review.mutate('reject');
  };
  const setPlan = (plan: PlatformTenant['plan']) => {
    if (plan === t.plan) return;
    patch.mutate({ plan }, { onSuccess: () => { onChange(); toast.success(id ? `Paket ${t.name} → ${plan}` : `${t.name} plan → ${plan}`); } });
  };
  const extendTrial = useMutation({
    mutationFn: (days: number) => api.post(`/admin/tenants/${t.id}/extend-trial`, { days }),
    onSuccess: () => { onChange(); toast.success(id ? `Uji coba ${t.name} diperpanjang` : `${t.name} trial extended`); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const [exporting, setExporting] = useState(false);
  const exportData = async () => {
    setExporting(true);
    try { await api.download(`/admin/tenants/${t.id}/export`, `tenant-${t.slug}-export.json`); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setExporting(false); }
  };
  const toggleSuspend = async () => {
    if (t.status === 'ACTIVE') {
      if (!(await confirm({
        title: id ? 'Tangguhkan organisasi?' : 'Suspend tenant?',
        message: id ? <>Tangguhkan <strong>{t.name}</strong>? Semua anggotanya langsung terkunci dari sistem hingga diaktifkan lagi.</> : <>Suspend <strong>{t.name}</strong>? All of its members are immediately locked out until it's reactivated.</>,
        confirmLabel: id ? 'Tangguhkan' : 'Suspend',
        danger: true,
      }))) return;
      patch.mutate({ status: 'SUSPENDED' }, { onSuccess: () => { onChange(); toast.success(id ? `${t.name} ditangguhkan` : `${t.name} suspended`); } });
    } else {
      patch.mutate({ status: 'ACTIVE' }, { onSuccess: () => { onChange(); toast.success(id ? `${t.name} diaktifkan` : `${t.name} reactivated`); } });
    }
  };
  return { patch, review, approve, reject, toggleSuspend, enter, entering, exportData, exporting, setPlan, extendTrial };
}

// Compact trial indicator + "extend" control for a TRIAL corporate tenant (platform console). Shows
// days left (or "ended") and a +14-day extend button. Nothing for paid/personal tenants.
function TrialCell({ t, onExtend, busy }: { t: PlatformTenant; onExtend: (days: number) => void; busy: boolean }) {
  const { lang } = useLang();
  const id = lang === 'id';
  if (t.plan !== 'TRIAL' || t.isPersonal) return null;
  const ends = t.trialEndsAt ? new Date(t.trialEndsAt).getTime() : null;
  const expired = ends != null && ends <= Date.now();
  const daysLeft = ends != null ? Math.max(0, Math.ceil((ends - Date.now()) / 86_400_000)) : null;
  return (
    <span className="mt-1 inline-flex items-center gap-1.5">
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${expired ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
        {expired ? (id ? 'Uji coba berakhir' : 'Trial ended') : ends == null ? (id ? 'Uji coba' : 'Trial') : (id ? `Uji coba ${daysLeft}h` : `Trial ${daysLeft}d`)}
      </span>
      <button
        disabled={busy}
        onClick={() => onExtend(14)}
        title={id ? 'Perpanjang uji coba 14 hari' : 'Extend trial by 14 days'}
        className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        {busy ? '…' : '+14d'}
      </button>
    </span>
  );
}

const PLANS: PlatformTenant['plan'][] = ['TRIAL', 'PRO', 'ENTERPRISE'];

// Compact inline plan selector (platform admin sets a tenant's SaaS tier → quota limits).
function PlanSelect({ t, onPlan, disabled }: { t: PlatformTenant; onPlan: (p: PlatformTenant['plan']) => void; disabled?: boolean }) {
  return (
    <select
      value={t.plan}
      disabled={disabled}
      onChange={(e) => onPlan(e.target.value as PlatformTenant['plan'])}
      title="SaaS plan (quota tier)"
      className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
    >
      {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
    </select>
  );
}

function StatusBadge({ status }: { status: PlatformTenant['status'] }) {
  const { lang } = useLang();
  const id = lang === 'id';
  if (status === 'ACTIVE') return <Badge color="green">{id ? 'Aktif' : 'Active'}</Badge>;
  if (status === 'PENDING') return <Badge color="amber">{id ? 'Menunggu' : 'Pending'}</Badge>;
  if (status === 'REJECTED') return <Badge color="red">{id ? 'Ditolak' : 'Rejected'}</Badge>;
  return <Badge color="red">{id ? 'Ditangguhkan' : 'Suspended'}</Badge>;
}

function TenantRow({ t, onChange, selected, onToggle }: { t: PlatformTenant; onChange: () => void; selected: boolean; onToggle: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [domainOpen, setDomainOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const { patch, review, approve, reject, toggleSuspend, enter, entering, exportData, exporting, setPlan, extendTrial } = useTenantActions(t, onChange);
  const pending = t.status === 'PENDING';
  const memberCap = PLAN_LIMITS[t.plan].maxMembers;
  const memberOver = memberCap != null && t.memberCount >= memberCap;
  const memberNear = memberCap != null && !memberOver && t.memberCount / memberCap >= 0.8;
  return (
    <tr className={`border-b last:border-0 dark:border-slate-800 ${selected ? 'bg-indigo-50/60 dark:bg-indigo-950/30' : pending ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}`}>
      <td><input type="checkbox" checked={selected} onChange={onToggle} aria-label={id ? `Pilih ${t.name}` : `Select ${t.name}`} className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /></td>
      <td className="py-2 font-medium">
        <button onClick={() => setDetail(true)} className="text-left text-slate-700 hover:text-indigo-600 hover:underline dark:text-slate-200 dark:hover:text-indigo-300" title={id ? 'Lihat detail & kuota' : 'View details & quota'}>{t.name}</button>
      </td>
      <td className="font-mono text-xs text-slate-500 dark:text-slate-400">
        {t.slug}
        {t.customDomain && <span className="block text-[11px] text-indigo-500 dark:text-indigo-400">🔗 {t.customDomain}</span>}
      </td>
      <td><StatusBadge status={t.status} /></td>
      <td><div className="flex flex-col items-start"><PlanSelect t={t} onPlan={setPlan} disabled={patch.isPending} /><TrialCell t={t} onExtend={(d) => extendTrial.mutate(d)} busy={extendTrial.isPending} /></div></td>
      <td className={`text-right tabular-nums ${memberOver ? 'text-red-600 dark:text-red-400' : memberNear ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
        {t.memberCount}{memberCap != null && <span className="text-slate-400 dark:text-slate-500"> / {memberCap}</span>}
      </td>
      <td className="text-slate-500 dark:text-slate-400">{formatDate(t.createdAt)}</td>
      <td className="text-slate-500 dark:text-slate-400">{formatDate(t.updatedAt)}</td>
      <td className="text-right whitespace-nowrap">
        {pending && (
          <>
            <Button variant="ghost" onClick={approve} disabled={review.isPending} className="text-green-600 dark:text-green-400">{id ? 'Setujui' : 'Approve'}</Button>
            <Button variant="ghost" onClick={reject} disabled={review.isPending} className="text-red-600 dark:text-red-400">{id ? 'Tolak' : 'Reject'}</Button>
          </>
        )}
        <Button variant="ghost" onClick={enter} disabled={entering} title={id ? 'Masuk sebagai admin organisasi ini' : 'Act as an admin inside this tenant'}>{entering ? '…' : (id ? 'Masuk' : 'Enter')}</Button>
        <Button variant="ghost" onClick={() => setRenaming(true)} disabled={patch.isPending}>{id ? 'Ubah' : 'Edit'}</Button>
        <Button variant="ghost" onClick={() => setDomainOpen(true)} title={id ? 'Domain kustom' : 'Custom domain'}>{id ? 'Domain' : 'Domain'}</Button>
        <Button variant="ghost" onClick={exportData} disabled={exporting} title={id ? 'Unduh semua data organisasi (JSON)' : 'Download all tenant data (JSON)'}>{exporting ? '…' : (id ? 'Ekspor' : 'Export')}</Button>
        {!pending && (
          <Button variant="ghost" onClick={toggleSuspend} disabled={patch.isPending} className={t.status === 'ACTIVE' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
            {t.status === 'ACTIVE' ? (id ? 'Tangguhkan' : 'Suspend') : (id ? 'Aktifkan' : 'Reactivate')}
          </Button>
        )}
        <Button variant="ghost" onClick={() => setDeleting(true)} className="text-red-600 dark:text-red-400" title={id ? 'Hapus organisasi permanen' : 'Permanently delete tenant'}>{id ? 'Hapus' : 'Delete'}</Button>
      </td>
      {renaming && <RenameModal t={t} onClose={() => setRenaming(false)} onChange={onChange} />}
      {domainOpen && <DomainModal t={t} onClose={() => setDomainOpen(false)} onChange={onChange} />}
      {deleting && <DeleteModal t={t} onClose={() => setDeleting(false)} onChange={onChange} />}
      {detail && <TenantDetailModal t={t} onClose={() => setDetail(false)} />}
    </tr>
  );
}

// Drill-down: per-tenant details + quota usage (members / projects / storage) against the plan caps.
const PROJECT_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  CHARTERED: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  IN_PROGRESS: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  ON_HOLD: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  CLOSED: 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
};

function TenantDetailModal({ t, onClose }: { t: PlatformTenant; onClose: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const lim = PLAN_LIMITS[t.plan];
  const { data, isLoading } = useQuery({
    queryKey: ['tenant-detail', t.id],
    queryFn: () => api.get<PlatformTenantDetail>(`/admin/tenants/${t.id}/detail`),
  });
  return (
    <Modal onClose={onClose} title={t.name} size="md">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-slate-600 dark:text-slate-300">
          <span className="font-mono text-xs">{t.slug}</span>
          <StatusBadge status={t.status} />
          <span>{id ? 'Paket' : 'Plan'} <b>{t.plan}</b></span>
          <span>{id ? 'Dibuat' : 'Created'} {formatDate(t.createdAt)}</span>
          <span>{id ? 'Diubah' : 'Updated'} {formatDate(t.updatedAt)}</span>
          {t.customDomain && <span className="text-indigo-500 dark:text-indigo-400">🔗 {t.customDomain}</span>}
        </div>
        <div className="space-y-2.5 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{id ? 'Penggunaan kuota' : 'Quota usage'}</div>
          <QuotaBar label={id ? 'Anggota' : 'Members'} used={t.memberCount} cap={lim.maxMembers} format={(n) => String(n)} />
          <QuotaBar label={id ? 'Proyek' : 'Projects'} used={t.projectCount} cap={lim.maxProjects} format={(n) => String(n)} />
          <QuotaBar label={id ? 'Penyimpanan' : 'Storage'} used={t.storageBytes} cap={lim.storageMb == null ? null : lim.storageMb * 1024 * 1024} format={formatBytes} />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-4"><Spinner /></div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Member roster */}
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{id ? 'Anggota' : 'Members'} ({data?.members.length ?? 0})</div>
              {data && data.members.length > 0 ? (
                <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                  {data.members.map((m) => (
                    <li key={m.userId} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-slate-700 dark:text-slate-200" title={m.email}>{m.name || m.email}</span>
                      <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{m.role}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-slate-400 dark:text-slate-500">{id ? 'Tidak ada anggota.' : 'No members.'}</p>}
            </div>
            {/* Recent projects */}
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{id ? 'Proyek terbaru' : 'Recent projects'}</div>
              {data && data.projects.length > 0 ? (
                <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                  {data.projects.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{p.name}</span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PROJECT_STATUS_COLOR[p.status] ?? PROJECT_STATUS_COLOR.DRAFT}`}>{p.status.replace('_', ' ')}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-slate-400 dark:text-slate-500">{id ? 'Belum ada proyek.' : 'No projects yet.'}</p>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function TenantCard({ t, onChange, selected, onToggle }: { t: PlatformTenant; onChange: () => void; selected: boolean; onToggle: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [domainOpen, setDomainOpen] = useState(false);
  const { patch, review, approve, reject, toggleSuspend, enter, entering, exportData, exporting, setPlan, extendTrial } = useTenantActions(t, onChange);
  const pending = t.status === 'PENDING';
  return (
    <div className={`rounded-xl border p-3 dark:border-slate-800 ${selected ? 'border-indigo-300 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/30' : pending ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={id ? `Pilih ${t.name}` : `Select ${t.name}`} className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
          <div className="min-w-0">
          <p className="font-medium text-slate-700 dark:text-slate-200">{t.name}</p>
          <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">{t.slug} · {t.memberCount} {id ? 'anggota' : 'members'}</p>
          {t.customDomain && <p className="truncate font-mono text-[11px] text-indigo-500 dark:text-indigo-400">🔗 {t.customDomain}</p>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={t.status} />
          <PlanSelect t={t} onPlan={setPlan} disabled={patch.isPending} />
          <TrialCell t={t} onExtend={(d) => extendTrial.mutate(d)} busy={extendTrial.isPending} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-end gap-1 border-t border-slate-100 pt-2 dark:border-slate-800">
        {pending && (
          <>
            <Button variant="ghost" onClick={approve} disabled={review.isPending} className="text-green-600 dark:text-green-400">{id ? 'Setujui' : 'Approve'}</Button>
            <Button variant="ghost" onClick={reject} disabled={review.isPending} className="text-red-600 dark:text-red-400">{id ? 'Tolak' : 'Reject'}</Button>
          </>
        )}
        <Button variant="ghost" onClick={enter} disabled={entering}>{entering ? '…' : (id ? 'Masuk' : 'Enter')}</Button>
        <Button variant="ghost" onClick={() => setRenaming(true)} disabled={patch.isPending}>{id ? 'Ubah' : 'Edit'}</Button>
        <Button variant="ghost" onClick={() => setDomainOpen(true)}>Domain</Button>
        <Button variant="ghost" onClick={exportData} disabled={exporting}>{exporting ? '…' : (id ? 'Ekspor' : 'Export')}</Button>
        {!pending && (
          <Button variant="ghost" onClick={toggleSuspend} disabled={patch.isPending} className={t.status === 'ACTIVE' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
            {t.status === 'ACTIVE' ? (id ? 'Tangguhkan' : 'Suspend') : (id ? 'Aktifkan' : 'Reactivate')}
          </Button>
        )}
        <Button variant="ghost" onClick={() => setDeleting(true)} className="text-red-600 dark:text-red-400">{id ? 'Hapus' : 'Delete'}</Button>
      </div>
      {renaming && <RenameModal t={t} onClose={() => setRenaming(false)} onChange={onChange} />}
      {domainOpen && <DomainModal t={t} onClose={() => setDomainOpen(false)} onChange={onChange} />}
      {deleting && <DeleteModal t={t} onClose={() => setDeleting(false)} onChange={onChange} />}
    </div>
  );
}

const SLUG_SHAPE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
function RenameModal({ t, onClose, onChange }: { t: PlatformTenant; onClose: () => void; onChange: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const [name, setName] = useState(t.name);
  const [slug, setSlug] = useState(t.slug);
  const base = appBaseDomain();
  const save = useMutation({
    mutationFn: () => {
      const body: { name?: string; slug?: string } = {};
      if (name.trim() !== t.name) body.name = name.trim();
      if (slug.trim().toLowerCase() !== t.slug) body.slug = slug.trim().toLowerCase();
      return api.patch(`/admin/tenants/${t.id}`, body);
    },
    onSuccess: () => { onChange(); toast.success(id ? 'Organisasi diperbarui' : 'Tenant updated'); onClose(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const normSlug = slug.trim().toLowerCase();
  const slugOk = normSlug.length >= 2 && normSlug.length <= 40 && SLUG_SHAPE.test(normSlug);
  const nameChanged = name.trim().length >= 2 && name.trim() !== t.name;
  const slugChanged = normSlug !== t.slug;
  const canSubmit = (nameChanged || slugChanged) && !(slugChanged && !slugOk);
  return (
    <Modal onClose={onClose} title={id ? 'Ubah organisasi' : 'Edit tenant'} size="sm">
      <form onSubmit={(e) => { e.preventDefault(); if (canSubmit && !save.isPending) save.mutate(); }} className="space-y-3">
        <Field label={id ? 'Nama' : 'Name'}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={id ? 'Subdomain' : 'Subdomain'}>
          <div className="flex items-center gap-1.5">
            <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} className="font-mono" />
            {base && <span className="shrink-0 font-mono text-sm text-slate-400 dark:text-slate-500">.{base}</span>}
          </div>
        </Field>
        {slugChanged && !slugOk && <p className="text-xs font-medium text-red-500">{id ? '2–40 karakter: huruf kecil, angka, tanda hubung.' : '2–40 chars: lowercase letters, digits, single hyphens.'}</p>}
        {slugChanged && slugOk && <p className="text-xs text-amber-600 dark:text-amber-400">{id ? '⚠ Mengubah subdomain menonaktifkan URL lama.' : '⚠ Changing the subdomain breaks the old URL.'}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{id ? 'Batal' : 'Cancel'}</Button>
          <Button type="submit" disabled={!canSubmit || save.isPending}>{save.isPending ? (id ? 'Menyimpan…' : 'Saving…') : (id ? 'Simpan' : 'Save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

// Type-to-confirm HARD DELETE. Wipes the tenant + all its data (projects, resources, files, members…)
// irreversibly; the admin must retype the slug. User accounts survive (global identity).
function DeleteModal({ t, onClose, onChange }: { t: PlatformTenant; onClose: () => void; onChange: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const [confirmSlug, setConfirmSlug] = useState('');
  const remove = useMutation({
    mutationFn: () => api.del(`/admin/tenants/${t.id}`, { confirmSlug: confirmSlug.trim() }),
    onSuccess: () => { onChange(); toast.success(id ? `“${t.name}” dihapus permanen` : `“${t.name}” permanently deleted`); onClose(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const canSubmit = confirmSlug.trim() === t.slug;
  return (
    <Modal onClose={onClose} title={id ? 'Hapus organisasi permanen' : 'Permanently delete tenant'} size="sm">
      <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) remove.mutate(); }} className="space-y-3">
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {id
            ? <>Ini <strong>menghapus permanen</strong> <strong>{t.name}</strong> beserta SEMUA datanya — proyek, sumber daya, lampiran, pesan, dan {t.memberCount} keanggotaan. Tidak bisa dibatalkan. (Akun pengguna tetap ada.)</>
            : <>This <strong>permanently deletes</strong> <strong>{t.name}</strong> and ALL of its data — projects, resources, attachments, messages and {t.memberCount} membership{t.memberCount === 1 ? '' : 's'}. This cannot be undone. (User accounts are kept.)</>}
        </div>
        <Field label={id ? <>Ketik slug <code className="font-mono">{t.slug}</code> untuk konfirmasi</> : <>Type the slug <code className="font-mono">{t.slug}</code> to confirm</>}>
          <Input value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} placeholder={t.slug} className="font-mono" autoFocus autoComplete="off" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{id ? 'Batal' : 'Cancel'}</Button>
          <Button type="submit" variant="danger" disabled={!canSubmit || remove.isPending}>
            {remove.isPending ? (id ? 'Menghapus…' : 'Deleting…') : (id ? 'Hapus permanen' : 'Delete forever')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Map a fully custom domain (e.g. pm.acmecorp.com) to the tenant. Empty clears it. The tenant's slug
// already gives an <slug>.<base-domain> subdomain; this is the vanity/custom host. (DNS + TLS for the
// host must be pointed at the server separately — see docs.)
function DomainModal({ t, onClose, onChange }: { t: PlatformTenant; onClose: () => void; onChange: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const [domain, setDomain] = useState(t.customDomain ?? '');
  const save = useMutation({
    mutationFn: () => api.patch(`/admin/tenants/${t.id}`, { customDomain: domain.trim().toLowerCase() }),
    onSuccess: () => { onChange(); toast.success(id ? 'Domain diperbarui' : 'Domain updated'); onClose(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const val = domain.trim().toLowerCase();
  const valid = val === '' || /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(val);
  return (
    <Modal onClose={onClose} title={id ? 'Domain kustom' : 'Custom domain'} size="sm">
      <form onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }} className="space-y-3">
        <Field label={id ? 'Domain kustom' : 'Custom domain'} hint={id ? 'Kosongkan untuk menghapus. Arahkan DNS + TLS domain ke server ini secara terpisah.' : 'Leave blank to clear. Point the domain’s DNS + TLS at this server separately.'}>
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="pm.acmecorp.com" className="font-mono" autoFocus />
        </Field>
        {!valid && <p className="text-xs font-medium text-red-500">{id ? 'Masukkan domain yang valid, mis. pm.acmecorp.com' : 'Enter a valid domain, e.g. pm.acmecorp.com'}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{id ? 'Batal' : 'Cancel'}</Button>
          <Button type="submit" disabled={!valid || save.isPending}>{save.isPending ? (id ? 'Menyimpan…' : 'Saving…') : (id ? 'Simpan' : 'Save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// Provision a new CORPORATE tenant + its first admin (attach an existing staff account by email, or
// create one when it doesn't exist yet).
function CreateTenant({ onChange, onDone, bare }: { onChange: () => void; onDone?: () => void; bare?: boolean }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const effSlug = slugTouched ? slug : slugify(name);
  const create = useMutation({
    mutationFn: () => api.post<{ tenant: PlatformTenant }>('/admin/tenants', {
      name: name.trim(), slug: effSlug,
      adminEmail: adminEmail.trim().toLowerCase(),
      ...(adminName.trim() ? { adminName: adminName.trim() } : {}),
      ...(adminPassword ? { adminPassword } : {}),
    }),
    onSuccess: (r) => {
      setName(''); setSlug(''); setSlugTouched(false); setAdminEmail(''); setAdminName(''); setAdminPassword('');
      onChange();
      toast.success(id ? `Organisasi “${r.tenant.name}” dibuat` : `Tenant “${r.tenant.name}” created`);
      onDone?.();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to create tenant'),
  });

  const canSubmit = name.trim().length >= 2 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(effSlug) && /.+@.+\..+/.test(adminEmail.trim());

  const inner = (
    <>
      {bare && <p className="text-sm text-slate-500 dark:text-slate-400">{id ? 'Buat organisasi baru dan admin pertamanya. Jika email sudah punya akun staf, akun itu langsung dijadikan admin; jika belum, isi nama & kata sandi untuk membuatnya.' : 'Create a new organization + its first admin. If the email already has a staff account it becomes the admin; otherwise fill name & password to create it.'}</p>}
      <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (canSubmit) create.mutate(); }}>
        <Field label={id ? 'Nama organisasi' : 'Tenant name'} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={id ? 'Acme Sdn Bhd' : 'Acme Corp'} />
        </Field>
        <Field label="Slug" required hint={id ? 'Kunci mesin unik (huruf kecil, angka, tanda hubung).' : 'Unique machine key (lowercase, digits, hyphens).'}>
          <Input value={effSlug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} placeholder="acme" className="font-mono" />
        </Field>
        <Field label={id ? 'Email admin pertama' : 'First admin email'} required>
          <Input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="owner@acme.com" />
        </Field>
        <Field label={id ? 'Nama admin (untuk akun baru)' : 'Admin name (for a new account)'}>
          <Input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder={id ? 'kosongkan bila akun sudah ada' : 'leave blank if the account exists'} />
        </Field>
        <Field label={id ? 'Kata sandi admin (untuk akun baru)' : 'Admin password (for a new account)'} hint={id ? 'Minimal 10 karakter, huruf + angka.' : 'At least 10 chars, letters + numbers.'}>
          <Input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={!canSubmit || create.isPending} className="w-full sm:w-auto">
            {create.isPending ? (id ? 'Membuat…' : 'Creating…') : (id ? 'Buat organisasi' : 'Create tenant')}
          </Button>
        </div>
      </form>
    </>
  );

  if (bare) return inner;
  return (
    <Card>
      <SectionTitle sub={id ? 'Buat organisasi baru dan admin pertamanya. Jika email sudah punya akun staf, akun itu langsung dijadikan admin; jika belum, isi nama & kata sandi untuk membuatnya.' : 'Create a new organization + its first admin. If the email already has a staff account it becomes the admin; otherwise fill name & password to create it.'}>
        {id ? 'Buat organisasi' : 'Create tenant'}
      </SectionTitle>
      {inner}
    </Card>
  );
}
