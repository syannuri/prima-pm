import type { NextFunction, Request, Response } from 'express';
import { TooManyRequests } from '../lib/errors.js';

// Tiny dependency-free, in-memory rate limiter for the auth endpoints.
// Keyed per client IP. Designed to throttle brute-force / credential-stuffing
// without hurting legitimate users: only FAILED responses (HTTP >= 400) count
// toward the limit, and any success clears the failure streak for that key.
// In-memory is fine for the single-process LAN deployment; counters reset on
// restart and per window.

interface Bucket {
  count: number;
  resetAt: number;
}

interface Options {
  windowMs: number; // sliding fixed-window length
  max: number; // max failed attempts per window before blocking
  name: string; // namespace so /login and /register don't share a bucket
}

export function authRateLimit({ windowMs, max, name }: Options) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = `${name}:${req.ip ?? 'unknown'}`;

    // Opportunistic prune so the map can't grow unbounded.
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
    }

    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count >= max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      throw TooManyRequests('Too many attempts. Please wait a moment and try again.');
    }

    // Count only failures; a success resets the streak for this key.
    res.on('finish', () => {
      if (res.statusCode >= 400) {
        bucket!.count += 1;
      } else {
        buckets.delete(key);
      }
    });

    next();
  };
}
