import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useLang, type Lang } from '../context/LanguageContext';

const TXT: Record<Lang, { verifying: string; okTitle: string; okSub: string; errTitle: string; errSub: string; toLogin: string }> = {
  en: {
    verifying: 'Activating your account…',
    okTitle: 'Account activated',
    okSub: 'Your email is confirmed. You can now sign in to Prismatix.',
    errTitle: "Couldn't activate",
    errSub: 'This activation link is invalid or has expired. Request a new one from the sign-in page.',
    toLogin: 'Go to sign in',
  },
  id: {
    verifying: 'Mengaktifkan akun Anda…',
    okTitle: 'Akun aktif',
    okSub: 'Email Anda terkonfirmasi. Sekarang Anda bisa masuk ke Prismatix.',
    errTitle: 'Gagal mengaktifkan',
    errSub: 'Tautan aktivasi ini tidak valid atau sudah kedaluwarsa. Minta yang baru dari halaman masuk.',
    toLogin: 'Ke halaman masuk',
  },
};

// Landing for the activation link emailed to a new user (/verify-email?token=…). Redeems the token via
// the public POST /auth/verify-email, then confirms success / failure with a link back to sign-in.
export default function VerifyEmailPage() {
  const { lang } = useLang();
  const tx = TXT[lang];
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'verifying' | 'ok' | 'error'>('verifying');
  // StrictMode double-invokes effects in dev; a single-use token would then 400 on the second call and
  // flip a successful verify to error. Guard so we redeem exactly once.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) { setState('error'); return; }
    api.post('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((err) => setState(err instanceof ApiError ? 'error' : 'error'));
  }, [token]);

  const isError = state === 'error';
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-6 py-10 text-slate-800 dark:bg-slate-950 dark:text-slate-200">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        {state === 'verifying' ? (
          <>
            <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500" />
            <p className="text-sm text-slate-500 dark:text-slate-400">{tx.verifying}</p>
          </>
        ) : (
          <>
            <div className={`mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl ring-1 ${isError ? 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-900/30 dark:ring-red-800' : 'bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-900/30 dark:ring-emerald-800'}`}>
              {isError ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="h-7 w-7"><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="m9 9 6 6M15 9l-6 6" /></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="h-7 w-7"><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="m8 12 2.5 2.5L16 9" /></svg>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">{isError ? tx.errTitle : tx.okTitle}</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{isError ? tx.errSub : tx.okSub}</p>
            <Link to="/login" className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 py-2.5 font-medium text-white shadow-lg shadow-brand-500/30 transition hover:from-brand-600 hover:to-brand-700">{tx.toLogin}</Link>
          </>
        )}
      </div>
    </div>
  );
}
