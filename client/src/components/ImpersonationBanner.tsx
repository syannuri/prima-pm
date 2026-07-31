import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';

// A loud strip shown while a platform super-admin is acting INSIDE another tenant, so it can never
// be mistaken for the admin's own workspace. "Return" ends impersonation (reverts to their session).
export default function ImpersonationBanner() {
  const { impersonating, stopImpersonating } = useAuth();
  const { lang } = useLang();
  const id = lang === 'id';
  const [leaving, setLeaving] = useState(false);
  if (!impersonating) return null;
  const stop = async () => {
    setLeaving(true);
    try { await stopImpersonating(); } finally { setLeaving(false); }
  };
  return (
    <div className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-center text-sm font-medium text-amber-950">
      <span aria-hidden>👁️</span>
      <span>
        {id ? 'Anda sedang bertindak di dalam' : 'You are acting inside'} <strong>{impersonating.name}</strong> {id ? '(impersonasi platform)' : '(platform impersonation)'}
      </span>
      <button
        onClick={stop}
        disabled={leaving}
        className="rounded-full bg-amber-950/90 px-3 py-0.5 text-xs font-semibold text-amber-50 hover:bg-amber-950 disabled:opacity-60"
      >
        {leaving ? (id ? 'Keluar…' : 'Leaving…') : (id ? 'Kembali ke akun Anda' : 'Return to your account')}
      </button>
    </div>
  );
}
