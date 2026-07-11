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
} as const;

export const isProd = env.nodeEnv === 'production';
