import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { Button } from './ui';
import { SettingsGroup } from './settingsUi';
import { useToast } from './Toast';
import { useLang } from '../context/LanguageContext';

// Personal iCal calendar feed (T4.2). The user reveals their subscribe URL on demand (the GET also
// creates the token the first time), can copy it, and can rotate it if it leaks.
export default function CalendarFeedCard() {
  const toast = useToast();
  const { lang } = useLang();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (rotate = false) => {
    setBusy(true);
    try {
      const res = rotate
        ? await api.post<{ url: string }>('/calendar/feed/rotate')
        : await api.get<{ url: string }>('/calendar/feed');
      setUrl(res.url);
      if (rotate) toast.success(lang === 'id' ? 'URL umpan diputar ulang — perbarui langganan kalender Anda' : 'Feed URL rotated — update your calendar subscription');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : (lang === 'id' ? 'Tidak dapat memuat umpan kalender' : 'Could not load the calendar feed'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast.success(lang === 'id' ? 'Disalin ke papan klip' : 'Copied to clipboard'); }
    catch { toast.error(lang === 'id' ? 'Tidak dapat menyalin — pilih dan salin manual' : 'Could not copy — select and copy manually'); }
  };

  return (
    <SettingsGroup
      title={lang === 'id' ? 'Umpan Kalender' : 'Calendar feed'}
      sub={lang === 'id'
        ? 'Berlangganan tonggak proyek dan tanggal tugas Anda di Google, Outlook, atau Apple Calendar. Siapa pun yang memiliki URL bisa melihatnya — putar ulang jika bocor.'
        : 'Subscribe to your projects’ milestones and task dates in Google, Outlook or Apple Calendar. Anyone with the URL can view it — rotate it if it leaks.'}
    >
      {!url ? (
        <div className="mt-3">
          <Button type="button" onClick={() => load(false)} disabled={busy}>{busy ? (lang === 'id' ? 'Memuat…' : 'Loading…') : (lang === 'id' ? 'Tampilkan URL kalender saya' : 'Show my calendar URL')}</Button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">{url}</code>
            <Button type="button" onClick={copy}>{lang === 'id' ? 'Salin' : 'Copy'}</Button>
          </div>
          <button onClick={() => load(true)} disabled={busy} className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200">
            {lang === 'id' ? 'Putar ulang URL' : 'Rotate URL'}
          </button>
        </div>
      )}
    </SettingsGroup>
  );
}
