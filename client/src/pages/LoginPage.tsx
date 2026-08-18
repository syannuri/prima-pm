import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang, type Lang } from '../context/LanguageContext';
import { Button, Field, Input } from '../components/ui';
import { api, ApiError } from '../api/client';
import { isEmailValid } from '../lib/formValidation';
import { workspaceHostname } from '../lib/workspaceHost';

// Bilingual copy (EN/ID) — the sign-in screen follows the same language toggle as the landing.
const TXT: Record<Lang, {
  tagAccent: string; tagRest: string; pitch: string; highlights: string[];
  welcome: string; welcomeSub: string; tryFree: string; tryFreeSub: string; createOrg: string; createOrgSub: string;
  signInTo: (n: string) => string; workspaceOn: (n: string) => string;
  orgName: string; yourName: string; name: string; email: string; emailBad: string; password: string; pwHint: string; show: string; hide: string;
  submitSignin: string; submitGuest: string; submitOrg: string; signingIn: string; settingUp: string;
  or: string; sandbox: string; haveAccount: string; newHere: string; createOrgLink: string;
  forgot: string; secure: string;
  notFound: string; notFoundSub: (h: string) => string; goMain: string; awaiting: string; awaitingSub: (o: string) => string; back: string; yourAddress: string;
  checkEmail: string; checkEmailSub: (e: string) => string; resend: string; resendSent: string; notVerified: string;
}> = {
  en: {
    tagAccent: 'Clarity', tagRest: 'in every project.',
    pitch: 'Plan, track and report cost, schedule and risk — with earned-value truth, not gut feel.',
    highlights: ['See every project’s true health at a glance', 'Catch slips, overruns and risks before they grow', 'Keep schedules, budgets and people in sync'],
    welcome: 'Welcome back', welcomeSub: 'Sign in to your Prismatix workspace',
    tryFree: 'Try Prismatix free', tryFreeSub: 'Explore in your own private sandbox — no invite needed',
    createOrg: 'Create your organization', createOrgSub: 'Set up a new workspace for your team — you’ll be its admin once an admin approves it',
    signInTo: (n) => `Sign in to ${n}`, workspaceOn: (n) => `${n} workspace on Prismatix`,
    orgName: 'Organization name', yourName: 'Your name', name: 'Name', email: 'Email', emailBad: 'Enter a valid email address',
    password: 'Password', pwHint: 'At least 10 characters, with a letter and a number.', show: 'Show password', hide: 'Hide password',
    submitSignin: 'Sign in', submitGuest: 'Start exploring', submitOrg: 'Create organization', signingIn: 'Signing in…', settingUp: 'Setting up…',
    or: 'or', sandbox: 'Explore Prismatix in your own sandbox.', haveAccount: 'Have an account? Sign in', newHere: 'New here? Try Prismatix free', createOrgLink: 'Create an organization',
    forgot: 'Forgot your password? Ask your workspace admin to reset it.', secure: 'Encrypted in transit · your data stays in your workspace',
    notFound: 'Workspace not found', notFoundSub: (h) => `There’s no workspace at ${h}. Check the address, or head to the main site to sign in.`, goMain: 'Go to Prismatix',
    awaiting: 'Awaiting approval', awaitingSub: (o) => `Your request for the ${o} workspace has been received. An administrator will review and activate it — you'll be able to sign in once it's approved.`, back: 'Back to sign in', yourAddress: 'Your workspace address:',
    checkEmail: 'Check your email', checkEmailSub: (e) => `We've sent an activation link to ${e}. Click it to activate your account, then sign in.`, resend: 'Resend activation email', resendSent: 'Activation email sent — check your inbox.', notVerified: 'Your email isn’t activated yet. Open the link we emailed you, or resend it below.',
  },
  id: {
    tagAccent: 'Kejelasan', tagRest: 'di setiap proyek.',
    pitch: 'Rencanakan, pantau, dan laporkan biaya, jadwal, dan risiko — dengan kebenaran earned value, bukan perkiraan.',
    highlights: ['Lihat kesehatan tiap proyek dalam sekejap', 'Tangkap keterlambatan, pembengkakan, dan risiko sejak dini', 'Jaga jadwal, anggaran, dan tim tetap selaras'],
    welcome: 'Selamat datang kembali', welcomeSub: 'Masuk ke workspace Prismatix Anda',
    tryFree: 'Coba Prismatix gratis', tryFreeSub: 'Jelajahi di sandbox pribadi Anda — tanpa undangan',
    createOrg: 'Buat organisasi Anda', createOrgSub: 'Siapkan workspace baru untuk tim Anda — Anda menjadi admin-nya setelah disetujui',
    signInTo: (n) => `Masuk ke ${n}`, workspaceOn: (n) => `Workspace ${n} di Prismatix`,
    orgName: 'Nama organisasi', yourName: 'Nama Anda', name: 'Nama', email: 'Email', emailBad: 'Masukkan alamat email yang valid',
    password: 'Kata sandi', pwHint: 'Minimal 10 karakter, dengan huruf dan angka.', show: 'Tampilkan sandi', hide: 'Sembunyikan sandi',
    submitSignin: 'Masuk', submitGuest: 'Mulai menjelajah', submitOrg: 'Buat organisasi', signingIn: 'Sedang masuk…', settingUp: 'Menyiapkan…',
    or: 'atau', sandbox: 'Jelajahi Prismatix di sandbox Anda sendiri.', haveAccount: 'Sudah punya akun? Masuk', newHere: 'Baru di sini? Coba gratis', createOrgLink: 'Buat organisasi',
    forgot: 'Lupa kata sandi? Minta admin workspace Anda untuk meresetnya.', secure: 'Terenkripsi saat transit · data Anda tetap di workspace Anda',
    notFound: 'Workspace tidak ditemukan', notFoundSub: (h) => `Tidak ada workspace di ${h}. Periksa alamatnya, atau buka situs utama untuk masuk.`, goMain: 'Ke Prismatix',
    awaiting: 'Menunggu persetujuan', awaitingSub: (o) => `Permintaan untuk workspace ${o} telah diterima. Administrator akan meninjau dan mengaktifkannya — Anda dapat masuk setelah disetujui.`, back: 'Kembali ke masuk', yourAddress: 'Alamat workspace Anda:',
    checkEmail: 'Cek email Anda', checkEmailSub: (e) => `Kami mengirim tautan aktivasi ke ${e}. Klik untuk mengaktifkan akun, lalu masuk.`, resend: 'Kirim ulang email aktivasi', resendSent: 'Email aktivasi terkirim — periksa kotak masuk Anda.', notVerified: 'Email Anda belum diaktifkan. Buka tautan yang kami kirim, atau kirim ulang di bawah.',
  },
};

