import { describe, it, expect, afterEach } from 'vitest';
import { scrubEvent, sentryEnabled, captureError, __setErrorSink } from '../observability.js';

// Unit — the Phase 2 error-tracking logic (PII scrubber, dormant gate, capture routing) without any
// network or DSN. Sentry.init is never called here.

describe('scrubEvent (PII scrubber / beforeSend)', () => {
  it('strips body, cookies, and auth/cookie headers; keeps benign headers', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ev: any = {
      request: {
        method: 'POST',
        url: '/x',
        data: { password: 'secret' },
        cookies: 'sid=abc',
        headers: { Authorization: 'Bearer x', Cookie: 'sid=abc', 'content-type': 'application/json' },
      },
      user: { id: 'u1', email: 'a@b.com', ip_address: '1.2.3.4' },
    };
    const out = scrubEvent(ev)!;
    expect(out.request!.data).toBeUndefined();
    expect(out.request!.cookies).toBeUndefined();
    expect(out.request!.headers!.Authorization).toBeUndefined();
    expect(out.request!.headers!.Cookie).toBeUndefined();
    expect(out.request!.headers!['content-type']).toBe('application/json'); // benign kept
    expect(out.user).toEqual({ id: 'u1' }); // email + ip dropped, opaque id kept
  });

  it('drops the user entirely when there is no id', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = scrubEvent({ user: { email: 'a@b.com' } } as any)!;
    expect(out.user).toBeUndefined();
  });
});

describe('sentryEnabled (dormant gate)', () => {
  const prev = process.env.SENTRY_DSN;
  afterEach(() => { if (prev === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = prev; });
  it('reflects SENTRY_DSN live', () => {
    delete process.env.SENTRY_DSN;
    expect(sentryEnabled()).toBe(false);
    process.env.SENTRY_DSN = 'https://k@example/1';
    expect(sentryEnabled()).toBe(true);
  });
});

describe('captureError routing', () => {
  afterEach(() => __setErrorSink(null));
  it('routes err + context to the injected sink (no Sentry, no network)', () => {
    const calls: Array<{ err: unknown; ctx: Record<string, unknown> }> = [];
    __setErrorSink((err, ctx) => calls.push({ err, ctx }));
    const e = new Error('boom');
    captureError(e, { reqId: 'r1', status: 500, tenantId: 't1', userId: 'u1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].err).toBe(e);
    expect(calls[0].ctx).toMatchObject({ reqId: 'r1', status: 500, tenantId: 't1', userId: 'u1' });
  });
});
