import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },
  // Comma-separated allowlist so the transition period can accept both the LAN http
  // origin and the public https origin.
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Set SECURE=true once the app is served over HTTPS (behind a TLS proxy). It turns on
  // HSTS + upgrade-insecure-requests, which must stay OFF on a plain-http LAN deploy.
  secure: process.env.SECURE === 'true',
  // Number of proxy hops to trust for req.ip / X-Forwarded-* (e.g. TRUST_PROXY=1 behind
  // one nginx). Leave unset for a direct bind — trusting a spoofable header is unsafe then.
  trustProxy: process.env.TRUST_PROXY,
  // Opens the self-service guest signup (POST /auth/guest/register → role GUEST, sandboxed
  // to personal projects). OFF by default — this is the one open-registration path, so it
  // must be explicitly enabled per deployment. The endpoint 403s while disabled.
  guestSignupEnabled: process.env.GUEST_SIGNUP_ENABLED === 'true',
  // Seeds the AppSetting.orgSignupEnabled toggle on first read (Phase 6 self-serve org signup).
  orgSignupEnabled: process.env.ORG_SIGNUP_ENABLED === 'true',
  // Google "Sign in with Google" is enabled by setting GOOGLE_CLIENT_ID to the OAuth 2.0
  // Web client ID. When empty the endpoint 403s and the client hides the button. The Client
  // ID is not a secret (it ships in the browser), but gating on it keeps the feature opt-in
  // per deployment. New Google users are created as sandboxed GUESTs (like guest signup).
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  // Cloudflare Turnstile CAPTCHA on the public signup/login forms. Enabled by setting the SECRET
  // key (server-side siteverify); the SITE key is public (ships in the browser to render the
  // widget). When the secret is empty the CAPTCHA is off — endpoints don't require a token and the
  // client hides the widget (so dev / LAN-by-IP are unaffected). Keys from the Cloudflare dashboard.
  turnstile: {
    siteKey: process.env.TURNSTILE_SITE_KEY ?? '',
    secretKey: process.env.TURNSTILE_SECRET_KEY ?? '',
  },
  // Web-push (VAPID). When the keypair is set, browser push notifications are enabled; the public
  // key ships to the client, the private key signs pushes. Empty ⇒ push is off (endpoints report
  // unconfigured, the client hides the enable-notifications control).
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'https://prismatix.tech',
  },
  // Pooled-multitenancy kill-switch (see docs/MULTITENANCY-POOLED-PLAN.md). OFF by default:
  // Phases 0–2 add tenant columns/backfill but do NOT filter queries, so single-tenant
  // behaviour is byte-identical while this is off. Phase 3 turns on the Prisma-extension
  // tenant scoping ONLY when this is true, dark-launched in staging first. Keep it a flag
  // (not a hard-coded const) so enforcement stays reversible until confidence is high.
  multitenancy: {
    enforce: process.env.MULTITENANCY_ENFORCE === 'true',
  },
} as const;

export const isProd = env.nodeEnv === 'production';
