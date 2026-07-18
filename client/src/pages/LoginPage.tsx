import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button, Field, Input } from '../components/ui';
import { api, ApiError } from '../api/client';
import { isEmailValid } from '../lib/formValidation';

const HIGHLIGHTS = [
  'See every project’s true health at a glance',
  'Catch slips, overruns and risks before they grow',
  'Keep schedules, budgets and people in sync',
];

// Google Identity Services is injected at runtime (not bundled) — the button only appears when
// the deployment enables Google sign-in (GOOGLE_CLIENT_ID set), fetched from /auth/providers.
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google?: any;
  }
}
let gisPromise: Promise<void> | null = null;
function loadGoogleIdentityServices(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

export default function LoginPage() {
  const { login, guestRegister, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState<'signin' | 'guest'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Ask the server which providers are on. Google's client ID is public, so it's safe to send.
  useEffect(() => {
    api
      .get<{ google?: { enabled: boolean; clientId: string } }>('/auth/providers')
      .then((p) => { if (p.google?.enabled && p.google.clientId) setGoogleClientId(p.google.clientId); })
      .catch(() => {});
  }, []);

  // Render Google's official button once we have a client ID + the GIS script.
  useEffect(() => {
    if (!googleClientId) return;
    let cancelled = false;
    loadGoogleIdentityServices()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id || !googleBtnRef.current) return;
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (resp: { credential?: string }) => {
            if (!resp?.credential) return;
            setError('');
            setBusy(true);
            try {
              await loginWithGoogle(resp.credential);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Google sign-in failed');
            } finally {
              setBusy(false);
            }
          },
        });
        googleBtnRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'rectangular', width: 320,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // loginWithGoogle is stable across this page's lifetime (auth state doesn't change here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId]);

  const emailOk = isEmailValid(email);
  const isGuest = mode === 'guest';
  // Guest signup needs a name + a strong-enough password (min 10 — server enforces the full rule).
  const canSubmit = emailOk && !busy && (isGuest ? name.trim().length >= 2 && password.length >= 10 : password.length > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isGuest) await guestRegister(name.trim(), email, password);
      else await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : isGuest ? "Couldn't set up your workspace" : 'Login failed');
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
                <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">{isGuest ? 'Try Prismatix free' : 'Welcome back'}</h1>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{isGuest ? 'Explore in your own private sandbox — no invite needed' : 'Sign in to your Prismatix workspace'}</p>
              </div>

              <form onSubmit={submit} className="space-y-4">
                {isGuest && (
                  <Field label="Name">
                    <Input type="text" autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required state={!name ? undefined : name.trim().length >= 2 ? 'valid' : 'invalid'} />
                  </Field>
                )}
                <Field label="Email">
                  <Input type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required state={!email ? undefined : emailOk ? 'valid' : 'invalid'} />
                  {!!email && !emailOk && <span className="mt-1 block text-xs text-red-500">Enter a valid email address</span>}
                </Field>
                <Field label="Password">
                  <Input type="password" autoComplete={isGuest ? 'new-password' : 'current-password'} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required state={password ? (isGuest && password.length < 10 ? 'invalid' : 'valid') : undefined} />
                  {isGuest && <span className="mt-1 block text-xs text-slate-400">At least 10 characters, with a letter and a number.</span>}
                </Field>
                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{error}</p>}
                <Button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full bg-gradient-to-r from-brand-500 to-brand-600 py-2.5 text-white shadow-lg shadow-brand-500/30 hover:from-brand-600 hover:to-brand-700"
                >
                  {busy ? (isGuest ? 'Setting up…' : 'Signing in…') : isGuest ? 'Start exploring' : 'Sign in'}
                </Button>
              </form>

              {googleClientId && (
                <>
                  <div className="my-4 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    <span className="h-px flex-1 bg-slate-200/70 dark:bg-slate-700/60" /> or <span className="h-px flex-1 bg-slate-200/70 dark:bg-slate-700/60" />
                  </div>
                  {/* Google Identity Services renders its own button into this container. */}
                  <div ref={googleBtnRef} className="flex min-h-[44px] justify-center" />
                  <p className="mt-2 text-center text-[11px] text-slate-400">Explore Prismatix in your own sandbox.</p>
                </>
              )}

              <div className="mt-6 border-t border-slate-200/70 pt-4 text-center dark:border-slate-700/60">
                <button type="button" onClick={() => { setMode(isGuest ? 'signin' : 'guest'); setError(''); }} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
                  {isGuest ? 'Have an account? Sign in' : 'New here? Try Prismatix free'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
