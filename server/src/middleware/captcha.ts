import type { Request, Response, NextFunction } from 'express';
import { captchaEnabled, verifyTurnstile } from '../lib/turnstile.js';
import { BadRequest } from '../lib/errors.js';

// Cloudflare Turnstile guard for the public signup / login forms. No-op unless the CAPTCHA is
// configured (TURNSTILE_SECRET_KEY). Runs BEFORE validateBody so it can read the raw `captchaToken`
// (the auth schemas strip unknown keys). A missing / invalid token → 400.
export async function verifyCaptcha(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!captchaEnabled()) return next();
  const token = (req.body as { captchaToken?: unknown })?.captchaToken;
  const ok = typeof token === 'string' && (await verifyTurnstile(token, req.ip));
  if (!ok) return next(BadRequest('CAPTCHA verification failed. Please try again.'));
  next();
}
