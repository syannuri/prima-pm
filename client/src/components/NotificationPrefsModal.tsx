import { useState } from 'react';
import { Modal, Button } from './ui';
import { api } from '../api/client';
import { useToast } from './Toast';
import { useLang } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import type { DigestFrequency, User } from '../api/types';

// Unified notification preferences (opened from the AvatarMenu): the emailed alert-digest cadence +
// per-category email opt-outs. Channels are email-only for now (in-app always shows in the bell /
// Notification Center). PATCH /auth/preferences; patchUser reflects instantly.
interface PrefsResp { digestFrequency: DigestFrequency; notificationPrefs?: User['notificationPrefs'] }

export default function NotificationPrefsModal({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const { user, patchUser } = useAuth();
  const [freq, setFreq] = useState<DigestFrequency>(user?.digestFrequency ?? 'OFF');
  const [approvalEmail, setApprovalEmail] = useState<boolean>(user?.notificationPrefs?.email?.approvals !== false);
  const [busy, setBusy] = useState(false);

  const CADENCE: { key: DigestFrequency; label: string; desc: string; icon: string }[] = [
    { key: 'OFF', label: id ? 'Nonaktif' : 'Off', desc: id ? 'Tidak ada email ringkasan.' : 'No digest emails.', icon: '🔕' },
    { key: 'DAILY', label: id ? 'Harian' : 'Daily', desc: id ? 'Ringkasan setiap pagi bila ada peringatan.' : 'A morning summary when there are alerts.', icon: '📅' },
    { key: 'WEEKLY', label: id ? 'Mingguan' : 'Weekly', desc: id ? 'Ringkasan setiap Senin pagi.' : 'A summary every Monday morning.', icon: '🗓️' },
  ];

  const freqDirty = freq !== (user?.digestFrequency ?? 'OFF');
  const apprDirty = approvalEmail !== (user?.notificationPrefs?.email?.approvals !== false);

  const save = async () => {
    if (busy || (!freqDirty && !apprDirty)) { onClose(); return; }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {};
      if (freqDirty) payload.digestFrequency = freq;
      if (apprDirty) payload.notificationPrefs = { email: { approvals: approvalEmail } };
      const r = await api.patch<PrefsResp>('/auth/preferences', payload);
      patchUser({ digestFrequency: r.digestFrequency, notificationPrefs: r.notificationPrefs ?? { email: { approvals: approvalEmail } } });
      toast.success(id ? 'Preferensi tersimpan.' : 'Preferences saved.');
      onClose();
    } catch {
      toast.error(id ? 'Gagal menyimpan. Coba lagi.' : "Couldn't save — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const Toggle = ({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[1.125rem]' : 'left-0.5'}`} />
    </button>
  );

  return (
    <Modal onClose={onClose} title={id ? 'Preferensi notifikasi' : 'Notification preferences'} size="md">
      <div className="space-y-5">
        {/* Digest cadence */}
        <div className="space-y-2">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{id ? 'Ringkasan peringatan (email)' : 'Alert digest (email)'}</div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {id ? 'Ringkasan peringatan proyekmu (terlambat, jatuh tempo, risiko, anggaran).' : 'A summary of your project alerts (overdue, due-soon, risk, budget).'}
          </p>
          <div className="space-y-2" role="radiogroup" aria-label={id ? 'Frekuensi' : 'Frequency'}>
            {CADENCE.map((o) => (
              <button key={o.key} type="button" role="radio" aria-checked={freq === o.key} onClick={() => setFreq(o.key)}
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                  freq === o.key ? 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-900/30' : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                }`}>
                <span aria-hidden className="text-lg leading-6">{o.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium ${freq === o.key ? 'text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200'}`}>{o.label}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{o.desc}</span>
                </span>
                <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${freq === o.key ? 'border-brand-500 bg-brand-500' : 'border-slate-300 dark:border-slate-600'}`}>
                  {freq === o.key && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Per-category email toggles */}
        <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{id ? 'Email per kategori' : 'Email by category'}</div>
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">{id ? 'Email approval' : 'Approval emails'}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {id ? 'Saat ada yang perlu kamu setujui / permintaanmu diputuskan.' : 'When something needs your approval / your request is decided.'}
              </span>
            </span>
            <Toggle on={approvalEmail} onToggle={() => setApprovalEmail((v) => !v)} label={id ? 'Email approval' : 'Approval emails'} />
          </div>
          <p className="text-xs text-slate-400">{id ? 'Notifikasi in-app tetap muncul di lonceng & Pusat Notifikasi.' : 'In-app notices still appear in the bell & Notification Center.'}</p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{id ? 'Batal' : 'Cancel'}</Button>
          <Button onClick={save} disabled={busy}>{busy ? (id ? 'Menyimpan…' : 'Saving…') : (id ? 'Simpan' : 'Save')}</Button>
        </div>
      </div>
    </Modal>
  );
}
