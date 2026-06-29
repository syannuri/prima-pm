import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button, Field, Input } from '../components/ui';
import Logo from '../components/Logo';
import { ApiError } from '../api/client';

const HIGHLIGHTS = [
  'See every project’s true health at a glance',
  'Catch slips, overruns and risks before they grow',
  'Keep schedules, budgets and people in sync',
];

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
      <div className="prima-orb pointer-events-none absolute -bottom-32 left-1/3 h-[34rem] w-[34rem] rounded-full bg-brand-300/40 blur-3xl dark:bg-brand-800/25" style={{ animation: 'prima-drift2 18s ease-in-out infinite' }} />
      <div className="prima-orb pointer-events-none absolute right-1/4 top-1/4 h-72 w-72 rounded-full bg-brand-100/70 blur-3xl dark:bg-brand-900/20" style={{ animation: 'prima-drift1 22s ease-in-out infinite' }} />

      {/* soft light wash from the top */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(255,255,255,0.75),transparent)] dark:bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(244,103,95,0.10),transparent)]" />

      <div className="relative z-10 flex min-h-screen">
        {/* ---------- LEFT · tagline space (large screens) ---------- */}
        <div className="hidden flex-1 flex-col justify-between p-12 lg:flex xl:p-20">
          <div className="flex items-center gap-3">
            <Logo className="h-11 w-11 drop-shadow-[0_8px_22px_rgba(244,103,95,0.35)]" />
            <span className="font-brand text-xl font-bold tracking-wide text-slate-800 dark:text-slate-100">PRECISE</span>
          </div>

          <div className="max-w-xl">
            <p className="mb-4 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-600 dark:text-brand-400 xl:text-[11px] xl:tracking-[0.16em]">
              Projects · Risk · Earned Value · Cost · Investment · Schedule · Execution
            </p>
            <h2 className="text-4xl font-bold leading-[1.15] text-slate-800 dark:text-white xl:text-5xl">
              Precision in every{' '}
              <span className="bg-gradient-to-r from-brand-500 to-brand-600 bg-clip-text text-transparent">project</span>.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-600 dark:text-slate-300">
              Know exactly where your projects stand. From budget to schedule to risk, Precise
              turns scattered updates into one clear view your team can actually act on.
            </p>
            <ul className="mt-9 space-y-3.5 text-sm text-slate-600 dark:text-slate-300">
              {HIGHLIGHTS.map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-500/15 ring-1 ring-brand-400/40">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-slate-400 dark:text-slate-500">© 2026 Precise · Xapiens</p>
        </div>

        {/* ---------- RIGHT · sign-in card (right-aligned, with a splitter) ---------- */}
        <div className="flex w-full items-center justify-center p-6 sm:p-10 lg:w-[46%] lg:justify-end lg:border-l lg:border-slate-200/70 lg:pr-12 xl:pr-20 dark:lg:border-white/10">
          <div className="w-full max-w-sm">
            <div className="rounded-3xl border border-white/70 bg-white/75 p-7 shadow-[0_24px_70px_-20px_rgba(244,103,95,0.35)] backdrop-blur-xl sm:p-8 dark:border-white/10 dark:bg-slate-900/70 dark:shadow-[0_24px_70px_-20px_rgba(0,0,0,0.65)]">
              {/* logo on small screens (left pane hidden) */}
              <div className="mb-6 flex items-center justify-center gap-3 lg:hidden">
                <Logo className="h-10 w-10" />
                <span className="font-brand text-lg font-bold tracking-wide text-slate-800 dark:text-slate-100">PRECISE</span>
              </div>

              <div className="mb-7 text-center">
                <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">Welcome back</h1>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Sign in to your Precise workspace</p>
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
                <p className="text-center text-xs text-slate-400 dark:text-slate-500">Plan with clarity. Deliver with confidence.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
