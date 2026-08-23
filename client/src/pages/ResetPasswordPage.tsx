import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Button, Field, Input } from '../components/ui';
import { useToast } from '../components/Toast';
import { useLang, type Lang } from '../context/LanguageContext';

const TXT: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Set a new password',
    sub: 'Choose a new password for your Prismatix account.',
    pw: 'New password',
    pwHint: 'At least 10 characters, with a letter and a number.',
    confirm: 'Confirm password',
    save: 'Reset password',
    saving: 'Saving…',
    mismatch: 'Passwords don\'t match',
    noToken: 'This reset link is invalid or has expired. Request a new one from the sign-in page.',
    done: 'Password reset — please sign in with your new password.',
    fail: 'Couldn\'t reset your password. The link may have expired — request a new one.',
    back: 'Back to sign in',
  },
  id: {
    title: 'Buat kata sandi baru',
    sub: 'Pilih kata sandi baru untuk akun Prismatix Anda.',
    pw: 'Kata sandi baru',
    pwHint: 'Minimal 10 karakter, dengan huruf dan angka.',
    confirm: 'Konfirmasi kata sandi',
    save: 'Reset kata sandi',
    saving: 'Menyimpan…',
    mismatch: 'Kata sandi tidak cocok',
    noToken: 'Tautan reset ini tidak valid atau sudah kedaluwarsa. Minta yang baru dari halaman masuk.',
    done: 'Kata sandi direset — silakan masuk dengan kata sandi baru Anda.',
    fail: 'Gagal mereset kata sandi. Tautan mungkin sudah kedaluwarsa — minta yang baru.',
    back: 'Kembali ke halaman masuk',
  },
};

// Landing for the reset link (/reset-password?token=…). Sets a new password via the public
// POST /auth/reset-password, then routes to /login (NO auto-login by design — the user signs in with
// the new password; the reset also revoked every existing session server-side).
export default function ResetPasswordPage() {
  const { lang } = useLang();
  const tx = TXT[lang];
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const tooShort = pw.length > 0 && pw.length < 10;
  const mismatch = confirm.length > 0 && confirm !== pw;
  const canSubmit = !!token && pw.length >= 10 && confirm === pw && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: pw });
      toast.success(tx.done);
      navigate('/login');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : tx.fail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{tx.title}</h1>
        {!token ? (
          <>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{tx.noToken}</p>
            <Link to="/login" className="mt-6 inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">← {tx.back}</Link>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{tx.sub}</p>
            <form className="mt-5 space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <Field label={tx.pw} hint={tx.pwHint}>
                <Input type="password" autoComplete="new-password" autoFocus required value={pw} onChange={(e) => setPw(e.target.value)} state={pw ? (tooShort ? 'invalid' : 'valid') : 'none'} placeholder="••••••••" />
              </Field>
              <Field label={tx.confirm} error={mismatch ? tx.mismatch : undefined}>
                <Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} state={confirm ? (mismatch ? 'invalid' : 'valid') : 'none'} placeholder="••••••••" />
              </Field>
              <Button type="submit" className="w-full" disabled={!canSubmit}>{busy ? tx.saving : tx.save}</Button>
            </form>
            <Link to="/login" className="mt-5 inline-block text-sm text-brand-600 hover:underline dark:text-brand-400">← {tx.back}</Link>
          </>
        )}
      </div>
    </div>
  );
}
