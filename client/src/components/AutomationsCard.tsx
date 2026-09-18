import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Role } from '../api/types';
import { Badge, Button, Field, Input, Select, Spinner } from './ui';
import { SettingsGroup } from './settingsUi';
import { useToast } from './Toast';

interface Rule {
  id: string;
  name: string;
  event: string;
  conditionField: string | null;
  conditionEquals: string | null;
  notifyPm: boolean;
  notifyRole: Role | null;
  messageTemplate: string | null;
}

const ROLES: Role[] = ['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER'];
const eventLabel = (e: string) => e.replace(/[._]/g, ' ');

// Tenant-ADMIN no-code automation rules: "when <event> [and <field> = <value>] → notify PM / role".
// Rides the same domain-event bus as webhooks; delivers in-app notifications.
export default function AutomationsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [event, setEvent] = useState('');
  const [notifyPm, setNotifyPm] = useState(true);
  const [notifyRole, setNotifyRole] = useState<Role | ''>('');
  const [condField, setCondField] = useState('');
  const [condEquals, setCondEquals] = useState('');
  const [message, setMessage] = useState('');

  const events = useQuery({ queryKey: ['automation-events'], queryFn: () => api.get<{ events: string[] }>('/automations/events') });
  const rulesQ = useQuery({ queryKey: ['automations'], queryFn: () => api.get<{ rules: Rule[] }>('/automations') });

  const create = useMutation({
    mutationFn: () => api.post<Rule>('/automations', {
      name: name.trim(),
      event,
      notifyPm,
      notifyRole: notifyRole || null,
      conditionField: condField.trim() || null,
      conditionEquals: condField.trim() ? condEquals : null,
      messageTemplate: message.trim() || null,
    }),
    onSuccess: () => {
      setName(''); setEvent(''); setNotifyPm(true); setNotifyRole(''); setCondField(''); setCondEquals(''); setMessage('');
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Automation added');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not create the automation'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/automations/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['automations'] }); toast.success('Automation deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not delete'),
  });

  const rules = rulesQ.data?.rules ?? [];
  const canCreate = name.trim().length > 0 && event && (notifyPm || notifyRole) && !create.isPending;

  return (
    <SettingsGroup title="Automations" sub="Run an action automatically when something happens — “when a risk is raised, notify the PMO”. Delivers in-app notifications; no code required.">

      <form onSubmit={(e) => { e.preventDefault(); if (canCreate) create.mutate(); }} className="mt-3 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alert PMO on new risk" maxLength={80} /></Field>
          </div>
          <div className="w-52">
            <Field label="When (event)">
              <Select value={event} onChange={(e) => setEvent(e.target.value)}>
                <option value="">Choose an event…</option>
                {(events.data?.events ?? []).map((ev) => <option key={ev} value={ev}>{eventLabel(ev)}</option>)}
              </Select>
            </Field>
          </div>
        </div>

        {/* Optional condition */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40">
            <Field label="Only if field" hint="optional, e.g. to"><Input value={condField} onChange={(e) => setCondField(e.target.value)} placeholder="field" /></Field>
          </div>
          <div className="w-40">
            <Field label="equals"><Input value={condEquals} onChange={(e) => setCondEquals(e.target.value)} placeholder="value" disabled={!condField.trim()} /></Field>
          </div>
        </div>

        {/* Recipients */}
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={notifyPm} onChange={(e) => setNotifyPm(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Notify the project PM
          </label>
          <div className="w-44">
            <Field label="…and/or a role">
              <Select value={notifyRole} onChange={(e) => setNotifyRole(e.target.value as Role | '')}>
                <option value="">— none —</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
          </div>
          <div className="min-w-[10rem] flex-1">
            <Field label="Message" hint="optional custom title"><Input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} /></Field>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={!canCreate}>{create.isPending ? 'Adding…' : 'Add automation'}</Button>
        </div>
      </form>

      <div className="mt-4">
        {rulesQ.isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : rules.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">No automations yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{r.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <Badge color="slate">{eventLabel(r.event)}</Badge>
                    {r.conditionField && <span>if {r.conditionField}={r.conditionEquals}</span>}
                    <span>→ notify {[r.notifyPm ? 'PM' : null, r.notifyRole].filter(Boolean).join(' + ')}</span>
                  </div>
                </div>
                <Button type="button" variant="ghost" onClick={() => { if (confirm(`Delete automation “${r.name}”?`)) remove.mutate(r.id); }} disabled={remove.isPending}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsGroup>
  );
}
