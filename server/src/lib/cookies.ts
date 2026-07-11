import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

// Cookie names. The access + refresh tokens are httpOnly (JS cannot read them, so an XSS
// can't steal them); the CSRF token is deliberately readable by JS so the SPA can echo it
// back in a header (the double-submit pattern).
export const AT_COOKIE = 'prima_at';
export const RT_COOKIE = 'prima_rt';
export const CSRF_COOKIE = 'prima_csrf';

// The refresh cookie is scoped to the auth endpoints so it's only ever sent where it's
// needed (rotation), never on ordinary API calls.
const RT_PATH = '/api/v1/auth';

// Parse a simple "<n><unit>" TTL (m/h/d/s) into milliseconds for the cookie maxAge. Mirrors
// the JWT_ACCESS_TTL / JWT_REFRESH_TTL values; falls back to a sane default on anything odd.
function ttlToMs(ttl: string, fallbackMs: number): number {
  const m = /^(\d+)\s*([smhd])$/.exec(ttl.trim());
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return n * unit;
}

const AT_MAX_AGE = ttlToMs(env.jwt.accessTtl, 15 * 60_000);
const RT_MAX_AGE = ttlToMs(env.jwt.refreshTtl, 7 * 86_400_000);

// Shared attributes: SameSite=Strict is itself a strong CSRF defence (the cookie is not sent
// on cross-site requests); Secure is gated on SECURE=true so the cookie still works on the
// plain-http LAN / localhost dev (browsers treat http://localhost + 127.0.0.1 as secure
// contexts, so Secure cookies are accepted there even without the flag).
function base(httpOnly: boolean) {
  return { httpOnly, secure: env.secure, sameSite: 'strict' as const };
}

// Set the auth cookie trio after a successful login / refresh / password change. A fresh
// random CSRF token is minted each time so it rotates alongside the session.
export function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }): void {
  res.cookie(AT_COOKIE, tokens.accessToken, { ...base(true), path: '/', maxAge: AT_MAX_AGE });
  res.cookie(RT_COOKIE, tokens.refreshToken, { ...base(true), path: RT_PATH, maxAge: RT_MAX_AGE });
  res.cookie(CSRF_COOKIE, randomBytes(32).toString('hex'), { ...base(false), path: '/', maxAge: RT_MAX_AGE });
}

// Clear the auth cookies on logout. clearCookie must be given the same path the cookie was
// set with, or the browser keeps it.
export function clearAuthCookies(res: Response): void {
  res.clearCookie(AT_COOKIE, { ...base(true), path: '/' });
  res.clearCookie(RT_COOKIE, { ...base(true), path: RT_PATH });
  res.clearCookie(CSRF_COOKIE, { ...base(false), path: '/' });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      cookies?: Record<string, string>;
    }
  }
}

// Minimal cookie parser: populates req.cookies from the Cookie header. Kept in-house (no
// cookie-parser dependency) — the format is trivial and this avoids a supply-chain add.
export function cookieParser(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.cookie;
  const jar: Record<string, string> = {};
  if (header) {
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const name = part.slice(0, eq).trim();
      if (!name) continue;
      const raw = part.slice(eq + 1).trim();
      try {
        jar[name] = decodeURIComponent(raw);
      } catch {
        jar[name] = raw;
      }
    }
  }
  req.cookies = jar;
  next();
}
