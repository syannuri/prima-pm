import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { AiSettings } from '../api/types';
import { Spinner, Toggle } from './ui';
import { SettingsGroup } from './settingsUi';
import { useToast } from './Toast';
import { useLang } from '../context/LanguageContext';

// Bilingual copy — follows the app's language toggle.
const CARD_T = {
  id: {
    sectionSub: 'Workspace-wide — draft narasi status laporan dengan Claude. Anda selalu meninjau & menyunting sebelum menyimpan.',
    narrTitle: 'Aktifkan “Draft dengan AI”', narrOn: 'AI Status Narrative diaktifkan', narrOff: 'AI Status Narrative dimatikan', narrAria: 'Aktifkan AI Status Narrative',
    narrDescOn: 'Metrik proyek (EVM, forecast, tugas) dikirim ke penyedia AI untuk menyusun draft narasi. Tidak ada yang tersimpan otomatis.',
    narrDescOff: 'Fitur AI belum dikonfigurasi pada deployment ini — hubungi admin platform untuk mengaktifkan.',
    actTitle: 'Izinkan AI mengusulkan aksi (perlu persetujuan)', actOn: 'Aksi AI diaktifkan', actOff: 'Aksi AI dimatikan', actAria: 'Izinkan aksi AI',
    actDesc1: 'AI dapat mengusulkan perubahan (buat risiko, update progress, draft CR, rapikan jadwal). Usulan', actDesc2: ' tidak pernah berjalan otomatis', actDesc3: ' — selalu lewat approval dulu.',
    proTitle: 'Draft status mingguan otomatis (proaktif)', proOn: 'Draft mingguan otomatis diaktifkan', proOff: 'Draft mingguan otomatis dimatikan', proAria: 'Draft status mingguan otomatis',
    proDesc1: 'Setiap minggu AI menyusun draft narasi status + sinyal prediktif untuk tiap proyek aktif, muncul di', proDescReports: ' Reports', proDesc2: ' untuk ditinjau PM. ', proDescNever: 'Tidak pernah terbit otomatis', proDesc3: '.',
    memTitle: 'Ingatan Anett (lintas sesi)', memOn: 'Ingatan Anett diaktifkan', memOff: 'Ingatan Anett dimatikan', memAria: 'Aktifkan ingatan Anett',
    memDesc1: 'Anett mengingat preferensi & fakta durable (pribadi + tingkat organisasi) dan', memDescLearn: ' belajar dari feedback 👎', memDesc2: ' Anda, dipakai pada percakapan berikutnya. Kelola daftarnya di kartu “Ingatan Anett” di bawah.',
    voiceTitle: 'Suara natural (server)', voiceOn: 'Suara server diaktifkan', voiceOff: 'Suara server dimatikan', voiceAria: 'Aktifkan suara server',
    voiceDesc: 'Pakai OpenAI Whisper (bicara→teks) + ElevenLabs (jawaban dibacakan) untuk suara natural lintas-browser. Perlu API key di server (berbiaya per-pemakaian); jika belum diset, Anett otomatis pakai suara browser.',
    saveErr: 'Gagal menyimpan preferensi AI',
  },
  en: {
    sectionSub: 'Workspace-wide — draft report status narratives with Claude. You always review & edit before saving.',
    narrTitle: 'Enable “Draft with AI”', narrOn: 'AI Status Narrative enabled', narrOff: 'AI Status Narrative disabled', narrAria: 'Enable AI Status Narrative',
    narrDescOn: 'Project metrics (EVM, forecast, tasks) are sent to the AI provider to draft the narrative. Nothing is saved automatically.',
    narrDescOff: 'AI is not configured on this deployment — contact your platform admin to enable it.',
    actTitle: 'Let AI propose actions (needs approval)', actOn: 'AI actions enabled', actOff: 'AI actions disabled', actAria: 'Allow AI actions',
    actDesc1: 'AI can propose changes (create risk, update progress, draft CR, tidy schedule). Proposals', actDesc2: ' never run automatically', actDesc3: ' — always via approval first.',
    proTitle: 'Automatic weekly status draft (proactive)', proOn: 'Weekly auto-draft enabled', proOff: 'Weekly auto-draft disabled', proAria: 'Automatic weekly status draft',
    proDesc1: 'Each week AI drafts a status narrative + predictive signals for every active project, surfaced in', proDescReports: ' Reports', proDesc2: ' for the PM to review. ', proDescNever: 'Never published automatically', proDesc3: '.',
    memTitle: 'Anett memory (cross-session)', memOn: 'Anett memory enabled', memOff: 'Anett memory disabled', memAria: 'Enable Anett memory',
    memDesc1: 'Anett remembers durable preferences & facts (personal + org-wide) and', memDescLearn: ' learns from your 👎 feedback', memDesc2: ', applied in later conversations. Manage the list in the “Anett memory” card below.',
    voiceTitle: 'Natural voice (server)', voiceOn: 'Server voice enabled', voiceOff: 'Server voice disabled', voiceAria: 'Enable server voice',
    voiceDesc: 'Use OpenAI Whisper (speech→text) + ElevenLabs (spoken answers) for natural, cross-browser voice. Requires API keys on the server (per-use cost); if unset, Anett falls back to the browser voice.',
    saveErr: 'Failed to save AI preferences',
  },
};

