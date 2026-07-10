import { useEffect, useState } from 'react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

const DISMISS_KEY = 'prima_install_dismissed';

// Slim, dismissible "Add to Home Screen" banner shown above the mobile tab bar.
// - Android/Chromium: a Pasang button that fires the native install sheet.
// - iOS Safari: a one-line hint pointing at Share → Add to Home Screen.
// Hidden once installed, once dismissed, or on desktop.
export default function InstallPrompt() {
  const { canInstall, iosHint, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  // iOS hint is delayed slightly so it doesn't fight the first paint.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1200);
    return () => clearTimeout(t);
  }, []);

  const show = !dismissed && (canInstall || (iosHint && ready));
  if (!show) return null;

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 px-3 md:hidden">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur-xl dark:border-slate-700 dark:bg-slate-800/95">
        <img src="/icon-192.png" alt="" className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Pasang Prismatix</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {canInstall ? 'Akses cepat dari layar utama, seperti app.' : 'Ketuk Bagikan lalu “Add to Home Screen”.'}
          </p>
        </div>
        {canInstall && (
          <button
            onClick={promptInstall}
            className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Pasang
          </button>
        )}
        <button
          onClick={close}
          aria-label="Tutup"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
