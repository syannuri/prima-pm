import type { NextFunction, Request, Response } from 'express';
import { TooManyRequests } from '../lib/errors.js';

// Tiny dependency-free, in-memory rate limiter for the auth endpoints.
// Keyed per client IP, plus any extra dimensions supplied via `keyBy` (login also throttles
// per target email). A request is blocked when ANY of its dimensions is over the limit, and
// each failure increments every dimension — so one IP stuffing many accounts is caught on the
// IP bucket, and many IPs targeting one account are caught on that account's email bucket.
// Designed not to hurt legitimate users: only FAILED responses (HTTP >= 400) count toward the
// limit, and any success clears every dimension for that request. In-memory is fine for the
// single-process LAN deployment; counters reset on restart and per window.

interface Bucket {
  count: number;
  resetAt: number;
}

interface Options {
  windowMs: number; // sliding fixed-window length
  max: number; // max failed attempts per window before blocking
  name: string; // namespace so /login and /refresh don't share a bucket
  // Extra throttle dimensions besides the client IP (e.g. `email:<addr>` for login). Undefined
  // entries are skipped, so a request missing that field still gets IP throttling.
  keyBy?: (req: Request) => Array<string | undefined>;
}

export function authRateLimit({ windowMs, max, name, keyBy }: Options) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();

    // Opportunistic prune so the map can't grow unbounded.
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
    }

    // Client IP plus any extra dimensions; de-duped so a repeated value isn't double-counted.
    const dims = [req.ip ?? 'unknown', ...(keyBy?.(req) ?? [])].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    const keys = [...new Set(dims)].map((d) => `${name}:${d}`);

    const active = keys.map((key) => {
      let bucket = buckets.get(key);
      if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      return bucket;
    });

    // Block if ANY dimension is over its limit; report the longest wait.
    const blocked = active.filter((b) => b.count >= max);
    if (blocked.length) {
      const resetAt = Math.max(...blocked.map((b) => b.resetAt));
      res.setHeader('Retry-After', Math.ceil((resetAt - now) / 1000));
      throw TooManyRequests('Too many attempts. Please wait a moment and try again.');
    }

    // Count only failures; a success clears every dimension for this request.
    res.on('finish', () => {
      if (res.statusCode >= 400) {
        for (const b of active) b.count += 1;
      } else {
        for (const key of keys) buckets.delete(key);
      }
    });

    next();
  };
}

// --- Per-TENANT throughput limiter (Phase 5) -------------------------------------------------
// A fixed-window request budget PER TENANT so one workspace (or a runaway client in it) can't
// monopolize the shared server or hammer the API. Unlike authRateLimit this counts EVERY request
// (not just failures), keyed by the active tenant. Called from requireAuth once req.user.tid is
// resolved, so it needs no per-router wiring. In-memory (single process); resets per window / on
// restart. Live env config so limits are tunable without a rebuild; set max<=0 to disable.
export function tenantRateLimitConfig(): { windowMs: number; max: number } {
  return {
    windowMs: Number(process.env.TENANT_RATE_LIMIT_WINDOW_MS) || 60_000,
    max: Number(process.env.TENANT_RATE_LIMIT_MAX ?? 600),
  };
}

const tenantBuckets = new Map<string, Bucket>();

export function enforceTenantRate(tenantId: string, res: Response): void {
  const { windowMs, max } = tenantRateLimitConfig();
  if (max <= 0) return; // disabled
  const now = Date.now();
  if (tenantBuckets.size > 10_000) {
    for (const [k, b] of tenantBuckets) if (now > b.resetAt) tenantBuckets.delete(k);
  }
  let bucket = tenantBuckets.get(tenantId);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    tenantBuckets.set(tenantId, bucket);
  }
  if (bucket.count >= max) {
    res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
    throw TooManyRequests('This workspace is sending requests too quickly. Please slow down.');
  }
  bucket.count += 1;
}
