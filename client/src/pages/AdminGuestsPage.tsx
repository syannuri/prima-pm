import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Badge, Button, Card, EmptyState, Input, SectionTitle, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { formatDate } from '../lib/format';

type Guest = { id: string; name: string; email: string; isActive: boolean; createdAt: string; viaGoogle: boolean };
type Blocked = { id: string; email: string | null; googleSub: string | null; reason: string | null; createdAt: string };

// Self-contained checkbox for the Delete dialog — owns its state and mirrors it to a ref the caller
// reads after confirm() resolves (the confirm message is a static snapshot, so a plain controlled
// input in it wouldn't re-render on toggle).
function BlockToggle({ valueRef, label }: { valueRef: MutableRefObject<boolean>; label: string }) {
  const [on, setOn] = useState(true);
  useEffect(() => { valueRef.current = on; }, [on, valueRef]);
  return (
    <label className="mt-1 flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
      <span>{label}</span>
    </label>
  );
}

// Platform (super-admin) console — manage GUEST / Google accounts. Guests are sandboxed in their own
// personal tenants, so they never show in a tenant's Admin → Users; this cross-tenant view lists them
// and lets an admin deactivate/reactivate or delete them (+ their sandbox). Gated by isPlatformAdmin.
export default function AdminGuestsPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const id = lang === 'id';
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const { data, isLoading } = useQuery({
    queryKey: ['platform-guests'],
    queryFn: () => api.get<{ guests: Guest[] }>('/admin/tenants/guests'),
    enabled: !!user?.isPlatformAdmin,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['platform-guests'] });

  const setActive = useMutation({
    mutationFn: (v: { gid: string; isActive: boolean }) => api.patch(`/admin/tenants/guests/${v.gid}`, { isActive: v.isActive }),
    onSuccess: (_r, v) => { invalidate(); toast.success(v.isActive ? (id ? 'Tamu diaktifkan' : 'Guest reactivated') : (id ? 'Tamu dinonaktifkan' : 'Guest deactivated')); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const remove = useMutation({
    mutationFn: (v: { gid: string; block: boolean }) => api.del(`/admin/tenants/guests/${v.gid}`, { block: v.block }),
    onSuccess: (_r, v) => { invalidate(); qc.invalidateQueries({ queryKey: ['platform-denylist'] }); toast.success(v.block ? (id ? 'Tamu dihapus & diblokir' : 'Guest deleted & blocked') : (id ? 'Tamu dihapus' : 'Guest deleted')); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const blockRef = useRef(true);

  // --- Denylist (blocked identities) ---
  const denylistQ = useQuery({
    queryKey: ['platform-denylist'],
    queryFn: () => api.get<{ entries: Blocked[] }>('/admin/tenants/denylist'),
    enabled: !!user?.isPlatformAdmin,
  });
  const [blockEmail, setBlockEmail] = useState('');
  const addBlock = useMutation({
    mutationFn: (email: string) => api.post('/admin/tenants/denylist', { email, reason: 'Blocked manually' }),
    onSuccess: () => { setBlockEmail(''); qc.invalidateQueries({ queryKey: ['platform-denylist'] }); toast.success(id ? 'Identitas diblokir' : 'Identity blocked'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const unblock = useMutation({
    mutationFn: (bid: string) => api.del(`/admin/tenants/denylist/${bid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-denylist'] }); toast.success(id ? 'Blokir dicabut' : 'Unblocked'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  if (!user?.isPlatformAdmin) {
    return <Card><p className="py-6 text-center text-slate-500 dark:text-slate-400">{id ? 'Butuh hak Platform Admin untuk mengelola tamu.' : 'You need Platform Admin privilege to manage guests.'}</p></Card>;
  }

  const guests = data?.guests ?? [];
  const statusBadge = (g: Guest) => g.isActive
    ? <Badge color="green">{id ? 'Aktif' : 'Active'}</Badge>
    : <Badge color="slate">{id ? 'Nonaktif' : 'Inactive'}</Badge>;
  const confirmDelete = async (g: Guest) => {
    blockRef.current = true; // default ON
    if (await confirm({
      title: id ? 'Hapus tamu?' : 'Delete guest?',
      message: (
        <div className="space-y-2">
          <p>{id
            ? `Hapus ${g.email} beserta sandbox pribadinya secara permanen? Tindakan ini tidak bisa dibatalkan.`
            : `Permanently delete ${g.email} and their personal sandbox? This can't be undone.`}</p>
          <p className="text-xs text-amber-600 dark:text-amber-400">{id
            ? 'Catatan: menghapus saja tidak mencegah mereka mendaftar lagi lewat Google/email.'
            : 'Note: deleting alone does not stop them signing up again via Google/email.'}</p>
          <BlockToggle valueRef={blockRef} label={id
            ? 'Blokir permanen email & akun Google ini agar tidak bisa mendaftar lagi'
            : 'Permanently block this email & Google account from signing up again'} />
        </div>
      ),
      confirmLabel: id ? 'Hapus' : 'Delete', danger: true,
    })) remove.mutate({ gid: g.id, block: blockRef.current });
  };

  return (
    <div className="space-y-5">
      <SectionTitle sub={id ? 'Akun tamu & Google di seluruh sandbox pribadi' : 'Guest & Google accounts across all personal sandboxes'}>
        {id ? 'Tamu (Platform)' : 'Guests (Platform)'}
      </SectionTitle>
      <Card>
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : guests.length === 0 ? (
          <EmptyState title={id ? 'Belum ada tamu' : 'No guest accounts yet'} hint={id ? 'Pendaftaran tamu & login Google akan muncul di sini.' : 'Guest signups and Google logins will appear here.'} />
        ) : (
          <>
            {/* desktop table */}
            <table className="prima-rows hidden w-full text-sm sm:table">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-2">{id ? 'Nama' : 'Name'}</th><th>Email</th><th>Via</th><th>{id ? 'Bergabung' : 'Joined'}</th><th>Status</th><th className="text-right">{id ? 'Aksi' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((g) => (
                  <tr key={g.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 font-medium text-slate-800 dark:text-slate-100">{g.name || '—'}</td>
                    <td className="text-slate-600 dark:text-slate-300">{g.email}</td>
                    <td><Badge color={g.viaGoogle ? 'sky' : 'slate'}>{g.viaGoogle ? 'Google' : 'Email'}</Badge></td>
                    <td className="tabular-nums text-slate-500 dark:text-slate-400">{formatDate(g.createdAt)}</td>
                    <td>{statusBadge(g)}</td>
                    <td className="text-right">
                      <div className="inline-flex gap-2">
                        <Button variant="secondary" disabled={setActive.isPending} onClick={() => setActive.mutate({ gid: g.id, isActive: !g.isActive })}>
                          {g.isActive ? (id ? 'Nonaktifkan' : 'Deactivate') : (id ? 'Aktifkan' : 'Reactivate')}
                        </Button>
                        <Button variant="danger" disabled={remove.isPending} onClick={() => confirmDelete(g)}>{id ? 'Hapus' : 'Delete'}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* mobile cards */}
            <div className="space-y-3 sm:hidden">
              {guests.map((g) => (
                <div key={g.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800 dark:text-slate-100">{g.name || '—'}</div>
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400">{g.email}</div>
                    </div>
                    {statusBadge(g)}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
                    <Badge color={g.viaGoogle ? 'sky' : 'slate'}>{g.viaGoogle ? 'Google' : 'Email'}</Badge>
                    <span className="tabular-nums">{formatDate(g.createdAt)}</span>
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    <Button variant="secondary" className="flex-1" disabled={setActive.isPending} onClick={() => setActive.mutate({ gid: g.id, isActive: !g.isActive })}>
                      {g.isActive ? (id ? 'Nonaktifkan' : 'Deactivate') : (id ? 'Aktifkan' : 'Reactivate')}
                    </Button>
                    <Button variant="danger" disabled={remove.isPending} onClick={() => confirmDelete(g)}>{id ? 'Hapus' : 'Delete'}</Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Denylist — identities barred from self-service sign-up */}
      <SectionTitle sub={id ? 'Email / akun Google yang dilarang mendaftar ulang' : 'Emails / Google accounts barred from signing up again'}>
        {id ? 'Daftar Blokir' : 'Denylist'}
      </SectionTitle>
      <Card>
        <form
          className="mb-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => { e.preventDefault(); if (blockEmail.trim()) addBlock.mutate(blockEmail.trim()); }}
        >
          <Input type="email" placeholder={id ? 'email@contoh.com' : 'email@example.com'} value={blockEmail} onChange={(e) => setBlockEmail(e.target.value)} className="sm:flex-1" />
          <Button type="submit" variant="danger" disabled={addBlock.isPending || !blockEmail.trim()}>{id ? 'Blokir email' : 'Block email'}</Button>
        </form>
        {denylistQ.isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (denylistQ.data?.entries.length ?? 0) === 0 ? (
          <EmptyState title={id ? 'Belum ada yang diblokir' : 'Nothing blocked yet'} hint={id ? 'Blokir email di atas, atau centang "blokir permanen" saat menghapus tamu.' : 'Block an email above, or tick "block permanently" when deleting a guest.'} />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {denylistQ.data!.entries.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800 dark:text-slate-100">{b.email || (id ? '(tanpa email)' : '(no email)')}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                    {b.googleSub && <Badge color="sky">Google</Badge>}
                    {b.reason && <span className="truncate">{b.reason}</span>}
                    <span className="tabular-nums">{formatDate(b.createdAt)}</span>
                  </div>
                </div>
                <Button variant="secondary" disabled={unblock.isPending} onClick={() => unblock.mutate(b.id)}>{id ? 'Cabut' : 'Unblock'}</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
