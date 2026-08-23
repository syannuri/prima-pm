import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Button, Field, Input } from '../components/ui';
import { useLang, type Lang } from '../context/LanguageContext';

const TXT: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Forgot your password?',
    sub: 'Enter your account email and we\'ll send you a link to set a new password.',
    email: 'Email',
    send: 'Send reset link',
    sending: 'Sending…',
    sentTitle: 'Check your email',
    // Anti-enumeration: the confirmation never reveals whether the address has an account.
    sentSub: 'If an account exists for that email, we\'ve sent a link to reset your password. The link is valid for 30 minutes.',
    back: 'Back to sign in',
  },
  id: {
    title: 'Lupa kata sandi?',
    sub: 'Masukkan email akun Anda dan kami kirimkan tautan untuk membuat kata sandi baru.',
    email: 'Email',
    send: 'Kirim tautan reset',
    sending: 'Mengirim…',
    sentTitle: 'Cek email Anda',
    sentSub: 'Jika akun dengan email itu ada, kami sudah mengirim tautan untuk mereset kata sandi. Tautan berlaku 30 menit.',
    back: 'Kembali ke halaman masuk',
  },
};

// Request a password-reset link. Always shows the same "check your email" confirmation regardless of
// whether the address has an account (anti-enumeration; the server also throttles + is captcha-gated
// when configured). Reached from the login page's "Forgot password?" link.
export default function ForgotPasswordPage() {
  const { lang } = useLang();
  const tx = TXT[lang];
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (busy || !email.trim()) return;
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
    } catch {
      /* Deliberately swallow — never signal success/failure differently (anti-enumeration). */
    } finally {
      setBusy(false);
      setSent(true); // same outcome regardless
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {sent ? (
          <>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{tx.sentTitle}</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{tx.sentSub}</p>
            <Link to="/login" className="mt-6 inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">← {tx.back}</Link>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{tx.title}</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{tx.sub}</p>
            <form className="mt-5 space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <Field label={tx.email}>
                <Input type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              </Field>
              <Button type="submit" className="w-full" disabled={busy || !email.trim()}>{busy ? tx.sending : tx.send}</Button>
            </form>
            <Link to="/login" className="mt-5 inline-block text-sm text-brand-600 hover:underline dark:text-brand-400">← {tx.back}</Link>
          </>
        )}
      </div>
    </div>
  );
}
