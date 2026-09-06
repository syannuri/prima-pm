import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang, type Lang } from '../context/LanguageContext';

// A lightweight cookie notice. PRISMATIX uses only strictly-necessary cookies (session + CSRF), so this
// is an ACKNOWLEDGEMENT, not a consent gate — we don't set optional/tracking cookies to withhold. It
// shows once until the reader dismisses it, remembered in localStorage (no cookie, no backend call).
const STORAGE_KEY = 'prismatix.cookieNotice.v1';

const TXT: Record<Lang, { body: string; learn: string; accept: string }> = {
  en: {
    body: 'We use only essential cookies to keep you signed in and secure your session.',
    learn: 'Learn more',
    accept: 'Got it',
  },
  id: {
    body: 'Kami hanya memakai cookie esensial agar Anda tetap masuk dan sesi Anda aman.',
    learn: 'Selengkapnya',
    accept: 'Mengerti',
  },
};

export default function CookieConsent() {
  const { lang } = useLang();
  const tx = TXT[lang];
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
    } catch {
      // localStorage unavailable (private mode / blocked) — just don't show the notice.
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* ignore */ }
    setShow(false);
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-[60] sm:inset-x-auto sm:right-4 sm:max-w-md" role="dialog" aria-label="Cookie notice">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:flex-row sm:items-center">
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {tx.body}{' '}
          <Link to="/legal/cookies" className="font-medium text-brand-600 hover:underline dark:text-brand-400">{tx.learn}</Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          {tx.accept}
        </button>
      </div>
    </div>
  );
}
