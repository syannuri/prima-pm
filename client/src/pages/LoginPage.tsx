import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button, Field, Input } from '../components/ui';
import Logo from '../components/Logo';
import { ApiError } from '../api/client';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-brand-50 via-white to-brand-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* gentle drifting glow orbs — soft, elegant, brand-tinted */}
      <style>{`
        @keyframes prima-drift1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(22px,-26px)} }
        @keyframes prima-drift2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-26px,20px)} }
        @media (prefers-reduced-motion: reduce){ .prima-orb{animation:none!important} }
      `}</style>
      <div className="prima-orb pointer-events-none absolute -left-32 -top-28 h-[30rem] w-[30rem] rounded-full bg-brand-200/50 blur-3xl dark:bg-brand-700/20" style={{ animation: 'prima-drift1 15s ease-in-out infinite' }} />
      <div className="prima-orb pointer-events-none absolute -bottom-32 -right-24 h-[34rem] w-[34rem] rounded-full bg-brand-300/40 blur-3xl dark:bg-brand-800/25" style={{ animation: 'prima-drift2 18s ease-in-out infinite' }} />
      <div className="prima-orb pointer-events-none absolute left-1/2 top-1/4 h-72 w-72 -translate-x-1/2 rounded-full bg-brand-100/70 blur-3xl dark:bg-brand-900/20" style={{ animation: 'prima-drift1 22s ease-in-out infinite' }} />

      {/* soft light wash from the top */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(255,255,255,0.75),transparent)] dark:bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(244,103,95,0.10),transparent)]" />

      {/* ---------- centered glass card ---------- */}
      <div className="relative z-10 grid min-h-screen place-items-center p-6">
        <div className="w-full max-w-md">
          <div className="rounded-3xl border border-white/70 bg-white/75 p-8 shadow-[0_24px_70px_-20px_rgba(244,103,95,0.35)] backdrop-blur-xl sm:p-10 dark:border-white/10 dark:bg-slate-900/70 dark:shadow-[0_24px_70px_-20px_rgba(0,0,0,0.65)]">
            <div className="mb-7 flex flex-col items-center text-center">
              <Logo className="h-14 w-14 drop-shadow-[0_10px_28px_rgba(244,103,95,0.4)]" />
              <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">Welcome back</h1>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Sign in to your PRIMA workspace</p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <Field label="Email">
                <Input type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Field label="Password">
                <Input type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{error}</p>}
              <Button
                type="submit"
                disabled={busy}
                className="w-full bg-gradient-to-r from-brand-500 to-brand-600 py-2.5 text-white shadow-lg shadow-brand-500/30 hover:from-brand-600 hover:to-brand-700"
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <div className="mt-7 border-t border-slate-200/70 pt-4 dark:border-slate-700/60">
              <p className="text-center text-xs text-slate-400 dark:text-slate-500">Project Risk, Investment, Management &amp; Assurance</p>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-400/90 dark:text-slate-600">© 2026 PRIMA · Xapiens</p>
        </div>
      </div>
    </div>
  );
}
