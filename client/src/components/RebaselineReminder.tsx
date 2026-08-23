import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { canGovernProject } from '../lib/perms';

// Cost-tab reminder shown when the baseline is UNLOCKED but was locked before (≥1 baseline version) —
// the state you land in after an approved CR opens the baseline. Nudges the owning PM / ADMIN / PMO to
// re-baseline & re-lock once the change is applied, so EVM/variance don't silently drift.
export default function RebaselineReminder({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { lang } = useLang();
  const id = lang === 'id';
  const { data } = useQuery({ queryKey: ['project', projectId], queryFn: () => api.get<{ project: Project }>(`/projects/${projectId}`) });
  const versionsQ = useQuery({ queryKey: ['baseline-versions', projectId], queryFn: () => api.get<{ versions: unknown[] }>(`/projects/${projectId}/baseline/versions`) });

  const locked = !!data?.project?.baselineLockedAt;
  const hasHistory = (versionsQ.data?.versions?.length ?? 0) > 0;
  const canManage = !!data?.project && canGovernProject(user, data.project, ['ADMIN', 'PMO', 'PROJECT_MANAGER']);
  if (locked || !hasHistory || !canManage) return null;

  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
      <span aria-hidden>🔓</span>
      <p>
        {id
          ? <>Baseline sedang <strong>terbuka</strong>. Setelah menerapkan perubahan (mis. dari CR yang disetujui), lakukan <strong>re-baseline lalu kunci ulang</strong> di sini agar EVM &amp; variansi kembali terukur.</>
          : <>The baseline is <strong>open</strong>. After applying your change (e.g. from an approved CR), <strong>re-baseline and lock it</strong> here so EVM &amp; variance stay meaningful.</>}
      </p>
    </div>
  );
}
