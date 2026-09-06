import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { Button, Card, Field, Input, SectionTitle, Toggle } from './ui';
import { useToast } from './Toast';

// Tenant-ADMIN builder for project custom fields (Tier-3). Lists existing definitions and lets an admin
// add, archive/restore, or delete them. Values are captured per project on the project's Overview.
interface FieldDef {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[] | null;
  required: boolean;
  sortOrder: number;
  archived: boolean;
}

const TYPES = ['text', 'number', 'date', 'boolean', 'select'] as const;

export default function CustomFieldsAdminCard() {
  const toast = useToast();
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // new-field form
  const [label, setLabel] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('text');
  const [optionsText, setOptionsText] = useState('');
  const [required, setRequired] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ defs: FieldDef[] }>('/custom-fields/defs?entity=project&includeArchived=true');
      setDefs(res.defs);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not load custom fields');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      const options = type === 'select'
        ? optionsText.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      await api.post('/custom-fields/defs', { entity: 'project', label: label.trim(), type, options, required });
      setLabel(''); setType('text'); setOptionsText(''); setRequired(false);
      toast.success('Custom field added');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not add the field');
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async (d: FieldDef) => {
    try {
      await api.put(`/custom-fields/defs/${d.id}`, { archived: !d.archived });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not update the field');
    }
  };

  const remove = async (d: FieldDef) => {
    if (!confirm(`Delete "${d.label}" and all its saved values? This cannot be undone.`)) return;
    try {
      await api.del(`/custom-fields/defs/${d.id}`);
      toast.success('Custom field deleted');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not delete the field');
    }
  };

  const selectClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <Card>
      <SectionTitle sub="Add your own fields to projects (e.g. Business Unit, Client Ref, Cost Centre). Admins define them here; teams fill them in on each project’s Overview.">
        Custom fields
      </SectionTitle>

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : defs.length === 0 ? (
          <p className="text-sm text-slate-500">No custom fields yet. Add one below.</p>
        ) : (
          defs.map((d) => (
            <div key={d.id} className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${d.archived ? 'border-slate-200 bg-slate-50 opacity-60 dark:border-slate-700 dark:bg-slate-900' : 'border-slate-200 dark:border-slate-700'}`}>
              <span className="font-medium text-slate-800 dark:text-slate-100">{d.label}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{d.type}</span>
              {d.required && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">required</span>}
              {d.type === 'select' && d.options && <span className="truncate text-xs text-slate-400">{d.options.join(' · ')}</span>}
              {d.archived && <span className="text-xs text-slate-400">archived</span>}
              <div className="ml-auto flex items-center gap-3">
                <button onClick={() => toggleArchive(d)} className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                  {d.archived ? 'Restore' : 'Archive'}
                </button>
                <button onClick={() => remove(d)} className="text-xs font-medium text-red-500 hover:text-red-600">Delete</button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-5 space-y-3 rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-600">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Add a field</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Business Unit" /></Field>
          <Field label="Type">
            <select className={selectClass} value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        {type === 'select' && (
          <Field label="Options (comma-separated)">
            <Input value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder="Retail, Wholesale, Online" />
          </Field>
        )}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Toggle checked={required} onChange={setRequired} /> Required
          </label>
          <Button type="button" onClick={add} disabled={busy || !label.trim()}>{busy ? 'Adding…' : 'Add field'}</Button>
        </div>
      </div>
    </Card>
  );
}
