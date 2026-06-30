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
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-indigo-50 dark:from-[#0b1020] dark:via-slate-950 dark:to-black">
      {/* Midnight Aurora — deep navy/black with coral + violet + indigo glows (dark-first);
          light gets a softer tinted version of the same mesh */}
      <style>{`
        @keyframes prima-drift1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(22px,-26px)} }
        @keyframes prima-drift2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-26px,20px)} }
        @keyframes prima-drift3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(18px,24px)} }
        @media (prefers-reduced-motion: reduce){ .prima-orb{animation:none!important} }
      `}</style>
      {/* coral glow — top-left */}
      <div className="prima-orb pointer-events-none absolute -left-32 -top-28 h-[32rem] w-[32rem] rounded-full bg-brand-300/30 blur-3xl dark:bg-brand-600/30" style={{ animation: 'prima-drift1 15s ease-in-out infinite' }} />
      {/* indigo glow — bottom-left */}
      <div className="prima-orb pointer-events-none absolute -bottom-32 left-1/4 h-[34rem] w-[34rem] rounded-full bg-indigo-300/30 blur-3xl dark:bg-indigo-700/40" style={{ animation: 'prima-drift2 18s ease-in-out infinite' }} />
      {/* violet glow — top-right, haloes the sign-in card */}
      <div className="prima-orb pointer-events-none absolute -right-16 top-1/4 h-[28rem] w-[28rem] rounded-full bg-violet-300/30 blur-3xl dark:bg-violet-700/40" style={{ animation: 'prima-drift3 22s ease-in-out infinite' }} />
      {/* deep-blue centre glow — adds midnight depth (mostly dark) */}
      <div className="prima-orb pointer-events-none absolute left-1/3 top-1/3 h-80 w-80 rounded-full bg-sky-200/15 blur-3xl dark:bg-blue-800/30" style={{ animation: 'prima-drift1 26s ease-in-out infinite' }} />

      {/* top wash — soft white (light) / violet glow (dark) */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(255,255,255,0.5),transparent)] dark:bg-[radial-gradient(ellipse_70%_55%_at_50%_0%,rgba(139,92,246,0.18),transparent)]" />

      {/* dark-mode drama: glossy top sheen + bottom vignette for depth */}
      <div className="pointer-events-none absolute inset-0 hidden dark:block bg-[radial-gradient(120%_80%_at_50%_-10%,rgba(255,255,255,0.06),transparent_50%),radial-gradient(120%_90%_at_50%_120%,rgba(0,0,0,0.7),transparent_55%)]" />

      <div className="relative z-10 flex min-h-screen">
        {/* ---------- LEFT · tagline space (large screens) ---------- */}
        <div className="hidden flex-1 flex-col justify-between p-12 lg:flex xl:p-20">
          <div className="flex items-center gap-4">
            <Logo className="h-14 w-14 drop-shadow-[0_10px_28px_rgba(244,103,95,0.4)]" />
            <span className="font-brand text-3xl font-bold tracking-wide text-slate-800 dark:text-slate-100">PRECISE</span>
          </div>

          <div className="max-w-2xl">
            <p className="mb-4 whitespace-nowrap text-xs font-semibold uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400 xl:text-[13px] xl:tracking-[0.22em]">
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

          <p className="text-xs text-slate-400 dark:text-slate-500">© 2026 Precise</p>
        </div>

        {/* ---------- RIGHT · sign-in card (right-aligned) ---------- */}
        <div className="flex w-full items-center justify-center p-6 sm:p-10 lg:w-[40%] lg:justify-end lg:pr-12 xl:pr-16">
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
