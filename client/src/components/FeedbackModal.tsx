import { useState } from 'react';
import { Modal, Button, Field, Textarea } from './ui';
import { api } from '../api/client';
import { useToast } from './Toast';
import { useLang } from '../context/LanguageContext';

// Lightweight in-app feedback. Type + message; the page URL / role / release / user-agent are
// attached automatically server-side so a one-line report is actionable. Any signed-in user
// (incl. sandbox guests) can send. Opened from the AvatarMenu.
type FbType = 'BUG' | 'IDEA' | 'OTHER';

export default function FeedbackModal({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const [type, setType] = useState<FbType>('IDEA');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const TYPES: { key: FbType; label: string; icon: string }[] = [
    { key: 'BUG', label: id ? 'Bug' : 'Bug', icon: '🐞' },
    { key: 'IDEA', label: id ? 'Ide' : 'Idea', icon: '💡' },
    { key: 'OTHER', label: id ? 'Lainnya' : 'Other', icon: '💬' },
  ];

  const submit = async () => {
    const msg = message.trim();
    if (msg.length < 3 || busy) return;
    setBusy(true);
    try {
      await api.post('/feedback', {
        type,
        message: msg,
        pageUrl: window.location.pathname + window.location.search,
        release: import.meta.env.VITE_RELEASE || undefined,
      });
      toast.success(id ? 'Terima kasih atas masukannya!' : 'Thanks for the feedback!');
      onClose();
    } catch {
      toast.error(id ? 'Gagal mengirim. Coba lagi.' : "Couldn't send — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={id ? 'Kirim masukan' : 'Send feedback'} size="md">
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {id
            ? 'Temukan bug atau punya ide? Beri tahu kami — halaman & konteks ikut terkirim otomatis.'
            : 'Found a bug or have an idea? Tell us — your current page & context are attached automatically.'}
        </p>
        <div className="flex gap-2">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setType(t.key)}
              aria-pressed={type === t.key}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                type === t.key
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-900/30 dark:text-brand-300'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <span aria-hidden>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
        <Field label={id ? 'Pesan' : 'Message'}>
          <Textarea
            rows={5}
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={4000}
            placeholder={id ? 'Ceritakan sedetail mungkin…' : 'Describe it in as much detail as you can…'}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{id ? 'Batal' : 'Cancel'}</Button>
          <Button onClick={submit} disabled={busy || message.trim().length < 3}>
            {busy ? (id ? 'Mengirim…' : 'Sending…') : (id ? 'Kirim' : 'Send')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
