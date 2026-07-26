import { useEffect, useState } from 'react';
import { pushState, enablePush, disablePush, type PushState } from '../lib/push';
import { useToast } from './Toast';

// A small "Enable notifications" control for the Messages page. Hidden unless push is supported AND
// configured on the server. Lets the user subscribe/unsubscribe this browser to Web-Push.
export default function PushToggle() {
  const toast = useToast();
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => { pushState().then(setState).catch(() => setState('unsupported')); }, []);

  // Nothing to show when unsupported, not configured on the server, or still loading.
  if (state === 'loading' || state === 'unsupported' || state === 'unconfigured') return null;

  if (state === 'denied') {
    return <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-2 text-xs text-slate-400 dark:border-slate-700" title="Notifications are blocked in your browser settings">🔕 Notifications blocked</span>;
  }

  const on = state === 'subscribed';
  const toggle = async () => {
    setBusy(true);
    try {
      const next = on ? await disablePush() : await enablePush();
      setState(next);
      if (next === 'subscribed') toast.success('Push notifications enabled');
      else if (on && next === 'available') toast.info('Push notifications disabled');
      else if (next === 'denied') toast.error('Notifications are blocked in your browser');
    } catch {
      toast.error('Could not change notification settings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button onClick={toggle} disabled={busy} title={on ? 'Push notifications on — click to turn off' : 'Get notified of new messages even when the app is closed'}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition disabled:opacity-50 ${on ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
      <span className="text-base leading-none">{on ? '🔔' : '🔕'}</span>
      {busy ? '…' : on ? 'Notifications on' : 'Enable notifications'}
    </button>
  );
}
