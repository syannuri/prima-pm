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
  // Google "Sign in with Google" is enabled by setting GOOGLE_CLIENT_ID to the OAuth 2.0
  // Web client ID. When empty the endpoint 403s and the client hides the button. The Client
  // ID is not a secret (it ships in the browser), but gating on it keeps the feature opt-in
  // per deployment. New Google users are created as sandboxed GUESTs (like guest signup).
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
} as const;

export const isProd = env.nodeEnv === 'production';
