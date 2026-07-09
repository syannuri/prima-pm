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
    // `dark` forces this subtree into dark mode so the aurora-dark background reads correctly
    // regardless of the app theme — matching the always-dark landing page (HomePage).
    <div className="dark relative min-h-screen overflow-hidden bg-[#05070e] text-slate-200 antialiased">
      {/* Aurora-dark backdrop — the same recipe as the public landing page (HomePage) so the
          sign-in screen shares its midnight-aurora identity: a real aurora photo anchored to
          the top over a #05070e base, twinkling stars, dark readability scrims, and soft
          coral/indigo/violet glows drifting for depth. */}
      <style>{`
        @keyframes prima-drift1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(22px,-26px)} }
        @keyframes prima-drift2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-26px,20px)} }
        @keyframes prima-drift3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(18px,24px)} }
        @keyframes prima-twinkle { 0%,100%{opacity:.55} 50%{opacity:.95} }
        .prima-stars { position:absolute; inset:0; opacity:.85; background-repeat:no-repeat;
          background-image:
            radial-gradient(1.6px 1.6px at 8% 16%,  rgba(255,255,255,.95), transparent),
            radial-gradient(1.2px 1.2px at 17% 30%, rgba(255,255,255,.75), transparent),
            radial-gradient(1.4px 1.4px at 27% 12%, rgba(255,255,255,.85), transparent),
            radial-gradient(1px   1px   at 34% 24%, rgba(255,255,255,.65), transparent),
            radial-gradient(1.5px 1.5px at 63% 14%, rgba(255,255,255,.9),  transparent),
            radial-gradient(1.1px 1.1px at 72% 27%, rgba(255,255,255,.7),  transparent),
            radial-gradient(1.3px 1.3px at 83% 18%, rgba(255,255,255,.85), transparent),
            radial-gradient(1px   1px   at 91% 33%, rgba(255,255,255,.6),  transparent),
            radial-gradient(1.2px 1.2px at 47% 9%,  rgba(255,255,255,.8),  transparent),
            radial-gradient(1px   1px   at 55% 22%, rgba(255,255,255,.6),  transparent);
          animation:prima-twinkle 6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce){ .prima-orb,.prima-stars{animation:none!important} }
      `}</style>

      {/* real aurora photo anchored to the top, twinkling stars, then scrims that fade it into
          the midnight base — identical treatment to the landing page hero */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[85vh] overflow-hidden">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: 'url(/aurora-bg.jpg)' }} />
        <div className="prima-stars" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#05070e]/80 via-[#05070e]/45 to-[#05070e]" />
        <div className="absolute inset-0 bg-[radial-gradient(85%_55%_at_50%_35%,rgba(5,7,14,0.5),transparent_72%)]" />
      </div>

      {/* soft drifting glows for depth — coral · indigo · violet, the same palette as the hero */}
      <div className="prima-orb pointer-events-none absolute -left-32 -top-28 h-[32rem] w-[32rem] rounded-full bg-brand-600/25 blur-3xl" style={{ animation: 'prima-drift1 15s ease-in-out infinite' }} />
      <div className="prima-orb pointer-events-none absolute -bottom-32 left-1/4 h-[34rem] w-[34rem] rounded-full bg-indigo-700/30 blur-3xl" style={{ animation: 'prima-drift2 18s ease-in-out infinite' }} />
      <div className="prima-orb pointer-events-none absolute -right-16 top-1/4 h-[28rem] w-[28rem] rounded-full bg-violet-700/30 blur-3xl" style={{ animation: 'prima-drift3 22s ease-in-out infinite' }} />

      {/* bottom vignette for depth (matches the landing page) */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_120%,rgba(0,0,0,0.7),transparent_55%)]" />

      <div className="relative z-10 flex min-h-screen">
        {/* ---------- LEFT · tagline space (large screens) ---------- */}
        <div className="hidden flex-1 flex-col justify-between p-12 lg:flex xl:p-20">
          <span className="relative self-start inline-block border-[3px] border-slate-900 px-4 py-2 font-brand text-3xl font-bold tracking-wide text-slate-800 dark:border-white dark:text-slate-100">
            PRISMATIX
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-slate-900 dark:bg-white" />
          </span>

          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold leading-[1.15] text-slate-800 dark:text-white xl:text-4xl">
              <span className="bg-gradient-to-r from-brand-400 to-brand-600 bg-clip-text text-transparent">Clarity</span>{' '}
              in every project.
            </h2>
            <p className="mt-3 max-w-md text-base text-slate-500 dark:text-slate-300">
              Plan, track and report cost, schedule and risk — with earned-value truth, not gut feel.
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

          <p className="text-xs text-slate-500 dark:text-slate-400">© 2026 Prismatix</p>
        </div>

        {/* ---------- RIGHT · sign-in card (right-aligned) ---------- */}
        <div className="flex w-full items-center justify-center p-6 sm:p-10 lg:w-[42%] lg:justify-center lg:pr-12 xl:pr-16">
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
