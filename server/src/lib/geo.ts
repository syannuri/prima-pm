import type { Request } from 'express';
import { prisma } from './prisma.js';

// Cloudflare sets CF-IPCountry to an ISO-3166-1 alpha-2 code (or 'XX' / 'T1' for unknown / Tor).
// Returns the 2-letter code, or null off-Cloudflare (LAN/dev) or when unknown. We read only the
// country — never the client IP.
export function readCountry(req: Request): string | null {
  const raw = req.headers['cf-ipcountry'];
  const code = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
  if (!code || code.length !== 2 || code === 'XX' || code === 'T1') return null;
  return code;
}

// Best-effort: record the user's country the FIRST time we see one (stable first-seen — avoids a
// write on every login). No-op when the country is unknown. Never throws (analytics must not break
// auth).
export async function captureUserCountry(userId: string, country: string | null): Promise<void> {
  if (!country) return;
  try {
    await prisma.user.updateMany({ where: { id: userId, country: null }, data: { country } });
  } catch {
    /* analytics only — swallow */
  }
}
