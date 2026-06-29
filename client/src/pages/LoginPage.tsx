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
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* ---------- LEFT · branded hero (large screens) ---------- */}
      <div className="relative hidden overflow-hidden lg:flex lg:w-[58%]">
        {/* gradient base — deep slate → coral, high-tech yet elegant */}
        <div className="absolute inset-0 bg-slate-950" />
        <div className="absolute inset-0 bg-gradient-to-br from-brand-900/50 via-slate-950 to-brand-700/40" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_#f4675f59,_transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_#be3b394d,_transparent_50%)]" />

        {/* scoped animations */}
        <style>{`
          @keyframes prima-sweep { to { transform: rotate(360deg) } }
          @keyframes prima-floatA { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-26px)} }
          @keyframes prima-floatB { 0%,100%{transform:translateY(0)} 50%{transform:translateY(24px)} }
          @keyframes prima-scan { 0%{transform:translateY(-8rem);opacity:0} 12%,88%{opacity:.5} 100%{transform:translateY(58rem);opacity:0} }
          @media (prefers-reduced-motion: reduce){ .prima-anim{animation:none!important} }
        `}</style>

        {/* drifting glow orbs */}
        <div className="prima-anim absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-brand-500/25 blur-3xl" style={{ animation: 'prima-floatA 11s ease-in-out infinite' }} />
        <div className="prima-anim absolute bottom-0 right-0 h-[30rem] w-[30rem] translate-x-1/4 translate-y-1/4 rounded-full bg-brand-600/20 blur-3xl" style={{ animation: 'prima-floatB 13s ease-in-out infinite' }} />
        <div className="prima-anim absolute left-1/3 top-10 h-44 w-44 rounded-full bg-brand-400/15 blur-2xl" style={{ animation: 'prima-floatB 9s ease-in-out infinite' }} />

        {/* technical grid mesh */}
        <svg className="absolute inset-0 h-full w-full text-white opacity-[0.06]" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
              <path d="M44 0 H0 V44" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* radar over concentric target rings — echoes the PRIMA mark (precision) */}
        <div className="absolute -right-16 -top-16 h-[34rem] w-[34rem]">
          <div className="absolute inset-0 overflow-hidden rounded-full opacity-80">
            <div
              className="prima-anim absolute inset-0"
              style={{ background: 'conic-gradient(from 0deg, transparent 0deg, rgba(244,103,95,0.22) 40deg, transparent 72deg)', animation: 'prima-sweep 7s linear infinite' }}
            />
          </div>
          <svg className="absolute inset-0 h-full w-full text-brand-300/25" viewBox="0 0 400 400" fill="none" aria-hidden="true">
            {[60, 110, 160, 200].map((r) => (
              <circle key={r} cx="200" cy="200" r={r} stroke="currentColor" strokeWidth="1.5" />
            ))}
          </svg>
          {/* pulsing centre node */}
          <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-400 shadow-[0_0_18px_4px_rgba(244,103,95,0.55)]">
            <span className="prima-anim absolute -inset-3 rounded-full bg-brand-500/40" style={{ animation: 'ping 2.4s cubic-bezier(0,0,0.2,1) infinite' }} />
          </span>
        </div>

        {/* slow horizontal scan line */}
        <div className="prima-anim absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-400/60 to-transparent" style={{ animation: 'prima-scan 8s linear infinite' }} />

        {/* content */}
        <div className="relative z-10 flex w-full flex-col justify-between p-12 text-white xl:p-16">
          <div className="flex items-center gap-3">
            <Logo className="h-11 w-11 drop-shadow-[0_4px_16px_rgba(244,103,95,0.5)]" />
            <span className="text-xl font-semibold tracking-tight">PRIMA</span>
          </div>

          <div className="max-w-lg">
            <h2 className="text-4xl font-bold leading-[1.15] xl:text-5xl">
              Precision in every <span className="bg-gradient-to-r from-brand-300 to-brand-500 bg-clip-text text-transparent">project</span>.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-white/70">
              Project Risk, Investment, Management &amp; Assurance — Earned Value, schedule, cost &amp; resources, unified in one elegant workspace.
            </p>
            <ul className="mt-9 space-y-3.5 text-sm text-white/85">
              {[
                'Earned Value Management & portfolio health',
                'WBS, schedule & cross-project resource utilization',
                'Cost baselines, risk & change control',
              ].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-500/20 ring-1 ring-brand-400/40">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-white/40">© 2026 PRIMA · Xapiens</p>
        </div>
      </div>

      {/* ---------- RIGHT · sign-in form (centered) ---------- */}
      <div className="flex w-full items-center justify-center p-6 sm:p-10 lg:w-[42%]">
        <div className="w-full max-w-sm">
          {/* logo on small screens (hero hidden) */}
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <Logo className="h-10 w-10" />
            <span className="text-lg font-semibold text-slate-800 dark:text-slate-100">PRIMA</span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">Welcome back</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Sign in to your PRIMA workspace.</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
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

          <p className="mt-8 text-center text-xs text-slate-400 dark:text-slate-500">
            Project Risk, Investment, Management &amp; Assurance
          </p>
        </div>
      </div>
    </div>
  );
}
