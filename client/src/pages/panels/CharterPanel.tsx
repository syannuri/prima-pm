import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Charter, DeliveryApproach, ProjectCategory, User } from '../../api/types';
import { Badge, Button, Card, Field, Input, MoneyInput, SectionTitle, Select, Spinner, Textarea } from '../../components/ui';
import { useConfirm } from '../../components/ConfirmDialog';
import { DELIVERY_APPROACH_LABEL, PROJECT_CATEGORIES } from '../../lib/labels';
import { formatDateInput } from '../../lib/format';

const APPROACHES: DeliveryApproach[] = ['PREDICTIVE', 'AGILE', 'HYBRID'];
import Attachments from '../../components/Attachments';

type Form = {
  description: string;
  goals: string;
  category: ProjectCategory;
  hiScope: string;
  hiCostIdr: string;
  hiScheduleStart: string;
  hiScheduleEnd: string;
  hiDeliverables: string;
  pmUserId: string;
};

const empty: Form = {
  description: '', goals: '', category: 'APP_DEV', hiScope: '', hiCostIdr: '',
  hiScheduleStart: '', hiScheduleEnd: '', hiDeliverables: '', pmUserId: '',
};

export default function CharterPanel({ projectId, approach: initialApproach, sponsor: initialSponsor, personalOwnerId, assignedPmId, assignedPmName }: { projectId: string; approach: DeliveryApproach; sponsor: string | null; personalOwnerId?: string | null; assignedPmId?: string | null; assignedPmName?: string | null }) {
  const qc = useQueryClient();
  // The PM is set once, upstream: by the guest owner (personal project) or by the PMO when the
  // project is created/assigned (corporate). Default the charter's PM to that so it isn't
  // re-entered here, and show it read-only (changing the PM is a separate PMO/assign action).
  const [form, setForm] = useState<Form>({ ...empty, pmUserId: personalOwnerId ?? assignedPmId ?? '' });
  const [approach, setApproach] = useState<DeliveryApproach>(initialApproach);
  const [sponsor, setSponsor] = useState<string>(initialSponsor ?? '');
  // Free-text detail, required only when category = OTHER. Kept out of `form` so it doesn't
  // count toward the "all fields filled" gate for the other 13 categories.
  const [categoryOther, setCategoryOther] = useState('');
  const [msg, setMsg] = useState('');
  const confirm = useConfirm();
  useEffect(() => { setApproach(initialApproach); }, [initialApproach]);
  useEffect(() => { setSponsor(initialSponsor ?? ''); }, [initialSponsor]);

  const charterQ = useQuery({
    queryKey: ['charter', projectId],
    queryFn: () => api.get<{ charter: Charter | null }>(`/projects/${projectId}/charter`),
  });
  const usersQ = useQuery({
    queryKey: ['directory'],
    queryFn: () => api.get<{ users: User[] }>('/users/directory'),
    enabled: !personalOwnerId && !assignedPmId, // directory only needed for the fallback PM picker
  });

  const charter = charterQ.data?.charter;
  const locked = charter?.locked ?? false;

  useEffect(() => {
    if (charter) {
      setForm({
        description: charter.description,
        goals: charter.goals,
        category: charter.category,
        hiScope: charter.hiScope,
        hiCostIdr: String(Number(charter.hiCostIdr)),
        hiScheduleStart: formatDateInput(charter.hiScheduleStart),
        hiScheduleEnd: formatDateInput(charter.hiScheduleEnd),
        hiDeliverables: charter.hiDeliverables,
        // The assigned PM (personal owner / PMO-assigned) is authoritative and shown read-only,
        // so keep it in sync rather than reading a possibly-stale charter snapshot.
        pmUserId: personalOwnerId ?? assignedPmId ?? charter.pmUserId,
      });
      setCategoryOther(charter.categoryOther ?? '');
    }
  }, [charter, personalOwnerId, assignedPmId]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/projects/${projectId}/charter`, { ...form, categoryOther: form.category === 'OTHER' ? (categoryOther.trim() || null) : null, hiCostIdr: Number(form.hiCostIdr), deliveryApproach: approach, sponsor: sponsor.trim() || null }),
    onSuccess: () => {
      setMsg('Charter saved (draft).');
      qc.invalidateQueries({ queryKey: ['charter', projectId] });
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : 'Save failed'),
  });

  const commit = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/charter/commit`),
    onSuccess: () => {
      setMsg('Charter committed — modules unlocked.');
      qc.invalidateQueries({ queryKey: ['charter', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['next-steps', projectId] });
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : 'Commit failed'),
  });

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const allFilled =
    Object.values(form).every((v) => String(v).trim() !== '') &&
    Number(form.hiCostIdr) > 0 &&
    (form.category !== 'OTHER' || categoryOther.trim() !== '');
  const commitCharter = async () => {
    if (await confirm({
      title: 'Commit charter?',
      message: 'Committing locks the charter baseline and unlocks Cost, Risk & Schedule. After this, changes require a Change Request.',
      confirmLabel: 'Commit charter',
    })) commit.mutate();
  };

  if (charterQ.isLoading) return <Spinner />;

  return (
    <div className="space-y-5">
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <SectionTitle sub="All fields are mandatory. Commit locks the baseline and unlocks Cost, Risk & Schedule.">
          Project Charter
        </SectionTitle>
        {charter && (
          <div className="flex items-center gap-2">
            <Badge color={locked ? 'green' : 'amber'}>{locked ? `Committed v${charter.version}` : 'Draft'}</Badge>
          </div>
        )}
      </div>

      <fieldset disabled={locked} className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Project Description">
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        <Field label="Project Goals">
          <Textarea value={form.goals} onChange={(e) => set('goals', e.target.value)} />
        </Field>
        <Field label="High-Level Scope of Work">
          <Textarea value={form.hiScope} onChange={(e) => set('hiScope', e.target.value)} />
        </Field>
        <Field label="Project Category">
          <Select value={form.category} onChange={(e) => set('category', e.target.value)}>
            {PROJECT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
          {form.category === 'OTHER' && (
            <Input className="mt-2" value={categoryOther} onChange={(e) => setCategoryOther(e.target.value)} placeholder="Describe the category" />
          )}
        </Field>
        <Field label="Delivery Approach" hint="Locked at commit — change later via a Change Request">
          <Select value={approach} onChange={(e) => setApproach(e.target.value as DeliveryApproach)}>
            {APPROACHES.map((a) => <option key={a} value={a}>{DELIVERY_APPROACH_LABEL[a]}</option>)}
          </Select>
        </Field>
        {/* Personal (guest) → hidden (owner is the PM). Corporate with an assigned PM (from the
            PMO at create/assign) → read-only, no re-entry. Corporate not yet assigned → pick one. */}
        {personalOwnerId ? null : assignedPmId ? (
          <Field label="Project Manager" hint="Set by the PMO when the project was assigned">
            <Input value={assignedPmName ?? '—'} disabled />
          </Field>
        ) : (
          <Field label="Project Manager">
            <Select value={form.pmUserId} onChange={(e) => set('pmUserId', e.target.value)}>
              <option value="">— select PM —</option>
              {usersQ.data?.users.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Project Sponsor" hint="The authorizing party who funds & champions the project">
          <Input value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="e.g. CISO Office / CTO" />
        </Field>
        <Field label="High-Level Project Cost (IDR)">
          <MoneyInput value={form.hiCostIdr} onValueChange={(v) => set('hiCostIdr', v)} placeholder="e.g. 1.000.000.000" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Schedule Start">
            <Input type="date" value={form.hiScheduleStart} onChange={(e) => set('hiScheduleStart', e.target.value)} />
          </Field>
          <Field label="Schedule End">
            <Input type="date" value={form.hiScheduleEnd} onChange={(e) => set('hiScheduleEnd', e.target.value)} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="High-Level Deliverables / Expected Outcome">
            <Textarea value={form.hiDeliverables} onChange={(e) => set('hiDeliverables', e.target.value)} />
          </Field>
        </div>
      </fieldset>

      {msg && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{msg}</p>}

      <div className="mt-5 flex items-center gap-2">
        {!locked && (
          <>
            <Button variant="secondary" onClick={() => save.mutate()} disabled={save.isPending}>
              Save draft
            </Button>
            <Button onClick={commitCharter} disabled={!charter || !allFilled || commit.isPending}>
              {commit.isPending ? 'Committing…' : 'Commit Charter'}
            </Button>
            {!charter && <span className="text-xs text-slate-500 dark:text-slate-400">Save the draft first, then Commit.</span>}
            {charter && !allFilled && <span className="text-xs text-amber-500">Fill all fields to enable Commit.</span>}
          </>
        )}
        {locked && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Charter is locked. Changes require a Change Request (PMO approval).
          </p>
        )}
      </div>

      {charter && (
        <div className="mt-5">
          <Attachments projectId={projectId} ownerType="CHARTER" ownerId={charter.id} />
        </div>
      )}
    </Card>
    </div>
  );
}

