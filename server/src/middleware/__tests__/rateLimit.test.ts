import { describe, it, expect, vi } from 'vitest';
import { authRateLimit } from '../rateLimit.js';

// A fake response that captures the res.on('finish') callback so the test can
// drive the "did this request fail?" accounting the limiter relies on.
function mkRes(statusCode: number) {
  let finishCb: (() => void) | null = null;
  return {
    statusCode,
    on: (ev: string, cb: () => void) => { if (ev === 'finish') finishCb = cb; },
    setHeader: () => {},
    finish() { finishCb?.(); },
  };
}

const req = (ip = '10.0.0.1', email?: string) => ({ ip, body: email ? { email } : {} } as any);

describe('authRateLimit', () => {
  // Run one request; returns true if the limiter blocked it (threw 429).
  const attempt = (mw: any, ip: string, status: number): boolean => {
    const res = mkRes(status);
    const next = vi.fn();
    try {
      mw(req(ip), res as any, next);
    } catch {
      return true; // blocked before reaching the handler
    }
    expect(next).toHaveBeenCalledWith();
    res.finish(); // emit res 'finish' so the limiter records the outcome
    return false;
  };

  it('allows up to `max` failed attempts, then blocks with 429', () => {
    const mw = authRateLimit({ windowMs: 60_000, max: 2, name: 'login' });
    expect(attempt(mw, 'a', 401)).toBe(false); // 1st failure
    expect(attempt(mw, 'a', 401)).toBe(false); // 2nd failure
    expect(attempt(mw, 'a', 401)).toBe(true); // 3rd → blocked
  });

  it('a successful response clears the failure streak (full budget restored)', () => {
    const mw = authRateLimit({ windowMs: 60_000, max: 2, name: 'login' });
    expect(attempt(mw, 'b', 401)).toBe(false); // 1 failure (under the limit)
    expect(attempt(mw, 'b', 200)).toBe(false); // success → resets the bucket
    // Full budget of 2 failures is available again, blocked only on the 3rd.
    expect(attempt(mw, 'b', 401)).toBe(false);
    expect(attempt(mw, 'b', 401)).toBe(false);
    expect(attempt(mw, 'b', 401)).toBe(true);
  });

  it('tracks limits independently per IP', () => {
    const mw = authRateLimit({ windowMs: 60_000, max: 1, name: 'login' });
    expect(attempt(mw, '1.1.1.1', 401)).toBe(false); // IP A now at the limit
    expect(attempt(mw, '1.1.1.1', 401)).toBe(true); // A blocked
    expect(attempt(mw, '2.2.2.2', 401)).toBe(false); // B unaffected
  });

  // Login throttles per-email too, so a distributed attack on one account is caught even
  // when every attempt comes from a fresh IP.
  const emailKeyBy = (r: any) => [`email:${r.body?.email}`];
  const attemptWith = (mw: any, ip: string, email: string, status: number): boolean => {
    const res = mkRes(status);
    const next = vi.fn();
    try {
      mw(req(ip, email), res as any, next);
    } catch {
      return true;
    }
    res.finish();
    return false;
  };

  it('blocks per target email across different IPs', () => {
    const mw = authRateLimit({ windowMs: 60_000, max: 2, name: 'login', keyBy: emailKeyBy });
    expect(attemptWith(mw, '1.1.1.1', 'victim@x.io', 401)).toBe(false); // email count 1
    expect(attemptWith(mw, '2.2.2.2', 'victim@x.io', 401)).toBe(false); // email count 2 (new IP)
    expect(attemptWith(mw, '3.3.3.3', 'victim@x.io', 401)).toBe(true); // email over limit despite fresh IP
    // A different account from a fresh IP is unaffected.
    expect(attemptWith(mw, '4.4.4.4', 'other@x.io', 401)).toBe(false);
  });

  it('a successful login clears both the IP and email dimensions', () => {
    const mw = authRateLimit({ windowMs: 60_000, max: 2, name: 'login', keyBy: emailKeyBy });
    expect(attemptWith(mw, '9.9.9.9', 'user@x.io', 401)).toBe(false); // email+ip count 1
    expect(attemptWith(mw, '9.9.9.9', 'user@x.io', 200)).toBe(false); // success resets both
    // Full budget restored on both dimensions.
    expect(attemptWith(mw, '9.9.9.9', 'user@x.io', 401)).toBe(false);
    expect(attemptWith(mw, '9.9.9.9', 'user@x.io', 401)).toBe(false);
    expect(attemptWith(mw, '9.9.9.9', 'user@x.io', 401)).toBe(true);
  });
});
