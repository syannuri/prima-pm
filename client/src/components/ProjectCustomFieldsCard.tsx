import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { Button, Card, Field, Input, SectionTitle, Toggle } from './ui';
import { useToast } from './Toast';

// Per-project custom-field values (Tier-3). Renders the workspace's active project fields as an editable
// form; renders nothing when no fields are defined (so projects that don't use custom fields stay clean).
interface FieldWithValue {
  id: string; // definition id
  key: string;
  label: string;
  type: string;
  options: string[] | null;
  required: boolean;
  value: string | null;
}

export default function ProjectCustomFieldsCard({ projectId, canEdit = false }: { projectId: string; canEdit?: boolean }) {
  const toast = useToast();
  const [fields, setFields] = useState<FieldWithValue[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const hydrate = (rows: FieldWithValue[]) => {
    setFields(rows);
    setDraft(Object.fromEntries(rows.map((f) => [f.id, f.value ?? (f.type === 'boolean' ? 'false' : '')])));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ fields: FieldWithValue[] }>(`/projects/${projectId}/custom-fields`);
        if (!cancelled) hydrate(res.fields);
      } catch {
        // A project the user can't reach or a transient error — just don't render the card.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const set = (id: string, v: string) => setDraft((d) => ({ ...d, [id]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const values = fields.map((f) => ({ defId: f.id, value: draft[f.id] === '' ? null : draft[f.id] }));
      const res = await api.put<{ fields: FieldWithValue[] }>(`/projects/${projectId}/custom-fields`, { values });
      hydrate(res.fields);
      toast.success('Custom fields saved');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save custom fields');
    } finally {
      setSaving(false);
    }
  };

  // Nothing to show until we know there are fields.
  if (!loaded || fields.length === 0) return null;

  const selectClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <Card>
      <SectionTitle sub={canEdit ? 'Workspace-defined fields for this project.' : 'Workspace-defined fields (read-only for your role).'}>
        Custom fields
      </SectionTitle>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.id} label={f.label} required={f.required}>
            {f.type === 'boolean' ? (
              <Toggle checked={draft[f.id] === 'true'} onChange={(v) => set(f.id, String(v))} disabled={!canEdit} label={f.label} />
            ) : f.type === 'select' ? (
              <select className={selectClass} value={draft[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)} disabled={!canEdit}>
                <option value="">—</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <Input
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                value={draft[f.id] ?? ''}
                onChange={(e) => set(f.id, e.target.value)}
                disabled={!canEdit}
              />
            )}
          </Field>
        ))}
      </div>
      {canEdit && (
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
    </Card>
  );
}
