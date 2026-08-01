import { env } from '../config/env.js';

// Cloudflare Turnstile CAPTCHA verification. The feature is OPT-IN per deployment: it's active only
// when TURNSTILE_SECRET_KEY is set (like Google gating on GOOGLE_CLIENT_ID). When off, the guards
// no-op so dev / LAN-by-IP behave exactly as before.
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function captchaEnabled(): boolean {
  return env.turnstile.secretKey !== '';
}

// Verify a Turnstile token server-side against Cloudflare's siteverify. Returns true on success.
// Fails CLOSED: any network/parse error → false (a real user simply retries; a bot is blocked).
export async function verifyTurnstile(token: string, remoteIp?: string): Promise<boolean> {
  if (!captchaEnabled()) return true; // disabled → nothing to verify
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: env.turnstile.secretKey, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
