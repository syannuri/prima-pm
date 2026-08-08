import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Badge, Button, Card, EmptyState, SectionTitle, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { formatDate } from '../lib/format';

type Guest = { id: string; name: string; email: string; isActive: boolean; createdAt: string; viaGoogle: boolean };

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
    mutationFn: (gid: string) => api.del(`/admin/tenants/guests/${gid}`),
    onSuccess: () => { invalidate(); toast.success(id ? 'Tamu dihapus' : 'Guest deleted'); },
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
    if (await confirm({
      title: id ? 'Hapus tamu?' : 'Delete guest?',
      message: id
        ? `Hapus ${g.email} beserta sandbox pribadinya secara permanen? Tindakan ini tidak bisa dibatalkan.`
        : `Permanently delete ${g.email} and their personal sandbox? This can't be undone.`,
      confirmLabel: id ? 'Hapus' : 'Delete', danger: true,
    })) remove.mutate(g.id);
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
    </div>
  );
}