// Google Identity Services is injected at runtime (not bundled) — the button only appears when
// the deployment enables Google sign-in (GOOGLE_CLIENT_ID set), fetched from /auth/providers.
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google?: any;
    // Cloudflare Turnstile, injected at runtime (only when the deployment enables CAPTCHA).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    turnstile?: any;
  }
}

// Cloudflare Turnstile widget script — loaded on demand, only when /auth/providers reports a site key.
let turnstilePromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (turnstilePromise) return turnstilePromise;
  turnstilePromise = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Turnstile'));
    document.head.appendChild(s);
  });
  return turnstilePromise;
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

const Eye = () => <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>;
const EyeOff = () => <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13 13 0 0 1-2.16 2.95M6.7 6.7A13 13 0 0 0 2 12s3.5 7 10 7a9 9 0 0 0 3.3-.6M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>;

export default function LoginPage() {
  const { login, guestRegister, signupOrg, loginWithGoogle } = useAuth();
  const { lang, setLang } = useLang();
  const tx = TXT[lang];
  const [mode, setMode] = useState<'signin' | 'guest' | 'org'>('signin');
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Set after a successful org signup (option C): the request is queued for admin approval, so we show
  // a confirmation panel instead of routing into a session (there is none yet).
  const [pendingOrg, setPendingOrg] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  // Email-activation wall: set to the target email after a guest signup that needs activation (shows a
  // "check your email" panel), or after a login blocked by EMAIL_NOT_VERIFIED (shows a resend button).
  const [pendingVerify, setPendingVerify] = useState<string | null>(null);
  const [notVerifiedEmail, setNotVerifiedEmail] = useState<string | null>(null);
  const [resendMsg, setResendMsg] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [guestEnabled, setGuestEnabled] = useState(false);
  const [orgEnabled, setOrgEnabled] = useState(false);
  const [workspace, setWorkspace] = useState<{ slug: string; name: string } | null>(null);
  const [workspaceNotFound, setWorkspaceNotFound] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [showPw, setShowPw] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);

  // Ask the server which sign-up paths are enabled (admin-toggleable). Google's client ID is
  // public, so it's safe to send. Hides the guest option entirely when disabled.
  useEffect(() => {
    api
      .get<{ google?: { enabled: boolean; clientId: string }; turnstile?: { enabled: boolean; siteKey: string }; guestSignup?: boolean; orgSignup?: boolean; workspace?: { slug: string; name: string } | null; workspaceNotFound?: boolean }>('/auth/providers')
      .then((p) => {
        if (p.google?.enabled && p.google.clientId) setGoogleClientId(p.google.clientId);
        if (p.turnstile?.enabled && p.turnstile.siteKey) setTurnstileSiteKey(p.turnstile.siteKey);
        // The Host is a workspace-shaped subdomain that owns no tenant → show a "not found" page.
        setWorkspaceNotFound(Boolean(p.workspaceNotFound));
        // On a tenant's own domain (subdomain / custom domain) it's a sign-in-only page for that
        // workspace — the self-serve guest/org signup paths don't apply there.
        const ws = p.workspace ?? null;
        setWorkspace(ws);
        setGuestEnabled(ws ? false : Boolean(p.guestSignup));
        setOrgEnabled(ws ? false : Boolean(p.orgSignup));
        setMode((m) => ws ? 'signin' : ((m === 'guest' && !p.guestSignup) || (m === 'org' && !p.orgSignup) ? 'signin' : m));
      })
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
          // 'outline' = white button with a light rounded border, matching the form fields
          // (vs the old black "banner"). Google renders this in an iframe, so the corner radius
          // is Google's own (~4px), not the field's rounded-lg — as close as GIS allows.
          type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', width: 320,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // loginWithGoogle is stable across this page's lifetime (auth state doesn't change here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId]);

  // Render the Turnstile widget once we have a site key (and we're showing the form, not the
  // workspace-not-found card). The callback stashes the token; expiry/error clears it.
  useEffect(() => {
    if (!turnstileSiteKey || workspaceNotFound) return;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !window.turnstile || !turnstileRef.current || turnstileWidgetId.current) return;
        turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
          sitekey: turnstileSiteKey,
          theme: 'light',
          callback: (token: string) => setCaptchaToken(token),
          'expired-callback': () => setCaptchaToken(''),
          'error-callback': () => setCaptchaToken(''),
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [turnstileSiteKey, workspaceNotFound]);

  const emailOk = isEmailValid(email);
  const isGuest = mode === 'guest';
  const isOrg = mode === 'org';
  const isSignup = isGuest || isOrg; // both need a name + a strong password (server enforces the full rule)

  // "Workspace not found" screen: the address the user tried, and a link back to the main site
  // (the base domain — drop the left-most subdomain label).
  const attemptedHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const mainSiteUrl = attemptedHost.includes('.')
    ? `${window.location.protocol}//${attemptedHost.split('.').slice(1).join('.')}`
    : '/';
  // When Turnstile is on, block submit until the challenge yields a token.
  const captchaOk = !turnstileSiteKey || Boolean(captchaToken);
  const canSubmit = emailOk && !busy && captchaOk
    && (isSignup ? name.trim().length >= 2 && password.length >= 10 && (!isOrg || orgName.trim().length >= 2) : password.length > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isOrg) {
        const res = await signupOrg(orgName.trim(), name.trim(), email, password, captchaToken);
        setPendingOrg(res.orgName || orgName.trim()); // queued for approval — no session yet
        setPendingSlug(res.slug);
      }
      else if (isGuest) {
        const res = await guestRegister(name.trim(), email, password, captchaToken);
        // Wall armed: no session — show the "check your email to activate" panel instead of routing in.
        if (res && 'verify' in res) setPendingVerify(res.email);
      }
      else await login(email, password, captchaToken);
    } catch (err) {
      // Login blocked because the email isn't activated → offer a resend action rather than a dead-end.
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        setNotVerifiedEmail(email);
        setError(tx.notVerified);
      } else setError(err instanceof ApiError ? err.message : isSignup ? "Couldn't set up your workspace" : 'Login failed');
      // Turnstile tokens are single-use — reset the widget so a retry gets a fresh one.
      if (turnstileWidgetId.current && window.turnstile) {
        window.turnstile.reset(turnstileWidgetId.current);
        setCaptchaToken('');
      }
    } finally {
      setBusy(false);
    }
  };

  // Resend the activation email for the address that just failed login. Always resolves (the server
  // returns a generic 200 to avoid enumeration), so we just confirm it was sent.
  const resendActivation = async () => {
    if (!notVerifiedEmail) return;
    setBusy(true);
    setResendMsg('');
    try {
      await api.post('/auth/resend-activation', { email: notVerifiedEmail });
      setResendMsg(tx.resendSent);
    } catch {
      setResendMsg(tx.resendSent); // generic-success UX even if the call hiccups
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-slate-50 px-6 py-6 text-slate-800 antialiased dark:bg-slate-950 dark:text-slate-200">
      {/* Soft blue mesh — layered radial gradients (light mode) for an elegant, calm aurora canvas. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 dark:hidden"
        style={{
          background:
            'radial-gradient(60rem 60rem at 12% 8%, rgba(59,130,246,0.13), transparent 60%),' +
            'radial-gradient(52rem 52rem at 92% 12%, rgba(37,99,235,0.11), transparent 55%),' +
            'radial-gradient(58rem 58rem at 82% 96%, rgba(96,165,250,0.16), transparent 60%),' +
            'radial-gradient(46rem 46rem at 6% 92%, rgba(37,99,235,0.09), transparent 55%)',
        }}
      />
      {/* Floating aurora blobs (both themes; softer in dark). */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-[28rem] w-[28rem] rounded-full bg-blue-400/20 blur-3xl dark:bg-blue-500/10" />
      <div className="pointer-events-none absolute -bottom-24 left-1/4 h-[30rem] w-[30rem] rounded-full bg-blue-500/15 blur-3xl dark:bg-blue-600/10" />
      <div className="pointer-events-none absolute -left-20 top-1/3 h-72 w-72 rounded-full bg-indigo-300/20 blur-3xl dark:bg-indigo-500/10" />

      {/* language toggle (matches the landing) */}
      <div className="absolute right-4 top-4 z-20 inline-flex rounded-lg border border-slate-200 bg-white/80 p-0.5 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-800/80">
        {(['en', 'id'] as Lang[]).map((l) => (
          <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase transition ${lang === l ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* logo — centered above the card */}
        <div className="mb-4 flex justify-center">
          <span className="relative inline-block border-[3px] border-slate-900 px-3.5 py-1.5 font-brand text-xl font-bold tracking-wide text-slate-800 dark:border-white dark:text-slate-100">
            PRISMATIX
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-500" />
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-xl shadow-slate-300/40 backdrop-blur-sm sm:p-6 dark:border-slate-700 dark:bg-slate-900">
              {workspaceNotFound ? (
                <div className="py-4 text-center">
                  <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-200">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-7 w-7"><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="m20 20-3.5-3.5M11 8v3.5" /><circle cx="11" cy="14.6" r=".55" fill="currentColor" stroke="none" /></svg>
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">{tx.notFound}</h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{tx.notFoundSub(attemptedHost)}</p>
                  <a href={mainSiteUrl} className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 py-2.5 font-medium text-white shadow-lg shadow-brand-500/30 transition hover:from-brand-600 hover:to-brand-700">{tx.goMain}</a>
                </div>
              ) : pendingVerify ? (
                <div className="py-4 text-center">
                  <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-200 dark:bg-brand-900/30 dark:ring-brand-800">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-7 w-7"><rect x="3" y="5" width="18" height="14" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="m3.5 7 8.5 6 8.5-6" /></svg>
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">{tx.checkEmail}</h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{tx.checkEmailSub(pendingVerify)}</p>
                  <button type="button" onClick={() => { setPendingVerify(null); setMode('signin'); setPassword(''); }} className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 py-2.5 font-medium text-white shadow-lg shadow-brand-500/30 transition hover:from-brand-600 hover:to-brand-700">{tx.back}</button>
                </div>
              ) : pendingOrg ? (
                <div className="py-4 text-center">
                  <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-200">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-7 w-7"><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 2" /></svg>
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">{tx.awaiting}</h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{tx.awaitingSub(pendingOrg)}</p>
                  {pendingSlug && workspaceHostname(pendingSlug) && (
                    <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                      {tx.yourAddress} <span className="font-mono font-semibold text-brand-600 dark:text-brand-400">{workspaceHostname(pendingSlug)}</span>
                    </p>
                  )}
                  <button type="button" onClick={() => { setPendingOrg(null); setPendingSlug(null); setMode('signin'); }} className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 py-2.5 font-medium text-white shadow-lg shadow-brand-500/30 transition hover:from-brand-600 hover:to-brand-700">{tx.back}</button>
                </div>
              ) : (
              <>
              <div className="mb-4 text-center">
                <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">{workspace ? tx.signInTo(workspace.name) : isOrg ? tx.createOrg : isGuest ? tx.tryFree : tx.welcome}</h1>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{workspace ? tx.workspaceOn(workspace.name) : isOrg ? tx.createOrgSub : isGuest ? tx.tryFreeSub : tx.welcomeSub}</p>
              </div>

              {/* Social sign-in first (Asana-style); Google Identity Services renders its own button here. */}
              {googleClientId && (
                <>
                  <div ref={googleBtnRef} className="flex min-h-[44px] justify-center" />
                  <div className="my-3.5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /> {tx.or} <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                  </div>
                </>
              )}

              <form onSubmit={submit} className="space-y-3">
                {isOrg && (
                  <Field label={tx.orgName}>
                    <Input type="text" autoComplete="organization" placeholder="Acme Corp" value={orgName} onChange={(e) => setOrgName(e.target.value)} required state={!orgName ? undefined : orgName.trim().length >= 2 ? 'valid' : 'invalid'} />
                  </Field>
                )}
                {isSignup && (
                  <Field label={isOrg ? tx.yourName : tx.name}>
                    <Input type="text" autoComplete="name" placeholder={tx.yourName} value={name} onChange={(e) => setName(e.target.value)} required state={!name ? undefined : name.trim().length >= 2 ? 'valid' : 'invalid'} />
                  </Field>
                )}
                <Field label={tx.email}>
                  <Input type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => { setEmail(e.target.value); if (notVerifiedEmail) { setNotVerifiedEmail(null); setResendMsg(''); setError(''); } }} required state={!email ? undefined : emailOk ? 'valid' : 'invalid'} />
                  {!!email && !emailOk && <span className="mt-1 block text-xs text-red-500">{tx.emailBad}</span>}
                </Field>
                <Field label={tx.password}>
                  <div className="relative">
                    <Input type={showPw ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required state={password ? (isSignup && password.length < 10 ? 'invalid' : 'valid') : undefined} className="pr-10" />
                    <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? tx.hide : tx.show} className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200">
                      {showPw ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                  {isSignup && <span className="mt-1 block text-xs text-slate-400">{tx.pwHint}</span>}
                  {!isSignup && !workspace && <p className="mt-1.5 text-right text-xs text-slate-400">{tx.forgot}</p>}
                </Field>
                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{error}</p>}
                {notVerifiedEmail && (
                  resendMsg
                    ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{resendMsg}</p>
                    : <button type="button" onClick={resendActivation} disabled={busy} className="text-sm font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400">{tx.resend}</button>
                )}
                {/* Cloudflare Turnstile — only rendered when the deployment enables it. */}
                {turnstileSiteKey && <div ref={turnstileRef} className="flex min-h-[65px] justify-center" />}
                <Button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full bg-gradient-to-r from-brand-500 to-brand-600 py-2.5 text-white shadow-lg shadow-brand-500/30 hover:from-brand-600 hover:to-brand-700"
                >
                  {busy ? (isSignup ? tx.settingUp : tx.signingIn) : isOrg ? tx.submitOrg : isGuest ? tx.submitGuest : tx.submitSignin}
                </Button>
              </form>

              {/* trust / security note at the point of sign-in */}
              <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                {tx.secure}
              </p>

              {(guestEnabled || orgEnabled || isSignup) && (
                <div className="mt-4 flex flex-col gap-1.5 border-t border-slate-200/70 pt-3 text-center dark:border-slate-700/60">
                  {isSignup ? (
                    <button type="button" onClick={() => { setMode('signin'); setError(''); }} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
                      {tx.haveAccount}
                    </button>
                  ) : (
                    <>
                      {guestEnabled && (
                        <button type="button" onClick={() => { setMode('guest'); setError(''); }} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
                          {tx.newHere}
                        </button>
                      )}
                      {orgEnabled && (
                        <button type="button" onClick={() => { setMode('org'); setError(''); }} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
                          {tx.createOrgLink}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              </>
              )}
        </div>
      </div>
    </div>
  );
}
