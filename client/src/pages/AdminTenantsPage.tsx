import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { PlatformTenant } from '../api/types';
import { Badge, Button, Card, Field, Input, Modal, SectionTitle, Spinner } from '../components/ui';
import PlatformSettings from '../components/PlatformSettings';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { formatDate } from '../lib/format';

// Platform (super-admin) console — provision & manage TENANTS (organizations). Gated by the global
// User.isPlatformAdmin flag; backed by the /admin/tenants API. Distinct from per-tenant admin.
export default function AdminTenantsPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const id = lang === 'id';
  const qc = useQueryClient();

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
  const personalCount = tenants.length - corporate.length;

  return (
    <div className="space-y-5">
      <SectionTitle sub={id ? 'Buat, tangguhkan, dan kelola organisasi di seluruh platform' : 'Provision, suspend and manage organizations across the platform'}>
        {id ? 'Organisasi (Platform)' : 'Tenants (Platform)'}
      </SectionTitle>

      <CreateTenant onChange={invalidate} />

      <Card>
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : !corporate.length ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{id ? 'Belum ada organisasi korporat. Buat yang pertama di atas.' : 'No corporate tenants yet — create the first one above.'}</p>
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
                  {corporate.map((t) => <TenantRow key={t.id} t={t} onChange={invalidate} />)}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 sm:hidden">
              {corporate.map((t) => <TenantCard key={t.id} t={t} onChange={invalidate} />)}
            </div>
          </>
        )}
        {personalCount > 0 && (
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
            {id ? `+ ${personalCount} sandbox pribadi tamu (tidak dikelola di sini).` : `+ ${personalCount} personal guest sandbox${personalCount === 1 ? '' : 'es'} (not managed here).`}
          </p>
        )}
      </Card>

      <PlatformSettings />
    </div>
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
function CreateTenant({ onChange }: { onChange: () => void }) {
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
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to create tenant'),
  });

  const canSubmit = name.trim().length >= 2 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(effSlug) && /.+@.+\..+/.test(adminEmail.trim());

  return (
    <Card>
      <SectionTitle sub={id ? 'Buat organisasi baru dan admin pertamanya. Jika email sudah punya akun staf, akun itu langsung dijadikan admin; jika belum, isi nama & kata sandi untuk membuatnya.' : 'Create a new organization + its first admin. If the email already has a staff account it becomes the admin; otherwise fill name & password to create it.'}>
        {id ? 'Buat organisasi' : 'Create tenant'}
      </SectionTitle>
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
    </Card>
  );
}
