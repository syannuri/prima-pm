import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Button, Field, Input } from './ui';
import { SettingsGroup } from './settingsUi';
import { useToast } from './Toast';
import { useLang } from '../context/LanguageContext';
import { appBaseDomain, workspaceHostname, workspaceUrl } from '../lib/workspaceHost';

type WS = { id: string; name: string; slug: string; customDomain: string | null; plan: string; isPersonal: boolean };
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Tenant-ADMIN self-service: view and change the workspace's subdomain (<slug>.<base>). A new org
// auto-gets a subdomain from its name at signup; this lets them change it later.
export default function WorkspaceAddressCard() {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['workspace'], queryFn: () => api.get<{ tenant: WS }>('/workspace') });
  const t = data?.tenant;
  const base = appBaseDomain();
  const [slug, setSlug] = useState('');
  useEffect(() => { if (t?.slug) setSlug(t.slug); }, [t?.slug]);
  const save = useMutation({
    mutationFn: () => api.patch<{ tenant: WS }>('/workspace', { slug: slug.trim().toLowerCase() }),
    onSuccess: (r) => { qc.setQueryData(['workspace'], { tenant: { ...(t as WS), ...r.tenant } }); toast.success(id ? 'Alamat workspace diperbarui' : 'Workspace address updated'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  if (!t || t.isPersonal) return null;

  const norm = slug.trim().toLowerCase();
  const shapeOk = norm.length >= 2 && norm.length <= 40 && SLUG_RE.test(norm);
  const changed = norm !== t.slug;
  const url = workspaceUrl(t.slug);

  return (
    <SettingsGroup title={id ? 'Alamat workspace' : 'Workspace address'} sub={id ? 'Alamat tempat tim Anda masuk.' : 'Where your team signs in.'}>
      {url && (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {id ? 'Saat ini' : 'Current'}: <a href={url} target="_blank" rel="noreferrer" className="font-mono font-medium text-brand-600 hover:underline dark:text-brand-400">{workspaceHostname(t.slug)}</a>
        </p>
      )}
      {base ? (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (shapeOk && changed && !save.isPending) save.mutate(); }}>
          <Field label={id ? 'Subdomain' : 'Subdomain'}>
            <div className="flex items-center gap-1.5">
              <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} className="font-mono" autoComplete="off" />
              <span className="shrink-0 font-mono text-sm text-slate-400 dark:text-slate-500">.{base}</span>
            </div>
          </Field>
          {norm && !shapeOk && <p className="text-xs font-medium text-red-500">{id ? '2–40 karakter: huruf kecil, angka, tanda hubung.' : '2–40 chars: lowercase letters, digits, single hyphens.'}</p>}
          {changed && shapeOk && <p className="text-xs text-amber-600 dark:text-amber-400">{id ? '⚠ Mengubah ini menonaktifkan alamat lama — semua harus memakai yang baru.' : '⚠ Changing this breaks the old address — everyone must use the new one.'}</p>}
          <Button type="submit" disabled={!shapeOk || !changed || save.isPending}>{save.isPending ? (id ? 'Menyimpan…' : 'Saving…') : (id ? 'Simpan' : 'Save')}</Button>
        </form>
      ) : (
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">{id ? 'Routing subdomain tidak dikonfigurasi pada deployment ini.' : "Subdomain routing isn't configured on this deployment."}</p>
      )}
    </SettingsGroup>
  );
}
