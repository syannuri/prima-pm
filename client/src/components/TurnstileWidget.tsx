import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    turnstile?: any;
  }
}

// Cloudflare Turnstile script — loaded on demand, shared across widgets. Mirrors LoginPage.
let turnstilePromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (turnstilePromise) return turnstilePromise;
  turnstilePromise = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Turnstile'));
    document.head.appendChild(s);
  });
  return turnstilePromise;
}

// Renders the CAPTCHA widget when the deployment has Turnstile enabled (site key from /auth/providers)
// and reports the token via onToken ('' on expiry/error). Calls onEnabled(true/false) once the config
// is known so the caller can gate submit. Renders nothing when CAPTCHA is off. Reusable across the
// public forms (used by ForgotPasswordPage; LoginPage keeps its own inline copy).
export default function TurnstileWidget({ onToken, onEnabled }: { onToken: (t: string) => void; onEnabled?: (enabled: boolean) => void }) {
  const [siteKey, setSiteKey] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ turnstile?: { enabled: boolean; siteKey: string } }>('/auth/providers')
      .then((p) => {
        if (cancelled) return;
        const on = Boolean(p.turnstile?.enabled && p.turnstile.siteKey);
        onEnabled?.(on);
        if (on) setSiteKey(p.turnstile!.siteKey);
      })
      .catch(() => { if (!cancelled) onEnabled?.(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !window.turnstile || !ref.current || widgetId.current) return;
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          theme: 'light',
          callback: (t: string) => onToken(t),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={ref} className="mt-1" />;
}
