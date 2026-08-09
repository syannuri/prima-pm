import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Badge, Button, Card, Field, Input, SectionTitle, Spinner } from './ui';
import { useToast } from './Toast';

interface Subscription {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}
interface CreatedSubscription extends Subscription { secret: string }
interface Delivery {
  id: string;
  subscriptionId: string;
  event: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');
const statusColor = (s: Delivery['status']) => (s === 'SUCCESS' ? 'green' : s === 'FAILED' ? 'red' : 'amber');

// Tenant-ADMIN card to manage outbound webhooks (T3.3). Create returns the signing secret ONCE —
// surfaced in a copyable banner. Also shows recent delivery attempts (the log/retry queue).
export default function WebhooksCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [allEvents, setAllEvents] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedSubscription | null>(null);

  const events = useQuery({ queryKey: ['webhook-events'], queryFn: () => api.get<{ events: string[] }>('/webhooks/events') });
  const subs = useQuery({ queryKey: ['webhooks'], queryFn: () => api.get<{ subscriptions: Subscription[] }>('/webhooks') });
  const deliveries = useQuery({ queryKey: ['webhook-deliveries'], queryFn: () => api.get<{ deliveries: Delivery[] }>('/webhooks/deliveries') });

  const chosenEvents = allEvents ? ['*'] : selected;

  const create = useMutation({
    mutationFn: () => api.post<CreatedSubscription>('/webhooks', { url: url.trim(), events: chosenEvents }),
    onSuccess: (s) => {
      setJustCreated(s);
      setUrl(''); setSelected([]); setAllEvents(false);
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not create the webhook'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/webhooks/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['webhooks'] }); toast.success('Webhook deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not delete the webhook'),
  });

  const copy = async (v: string) => {
    try { await navigator.clipboard.writeText(v); toast.success('Copied to clipboard'); }
    catch { toast.error('Could not copy — select and copy manually'); }
  };

  const toggleEvent = (ev: string) =>
    setSelected((cur) => (cur.includes(ev) ? cur.filter((e) => e !== ev) : [...cur, ev]));

  const urlOk = /^https:\/\/.+/.test(url.trim());
  const canCreate = urlOk && chosenEvents.length > 0 && !create.isPending;

  const subList = subs.data?.subscriptions ?? [];
  const log = deliveries.data?.deliveries ?? [];

  return (
    <Card>
      <SectionTitle sub="Get a signed HTTPS POST when things happen in your workspace. Verify deliveries with the X-Prismatix-Signature header.">
        Webhooks
      </SectionTitle>

      {justCreated && (
        <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-900/20">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Copy your signing secret now — it won’t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-xs text-slate-800 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700">{justCreated.secret}</code>
            <Button type="button" onClick={() => copy(justCreated.secret)}>Copy</Button>
          </div>
          <button onClick={() => setJustCreated(null)} className="mt-2 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-300">Done</button>
        </div>
      )}

      {/* Create form */}
      <form onSubmit={(e) => { e.preventDefault(); if (canCreate) create.mutate(); }} className="mt-3 space-y-3">
        <Field label="Endpoint URL" hint="Must be https.">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.acme.com/prismatix-hook" state={url ? (urlOk ? 'valid' : 'invalid') : undefined} />
        </Field>
        <div>
          <div className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">Events</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={allEvents} onChange={(e) => setAllEvents(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              All events (*)
            </label>
            {(events.data?.events ?? []).map((ev) => (
              <label key={ev} className={`flex items-center gap-2 text-sm ${allEvents ? 'text-slate-400 dark:text-slate-600' : 'text-slate-700 dark:text-slate-300'}`}>
                <input type="checkbox" disabled={allEvents} checked={selected.includes(ev)} onChange={() => toggleEvent(ev)} className="h-4 w-4 rounded border-slate-300" />
                <code className="font-mono text-xs">{ev}</code>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={!canCreate}>{create.isPending ? 'Creating…' : 'Add webhook'}</Button>
        </div>
      </form>

      {/* Subscriptions */}
      <div className="mt-4">
        {subs.isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : subList.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">No webhooks yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {subList.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{s.url}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    {s.events.map((ev) => <Badge key={ev} color="slate">{ev}</Badge>)}
                    <span>· Added {fmt(s.createdAt)}</span>
                  </div>
                </div>
                <Button type="button" variant="ghost" onClick={() => { if (confirm(`Delete this webhook? ${s.url} will stop receiving events.`)) remove.mutate(s.id); }} disabled={remove.isPending}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent deliveries */}
      {log.length > 0 && (
        <div className="mt-5">
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Recent deliveries</h4>
            <button onClick={() => qc.invalidateQueries({ queryKey: ['webhook-deliveries'] })} className="text-xs font-medium text-brand-600 hover:underline">Refresh</button>
          </div>
          <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
            {log.slice(0, 10).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
                <Badge color={statusColor(d.status)}>{d.status}</Badge>
                <code className="font-mono text-slate-700 dark:text-slate-200">{d.event}</code>
                <span className="text-slate-500 dark:text-slate-400">{fmt(d.createdAt)}</span>
                <span className="text-slate-400">· {d.attempts} attempt{d.attempts === 1 ? '' : 's'}</span>
                {d.responseStatus != null && <span className="text-slate-400">· HTTP {d.responseStatus}</span>}
                {d.error && <span className="truncate text-red-500">· {d.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
