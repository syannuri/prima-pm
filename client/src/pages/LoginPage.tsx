import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button, Field, Input } from '../components/ui';
import { ApiError } from '../api/client';
import { isEmailValid } from '../lib/formValidation';

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

  const emailOk = isEmailValid(email);
  const canSubmit = emailOk && password.length > 0 && !busy;

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
          <span className="relative self-start inline-block border-[3px] border-slate-900 px-4 py-2 font-brand text-3xl font-bold tracking-wide text-slate-800 dark:border-white dark:text-slate-100">
            PRISMATIX
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-slate-900 dark:bg-white" />
          </span>

          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold leading-[1.15] text-slate-800 dark:text-white xl:text-4xl">
              Empowering the project-management{' '}
              <span className="bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 bg-clip-text text-transparent">community</span>.
            </h2>
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

          <p className="text-xs text-slate-500 dark:text-slate-400">© 2026 Prismatix</p>
        </div>

        {/* ---------- RIGHT · sign-in card (right-aligned) ---------- */}
        <div className="flex w-full items-center justify-center p-6 sm:p-10 lg:w-[40%] lg:justify-end lg:pr-12 xl:pr-16">
          <div className="w-full max-w-sm">
            <div className="rounded-3xl border border-white/70 bg-white/75 p-7 shadow-[0_24px_70px_-20px_rgba(244,103,95,0.35)] backdrop-blur-xl sm:p-8 dark:border-white/10 dark:bg-slate-900/70 dark:shadow-[0_24px_70px_-20px_rgba(0,0,0,0.65)]">
              {/* logo on small screens (left pane hidden) */}
              <div className="mb-6 flex justify-center lg:hidden">
                <span className="relative inline-block border-[3px] border-slate-900 px-3 py-1.5 font-brand text-lg font-bold tracking-wide text-slate-800 dark:border-white dark:text-slate-100">
                  PRISMATIX
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-slate-900 dark:bg-white" />
                </span>
              </div>

              <div className="mb-7 text-center">
                <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">Welcome back</h1>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Sign in to your Prismatix workspace</p>
              </div>

              <form onSubmit={submit} className="space-y-4">
                <Field label="Email">
                  <Input type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required state={!email ? undefined : emailOk ? 'valid' : 'invalid'} />
                  {!!email && !emailOk && <span className="mt-1 block text-xs text-red-500">Enter a valid email address</span>}
                </Field>
                <Field label="Password">
                  <Input type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required state={password ? 'valid' : undefined} />
                </Field>
                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{error}</p>}
                <Button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full bg-gradient-to-r from-brand-500 to-brand-600 py-2.5 text-white shadow-lg shadow-brand-500/30 hover:from-brand-600 hover:to-brand-700"
                >
                  {busy ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>

              <div className="mt-7 border-t border-slate-200/70 pt-4 dark:border-slate-700/60">
                <p className="text-center text-xs text-slate-500 dark:text-slate-400">See where every project truly stands — cost, schedule, risk.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
