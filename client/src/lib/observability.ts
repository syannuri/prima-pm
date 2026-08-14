import * as Sentry from '@sentry/react';

// Client error tracking (observability Phase 2). DORMANT until VITE_SENTRY_DSN is set at BUILD time
// (Vite inlines import.meta.env). Unset ⇒ Sentry is never initialised and captureException is a
// no-op. The React SDK auto-installs global window.onerror + unhandledrejection handlers on init.
export function initClientSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENV as string) || 'unknown',
    release: (import.meta.env.VITE_APP_RELEASE as string) || undefined,
    tracesSampleRate: 0, // errors only — no performance tracing
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip cookies/auth and reduce the user to an opaque id (no email/name/ip).
      if (event.request) {
        delete event.request.cookies;
        const h = event.request.headers;
        if (h) for (const k of Object.keys(h)) if (/^(authorization|cookie)$/i.test(k)) delete h[k];
      }
      event.user = event.user?.id ? { id: String(event.user.id) } : undefined;
      return event;
    },
  });
}

// Safe to call unconditionally — a no-op when Sentry wasn't initialised (DSN unset).
export function captureException(err: unknown, extra?: Record<string, unknown>): void {
  Sentry.captureException(err, extra ? { extra } : undefined);
}
