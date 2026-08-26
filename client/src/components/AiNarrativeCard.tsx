import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { AiSettings } from '../api/types';
import { Card, SectionTitle, Spinner, Toggle } from './ui';
import { useToast } from './Toast';

// Per-tenant opt-in for the AI Status Narrative ("Draft dengan AI" in the Reporting Hub). Tenant-ADMIN
// self-serve, backed by /ai-settings (requireRole ADMIN). `configured` reflects the deployment key
// (ANTHROPIC_API_KEY) — when unset the toggle is disabled with an explanatory note.
export default function AiNarrativeCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: () => api.get<AiSettings>('/ai-settings'),
  });
  const save = useMutation({
    mutationFn: (patch: { enabled?: boolean; actionsEnabled?: boolean; proactiveEnabled?: boolean }) => api.patch<AiSettings>('/ai-settings', patch),
    onSuccess: (s, patch) => {
      qc.setQueryData(['ai-settings'], s);
      if (patch.proactiveEnabled !== undefined) toast.success(s.proactiveEnabled ? 'Draft mingguan otomatis diaktifkan' : 'Draft mingguan otomatis dimatikan');
      else if (patch.actionsEnabled !== undefined) toast.success(s.actionsEnabled ? 'Aksi AI diaktifkan' : 'Aksi AI dimatikan');
      else toast.success(s.enabled ? 'AI Status Narrative diaktifkan' : 'AI Status Narrative dimatikan');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Gagal menyimpan preferensi AI'),
  });

  return (
    <Card>
      <SectionTitle sub="Workspace-wide — draft narasi status laporan dengan Claude. Anda selalu meninjau & menyunting sebelum menyimpan.">AI Status Narrative</SectionTitle>
      {isLoading || !data ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <div className="mt-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">Aktifkan “Draft dengan AI”</div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {data.configured
                  ? 'Metrik proyek (EVM, forecast, tugas) dikirim ke penyedia AI untuk menyusun draft narasi. Tidak ada yang tersimpan otomatis.'
                  : 'Fitur AI belum dikonfigurasi pada deployment ini — hubungi admin platform untuk mengaktifkan.'}
              </p>
            </div>
            <Toggle
              checked={data.enabled}
              onChange={(v) => save.mutate({ enabled: v })}
              disabled={!data.configured || save.isPending}
              label="Aktifkan AI Status Narrative"
            />
          </div>

          {/* Stage C — a SEPARATE, stronger opt-in: lets the AI PROPOSE concrete changes (create risk,
              update progress, draft CR, tidy schedule) that a human must approve before they run. */}
          <div className="mt-4 flex items-start justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <div>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">Izinkan AI mengusulkan aksi (perlu persetujuan)</div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                AI dapat mengusulkan perubahan (buat risiko, update progress, draft CR, rapikan jadwal). Usulan
                <span className="font-medium"> tidak pernah berjalan otomatis</span> — selalu lewat approval dulu.
              </p>
            </div>
            <Toggle
              checked={data.actionsEnabled}
              onChange={(v) => save.mutate({ actionsEnabled: v })}
              disabled={!data.configured || save.isPending}
              label="Izinkan aksi AI"
            />
          </div>

          {/* Proactive AI — a SEPARATE, stronger opt-in still: a weekly sweep auto-drafts a status
              narrative + predictive flags for every active project (unattended AI spend), for the PM
              to review. */}
          <div className="mt-4 flex items-start justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <div>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">Draft status mingguan otomatis (proaktif)</div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Setiap minggu AI menyusun draft narasi status + sinyal prediktif untuk tiap proyek aktif, muncul di
                <span className="font-medium"> Reports</span> untuk ditinjau PM. <span className="font-medium">Tidak pernah terbit otomatis</span>.
              </p>
            </div>
            <Toggle
              checked={data.proactiveEnabled}
              onChange={(v) => save.mutate({ proactiveEnabled: v })}
              disabled={!data.configured || save.isPending}
              label="Draft status mingguan otomatis"
            />
          </div>
        </div>
      )}
    </Card>
  );
}
