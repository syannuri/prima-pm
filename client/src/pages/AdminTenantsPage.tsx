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
                    <th className="py-2">{id ? 'Nama' : 'Name'}</th><th>Slug</th><th>{id ? 'Status' : 'Status'}</th><th className="text-right">{id ? 'Anggota' : 'Members'}</th><th>{id ? 'Dibuat' : 'Created'}</th><th></th>
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
    mutationFn: (body: { status?: 'ACTIVE' | 'SUSPENDED'; name?: string }) => api.patch(`/admin/tenants/${t.id}`, body),
    onSuccess: () => { onChange(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
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
  return { patch, toggleSuspend, enter, entering };
}

function StatusBadge({ status }: { status: PlatformTenant['status'] }) {
  const { lang } = useLang();
  const id = lang === 'id';
  return status === 'ACTIVE'
    ? <Badge color="green">{id ? 'Aktif' : 'Active'}</Badge>
    : <Badge color="red">{id ? 'Ditangguhkan' : 'Suspended'}</Badge>;
}

function TenantRow({ t, onChange }: { t: PlatformTenant; onChange: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const [renaming, setRenaming] = useState(false);
  const { patch, toggleSuspend, enter, entering } = useTenantActions(t, onChange);
  return (
    <tr className="border-b last:border-0 dark:border-slate-800">
      <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{t.name}</td>
      <td className="font-mono text-xs text-slate-500 dark:text-slate-400">{t.slug}</td>
      <td><StatusBadge status={t.status} /></td>
      <td className="text-right text-slate-500 dark:text-slate-400">{t.memberCount}</td>
      <td className="text-slate-500 dark:text-slate-400">{formatDate(t.createdAt)}</td>
      <td className="text-right whitespace-nowrap">
        <Button variant="ghost" onClick={enter} disabled={entering} title={id ? 'Masuk sebagai admin organisasi ini' : 'Act as an admin inside this tenant'}>{entering ? '…' : (id ? 'Masuk' : 'Enter')}</Button>
        <Button variant="ghost" onClick={() => setRenaming(true)} disabled={patch.isPending}>{id ? 'Ubah nama' : 'Rename'}</Button>
        <Button variant="ghost" onClick={toggleSuspend} disabled={patch.isPending} className={t.status === 'ACTIVE' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
          {t.status === 'ACTIVE' ? (id ? 'Tangguhkan' : 'Suspend') : (id ? 'Aktifkan' : 'Reactivate')}
        </Button>
      </td>
      {renaming && <RenameModal t={t} onClose={() => setRenaming(false)} onChange={onChange} />}
    </tr>
  );
}

function TenantCard({ t, onChange }: { t: PlatformTenant; onChange: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const [renaming, setRenaming] = useState(false);
  const { patch, toggleSuspend, enter, entering } = useTenantActions(t, onChange);
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-700 dark:text-slate-200">{t.name}</p>
          <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">{t.slug} · {t.memberCount} {id ? 'anggota' : 'members'}</p>
        </div>
        <StatusBadge status={t.status} />
      </div>
      <div className="mt-2 flex flex-wrap justify-end gap-1 border-t border-slate-100 pt-2 dark:border-slate-800">
        <Button variant="ghost" onClick={enter} disabled={entering}>{entering ? '…' : (id ? 'Masuk' : 'Enter')}</Button>
        <Button variant="ghost" onClick={() => setRenaming(true)} disabled={patch.isPending}>{id ? 'Ubah nama' : 'Rename'}</Button>
        <Button variant="ghost" onClick={toggleSuspend} disabled={patch.isPending} className={t.status === 'ACTIVE' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
          {t.status === 'ACTIVE' ? (id ? 'Tangguhkan' : 'Suspend') : (id ? 'Aktifkan' : 'Reactivate')}
        </Button>
      </div>
      {renaming && <RenameModal t={t} onClose={() => setRenaming(false)} onChange={onChange} />}
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
