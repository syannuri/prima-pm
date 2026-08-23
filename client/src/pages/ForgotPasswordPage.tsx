import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Button, Field, Input } from '../components/ui';
import { useLang, type Lang } from '../context/LanguageContext';
import TurnstileWidget from '../components/TurnstileWidget';
import BrandMark from '../components/BrandMark';
import AuthShell from '../components/AuthShell';

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
  // When the deployment has CAPTCHA on, the public forgot-password endpoint requires a Turnstile
  // token — so we render the widget and block submit until it yields one.
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaEnabled, setCaptchaEnabled] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = !!email.trim() && !busy && (!captchaEnabled || !!captchaToken);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email: email.trim().toLowerCase(), captchaToken: captchaToken || undefined });
      setSent(true); // success is identical for existing & non-existing accounts (anti-enumeration)
    } catch (e) {
      // Every error here is account-INDEPENDENT (captcha / validation / rate-limit) — the server's
      // 200 success path is the same whether or not the address has an account. So surfacing the
      // error leaks nothing, and it avoids a silent false "check your email" on a real failure.
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <BrandMark />
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
              <TurnstileWidget onToken={setCaptchaToken} onEnabled={setCaptchaEnabled} />
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{error}</p>}
              <Button type="submit" className="w-full" disabled={!canSubmit}>{busy ? tx.sending : tx.send}</Button>
            </form>
            <Link to="/login" className="mt-5 inline-block text-sm text-brand-600 hover:underline dark:text-brand-400">← {tx.back}</Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}
