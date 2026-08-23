import { useState } from 'react';
import { Modal, Button } from './ui';
import { api } from '../api/client';
import { useToast } from './Toast';
import { useLang } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import type { DigestFrequency } from '../api/types';

// Self-service opt-in for the emailed alert digest (overdue / due-soon / risk / budget rollup across
// the user's projects). PATCH /auth/preferences updates only the caller's row. Opened from the
// AvatarMenu; hidden for sandbox guests (they never receive a digest).
export default function DigestSettingsModal({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const { user, patchUser } = useAuth();
  const [freq, setFreq] = useState<DigestFrequency>(user?.digestFrequency ?? 'OFF');
  const [busy, setBusy] = useState(false);

  const OPTIONS: { key: DigestFrequency; label: string; desc: string; icon: string }[] = [
    { key: 'OFF', label: id ? 'Nonaktif' : 'Off', desc: id ? 'Tidak ada email ringkasan.' : 'No digest emails.', icon: '🔕' },
    { key: 'DAILY', label: id ? 'Harian' : 'Daily', desc: id ? 'Ringkasan setiap pagi bila ada peringatan.' : 'A morning summary whenever there are alerts.', icon: '📅' },
    { key: 'WEEKLY', label: id ? 'Mingguan' : 'Weekly', desc: id ? 'Ringkasan setiap Senin pagi.' : 'A summary every Monday morning.', icon: '🗓️' },
  ];

  const save = async () => {
    if (busy || freq === (user?.digestFrequency ?? 'OFF')) { onClose(); return; }
    setBusy(true);
    try {
      const r = await api.patch<{ digestFrequency: DigestFrequency }>('/auth/preferences', { digestFrequency: freq });
      patchUser({ digestFrequency: r.digestFrequency });
      toast.success(id ? 'Preferensi tersimpan.' : 'Preference saved.');
      onClose();
    } catch {
      toast.error(id ? 'Gagal menyimpan. Coba lagi.' : "Couldn't save — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={id ? 'Notifikasi email' : 'Email notifications'} size="md">
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {id
            ? 'Dapatkan ringkasan peringatan proyekmu (terlambat, jatuh tempo, risiko, anggaran) langsung ke email.'
            : 'Get a summary of your project alerts (overdue, due-soon, risk, budget) delivered to your inbox.'}
        </p>
        <div className="space-y-2" role="radiogroup" aria-label={id ? 'Frekuensi' : 'Frequency'}>
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={freq === o.key}
              onClick={() => setFreq(o.key)}
              className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                freq === o.key
                  ? 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-900/30'
                  : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
              }`}
            >
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
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{id ? 'Batal' : 'Cancel'}</Button>
          <Button onClick={save} disabled={busy}>{busy ? (id ? 'Menyimpan…' : 'Saving…') : (id ? 'Simpan' : 'Save')}</Button>
        </div>
      </div>
    </Modal>
  );
}
