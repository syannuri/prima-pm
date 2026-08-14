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
    mutationFn: (enabled: boolean) => api.patch<AiSettings>('/ai-settings', { enabled }),
    onSuccess: (s) => {
      qc.setQueryData(['ai-settings'], s);
      toast.success(s.enabled ? 'AI Status Narrative diaktifkan' : 'AI Status Narrative dimatikan');
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
              onChange={(v) => save.mutate(v)}
              disabled={!data.configured || save.isPending}
              label="Aktifkan AI Status Narrative"
            />
          </div>
        </div>
      )}
    </Card>
  );
}
