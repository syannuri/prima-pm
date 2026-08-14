import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { PlatformTenant } from '../api/types';
import { Badge, Button, Card, Field, Input, Modal, SectionTitle, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { formatDate } from '../lib/format';
import { tenantStats, type Plan } from '../lib/tenantStats';

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

  return (
    <div className="space-y-5">
      <ConsoleHero id={id} onProvision={() => setCreating(true)} />

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <>
          {/* Headline metrics — derived client-side from the tenant list. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label={id ? 'Organisasi' : 'Tenants'} value={stats.total} tone="indigo" />
            <Kpi label={id ? 'Aktif' : 'Active'} value={stats.active} tone="emerald" />
            <Kpi label={id ? 'Menunggu' : 'Pending'} value={stats.pending} tone="amber" pulse={stats.pending > 0} />
            <Kpi label={id ? 'Ditangguhkan' : 'Suspended'} value={stats.suspended} tone="red" />
            <Kpi label={id ? 'Anggota' : 'Members'} value={stats.members} tone="slate" hint={stats.personal > 0 ? `+${stats.personal} ${id ? 'sandbox' : 'sandbox'}` : undefined} />
          </div>

          <PlanBar split={stats.planSplit} total={stats.total} id={id} />

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

// ── Platform-console presentational pieces ─────────────────────────────────────────────────────

// Indigo→fuchsia "Control Plane" hero — the visual anchor that sets the platform console apart
// from every tenant-scoped page.
function ConsoleHero({ id, onProvision }: { id: boolean; onProvision: () => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-violet-300/40 bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 p-5 text-white shadow-lg dark:border-violet-500/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70">
            <span aria-hidden>◆</span> {id ? 'Konsol Platform' : 'Platform Console'}
          </div>
          <h1 className="mt-1 text-xl font-bold">{id ? 'Organisasi' : 'Organizations'}</h1>
          <p className="mt-0.5 text-sm text-white/85">
            {id ? 'Provisi, tangguhkan, dan kelola setiap organisasi lintas platform.' : 'Provision, suspend and manage every organization across the platform.'}
          </p>
        </div>
        <button
          onClick={onProvision}
          className="shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm transition hover:bg-white/90"
        >
          + {id ? 'Buat organisasi' : 'Provision tenant'}
        </button>
      </div>
    </div>
  );
}

const KPI_TONE: Record<string, string> = {
  indigo: 'text-indigo-600 dark:text-indigo-300',
  emerald: 'text-emerald-600 dark:text-emerald-300',
  amber: 'text-amber-600 dark:text-amber-300',
  red: 'text-red-600 dark:text-red-300',
  slate: 'text-slate-700 dark:text-slate-200',
};

function Kpi({ label, value, tone, hint, pulse }: { label: string; value: number; tone: keyof typeof KPI_TONE; hint?: string; pulse?: boolean }) {
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      {pulse && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_0_3px_theme(colors.amber.400/0.2)] motion-safe:animate-pulse" />}
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${KPI_TONE[tone]}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</div>}
    </div>
  );
}

function PlanBar({ split, total, id }: { split: Record<Plan, number>; total: number; id: boolean }) {
  const seg: { k: Plan; n: number; c: string }[] = [
    { k: 'FREE', n: split.FREE, c: 'bg-slate-400' },
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

// The tenant registry with a search box + status-filter chips. Table on sm+, cards on phones.
function TenantTable({ corporate, personal, onChange, id }: { corporate: PlatformTenant[]; personal: number; onChange: () => void; id: boolean }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const filterLabel: Record<StatusFilter, string> = {
    ALL: id ? 'Semua' : 'All', ACTIVE: id ? 'Aktif' : 'Active', PENDING: id ? 'Menunggu' : 'Pending',
    SUSPENDED: id ? 'Ditangguhkan' : 'Suspended', REJECTED: id ? 'Ditolak' : 'Rejected',
  };
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return corporate.filter((t) => {
      if (filter !== 'ALL' && t.status !== filter) return false;
      if (!needle) return true;
      return t.name.toLowerCase().includes(needle) || t.slug.toLowerCase().includes(needle) || (t.customDomain ?? '').toLowerCase().includes(needle);
    });
  }, [corporate, q, filter]);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={id ? 'Cari nama / slug / domain…' : 'Search name / slug / domain…'} />
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${filter === f ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}
            >
              {filterLabel[f]}
            </button>
          ))}
        </div>
      </div>

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
                  <th className="py-2">{id ? 'Nama' : 'Name'}</th><th>Slug</th><th>{id ? 'Status' : 'Status'}</th><th>{id ? 'Paket' : 'Plan'}</th><th className="text-right">{id ? 'Anggota' : 'Members'}</th><th>{id ? 'Dibuat' : 'Created'}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => <TenantRow key={t.id} t={t} onChange={onChange} />)}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 sm:hidden">
            {rows.map((t) => <TenantCard key={t.id} t={t} onChange={onChange} />)}
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
  return { patch, review, approve, reject, toggleSuspend, enter, entering, exportData, exporting, setPlan };
}

const PLANS: PlatformTenant['plan'][] = ['FREE', 'PRO', 'ENTERPRISE'];

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

function TenantRow({ t, onChange }: { t: PlatformTenant; onChange: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [domainOpen, setDomainOpen] = useState(false);
  const { patch, review, approve, reject, toggleSuspend, enter, entering, exportData, exporting, setPlan } = useTenantActions(t, onChange);
  const pending = t.status === 'PENDING';
  return (
    <tr className={`border-b last:border-0 dark:border-slate-800 ${pending ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}`}>
      <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{t.name}</td>
      <td className="font-mono text-xs text-slate-500 dark:text-slate-400">
        {t.slug}
        {t.customDomain && <span className="block text-[11px] text-indigo-500 dark:text-indigo-400">🔗 {t.customDomain}</span>}
      </td>
      <td><StatusBadge status={t.status} /></td>
      <td><PlanSelect t={t} onPlan={setPlan} disabled={patch.isPending} /></td>
      <td className="text-right text-slate-500 dark:text-slate-400">{t.memberCount}</td>
      <td className="text-slate-500 dark:text-slate-400">{formatDate(t.createdAt)}</td>
      <td className="text-right whitespace-nowrap">
        {pending && (
          <>
            <Button variant="ghost" onClick={approve} disabled={review.isPending} className="text-green-600 dark:text-green-400">{id ? 'Setujui' : 'Approve'}</Button>
            <Button variant="ghost" onClick={reject} disabled={review.isPending} className="text-red-600 dark:text-red-400">{id ? 'Tolak' : 'Reject'}</Button>
          </>
        )}
        <Button variant="ghost" onClick={enter} disabled={entering} title={id ? 'Masuk sebagai admin organisasi ini' : 'Act as an admin inside this tenant'}>{entering ? '…' : (id ? 'Masuk' : 'Enter')}</Button>
        <Button variant="ghost" onClick={() => setRenaming(true)} disabled={patch.isPending}>{id ? 'Ubah nama' : 'Rename'}</Button>
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
    </tr>
  );
}

function TenantCard({ t, onChange }: { t: PlatformTenant; onChange: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [domainOpen, setDomainOpen] = useState(false);
  const { patch, review, approve, reject, toggleSuspend, enter, entering, exportData, exporting, setPlan } = useTenantActions(t, onChange);
  const pending = t.status === 'PENDING';
  return (
    <div className={`rounded-xl border p-3 dark:border-slate-800 ${pending ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-700 dark:text-slate-200">{t.name}</p>
          <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">{t.slug} · {t.memberCount} {id ? 'anggota' : 'members'}</p>
          {t.customDomain && <p className="truncate font-mono text-[11px] text-indigo-500 dark:text-indigo-400">🔗 {t.customDomain}</p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={t.status} />
          <PlanSelect t={t} onPlan={setPlan} disabled={patch.isPending} />
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
        <Button variant="ghost" onClick={() => setRenaming(true)} disabled={patch.isPending}>{id ? 'Ubah nama' : 'Rename'}</Button>
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

function RenameModal({ t, onClose, onChange }: { t: PlatformTenant; onClose: () => void; onChange: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const [name, setName] = useState(t.name);
  const rename = useMutation({
    mutationFn: () => api.patch(`/admin/tenants/${t.id}`, { name: name.trim() }),
    onSuccess: () => { onChange(); toast.success(id ? 'Nama diperbarui' : 'Name updated'); onClose(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const canSubmit = name.trim().length >= 2 && name.trim() !== t.name;
  return (
    <Modal onClose={onClose} title={id ? 'Ubah nama organisasi' : 'Rename tenant'} size="sm">
      <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) rename.mutate(); }} className="space-y-3">
        <Field label={id ? 'Nama' : 'Name'}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{id ? 'Batal' : 'Cancel'}</Button>
          <Button type="submit" disabled={!canSubmit || rename.isPending}>{rename.isPending ? (id ? 'Menyimpan…' : 'Saving…') : (id ? 'Simpan' : 'Save')}</Button>
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