// Per-tenant opt-in for the AI Status Narrative ("Draft with AI" in the Reporting Hub). Tenant-ADMIN
// self-serve, backed by /ai-settings (requireRole ADMIN). `configured` reflects the deployment key
// (ANTHROPIC_API_KEY) — when unset the toggle is disabled with an explanatory note.
export default function AiNarrativeCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { lang } = useLang();
  const t = CARD_T[lang];
  const { data, isLoading } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: () => api.get<AiSettings>('/ai-settings'),
  });
  const save = useMutation({
    mutationFn: (patch: { enabled?: boolean; actionsEnabled?: boolean; proactiveEnabled?: boolean; memoryEnabled?: boolean; voiceEnabled?: boolean }) => api.patch<AiSettings>('/ai-settings', patch),
    onSuccess: (s, patch) => {
      qc.setQueryData(['ai-settings'], s);
      if (patch.voiceEnabled !== undefined) toast.success(s.voiceEnabled ? t.voiceOn : t.voiceOff);
      else if (patch.memoryEnabled !== undefined) toast.success(s.memoryEnabled ? t.memOn : t.memOff);
      else if (patch.proactiveEnabled !== undefined) toast.success(s.proactiveEnabled ? t.proOn : t.proOff);
      else if (patch.actionsEnabled !== undefined) toast.success(s.actionsEnabled ? t.actOn : t.actOff);
      else toast.success(s.enabled ? t.narrOn : t.narrOff);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t.saveErr),
  });

  return (
    <SettingsGroup title="AI Status Narrative" sub={t.sectionSub}>
      {isLoading || !data ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <div className="mt-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{t.narrTitle}</div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {data.configured ? t.narrDescOn : t.narrDescOff}
              </p>
            </div>
            <Toggle
              checked={data.enabled}
              onChange={(v) => save.mutate({ enabled: v })}
              disabled={!data.configured || save.isPending}
              label={t.narrAria}
            />
          </div>

          {/* Stage C — a SEPARATE, stronger opt-in: lets the AI PROPOSE concrete changes (create risk,
              update progress, draft CR, tidy schedule) that a human must approve before they run. */}
          <div className="mt-4 flex items-start justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <div>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{t.actTitle}</div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {t.actDesc1}<span className="font-medium">{t.actDesc2}</span>{t.actDesc3}
              </p>
            </div>
            <Toggle
              checked={data.actionsEnabled}
              onChange={(v) => save.mutate({ actionsEnabled: v })}
              disabled={!data.configured || save.isPending}
              label={t.actAria}
            />
          </div>

          {/* Proactive AI — a SEPARATE, stronger opt-in still: a weekly sweep auto-drafts a status
              narrative + predictive flags for every active project (unattended AI spend), for the PM
              to review. */}
          <div className="mt-4 flex items-start justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <div>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{t.proTitle}</div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {t.proDesc1}<span className="font-medium">{t.proDescReports}</span>{t.proDesc2}<span className="font-medium">{t.proDescNever}</span>{t.proDesc3}
              </p>
            </div>
            <Toggle
              checked={data.proactiveEnabled}
              onChange={(v) => save.mutate({ proactiveEnabled: v })}
              disabled={!data.configured || save.isPending}
              label={t.proAria}
            />
          </div>

          {/* Cross-session memory — lets Anett remember durable facts/preferences (per-user) + org-shared
              facts/glossary + corrections from 👎 feedback, injected into its prompt across sessions. */}
          <div className="mt-4 flex items-start justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <div>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{t.memTitle}</div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {t.memDesc1}<span className="font-medium">{t.memDescLearn}</span>{t.memDesc2}
              </p>
            </div>
            <Toggle
              checked={data.memoryEnabled}
              onChange={(v) => save.mutate({ memoryEnabled: v })}
              disabled={!data.configured || save.isPending}
              label={t.memAria}
            />
          </div>

          {/* Server-side voice — OpenAI Whisper (STT) + ElevenLabs (TTS); needs provider keys, falls
              back to the browser Web Speech API when unset. */}
          <div className="mt-4 flex items-start justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <div>
              <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{t.voiceTitle}</div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t.voiceDesc}</p>
            </div>
            <Toggle
              checked={data.voiceEnabled}
              onChange={(v) => save.mutate({ voiceEnabled: v })}
              disabled={!data.configured || save.isPending}
              label={t.voiceAria}
            />
          </div>
        </div>
      )}
    </SettingsGroup>
  );
}
