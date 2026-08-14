import pino from 'pino';
import * as Sentry from '@sentry/node';

// Release tag so logs (and Sentry events) group per deploy. Set APP_RELEASE to the git SHA at deploy
// time; falls back to 'dev' locally.
export const release = process.env.APP_RELEASE || 'dev';

// Structured JSON logger (Phase 1 of observability). Always on, zero external dependency — journald
// captures stdout, so `journalctl -u prima-pm -o cat | jq 'select(.status>=500)'` becomes queryable.
// LOG_LEVEL tunes verbosity (default info). Redaction is defense-in-depth so a stray object carrying
// a secret never lands in the logs.
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'prima-pm', release },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.secret',
      '*.apiKey',
    ],
    remove: true,
  },
});

// Error tracking (Phase 2) is DORMANT until SENTRY_DSN is set — reads process.env live, like
// aiEnabled()/billingEnabled(). Unset ⇒ Sentry is never initialised and captureError just logs.
export function sentryEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

// beforeSend scrubber — strips request bodies, auth headers and cookies, and reduces the user to an
// opaque id (no email/name/ip). PURE + exported so it can be unit-tested. sendDefaultPii is also off.
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    const h = event.request.headers;
    if (h) {
      for (const k of Object.keys(h)) {
        if (/^(authorization|cookie|x-csrf-token)$/i.test(k)) delete h[k];
      }
    }
  }
  event.user = event.user?.id ? { id: String(event.user.id) } : undefined;
  return event;
}

// Initialise Sentry once at process start (before createApp). No-op when the DSN is unset.
export function initSentry(): void {
  if (!sentryEnabled()) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENV || 'unknown',
    release,
    tracesSampleRate: 0, // errors only for the MVP — no performance tracing
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
  logger.info({ environment: process.env.SENTRY_ENV, release }, 'Sentry error tracking enabled');
}

// Test seam (mirrors __setAiNarrativePort / __setAutoDeliver): route captures to a fake sink so
// itests never hit the network or need a DSN.
type ErrorSink = (err: unknown, ctx: Record<string, unknown>) => void;
let sink: ErrorSink | null = null;
export function __setErrorSink(fn: ErrorSink | null): void {
  sink = fn;
}

// Central error sink: always logs (structured), and — when enabled — reports to Sentry with opaque
// tags/user (no PII). Called only from the 500 / unexpected path, so 4xx client faults stay quiet.
export function captureError(err: unknown, ctx: Record<string, unknown> = {}): void {
  logger.error({ err, ...ctx }, 'captured error');
  if (sink) {
    sink(err, ctx);
    return;
  }
  if (sentryEnabled()) {
    Sentry.captureException(err, {
      tags: { reqId: ctx.reqId as string, tenantId: ctx.tenantId as string },
      user: ctx.userId ? { id: String(ctx.userId) } : undefined,
      contexts: { request: { method: ctx.method, path: ctx.path, status: ctx.status } },
    });
  }
}
