import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Charter, DeliveryApproach, ProjectCategory, User } from '../../api/types';
import { Badge, Button, Card, Field, Input, MoneyInput, SectionTitle, Select, Spinner, Textarea } from '../../components/ui';
import type { InputState } from '../../components/ui';
import { useConfirm } from '../../components/ConfirmDialog';
import { useLang } from '../../context/LanguageContext';
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
  const { lang } = useLang();
  const t = (id: string, en: string) => (lang === 'id' ? id : en);
  // Per-field validation surfacing: a required field warns once it's been touched (blurred),
  // and every missing field is revealed at once when the user tries to Save/Commit.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showAllErrors, setShowAllErrors] = useState(false);
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));
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

  // Which required fields are currently empty/invalid. `category` always has a value; only its
  // OTHER free-text detail can be missing. `sponsor` & attachments are optional (nullable server-side).
  const missing: Record<string, boolean> = {
    description: form.description.trim() === '',
    goals: form.goals.trim() === '',
    hiScope: form.hiScope.trim() === '',
    categoryOther: form.category === 'OTHER' && categoryOther.trim() === '',
    pmUserId: form.pmUserId.trim() === '',
    hiCostIdr: !(Number(form.hiCostIdr) > 0),
    hiScheduleStart: form.hiScheduleStart.trim() === '',
    hiScheduleEnd: form.hiScheduleEnd.trim() === '',
    hiDeliverables: form.hiDeliverables.trim() === '',
  };
  const showErr = (k: string) => missing[k] && (showAllErrors || !!touched[k]);
  const errText = (k: string, text?: string) => (showErr(k) ? (text ?? t('Field ini wajib diisi', 'This field is required')) : undefined);
  const errState = (k: string): InputState => (showErr(k) ? 'invalid' : 'none');

  const allFilled =
    Object.values(form).every((v) => String(v).trim() !== '') &&
    Number(form.hiCostIdr) > 0 &&
    (form.category !== 'OTHER' || categoryOther.trim() !== '');

  const saveDraft = () => {
    setShowAllErrors(true); // reveal every missing required field on a save attempt
    save.mutate();
  };
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
        <SectionTitle sub={t('Field bertanda * wajib diisi. Commit mengunci baseline dan membuka Cost, Risk & Schedule.', 'Fields marked * are required. Commit locks the baseline and unlocks Cost, Risk & Schedule.')}>
          Project Charter
        </SectionTitle>
        {charter && (
          <div className="flex items-center gap-2">
            <Badge color={locked ? 'green' : 'amber'}>{locked ? `Committed v${charter.version}` : 'Draft'}</Badge>
          </div>
        )}
      </div>

      <fieldset data-tour="charter-form" disabled={locked} className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Project Description" required error={errText('description')}>
            <Textarea state={errState('description')} value={form.description} onChange={(e) => set('description', e.target.value)} onBlur={() => touch('description')} />
          </Field>
        </div>
        <Field label="Project Goals" required error={errText('goals')}>
          <Textarea state={errState('goals')} value={form.goals} onChange={(e) => set('goals', e.target.value)} onBlur={() => touch('goals')} />
        </Field>
        <Field label="High-Level Scope of Work" required error={errText('hiScope')}>
          <Textarea state={errState('hiScope')} value={form.hiScope} onChange={(e) => set('hiScope', e.target.value)} onBlur={() => touch('hiScope')} />
        </Field>
        <Field label="Project Category" required error={errText('categoryOther', t('Jelaskan kategori "Other"', 'Describe the "Other" category'))}>
          <Select value={form.category} onChange={(e) => set('category', e.target.value)}>
            {PROJECT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
          {form.category === 'OTHER' && (
            <Input className="mt-2" state={errState('categoryOther')} value={categoryOther} onChange={(e) => setCategoryOther(e.target.value)} onBlur={() => touch('categoryOther')} placeholder="Describe the category" />
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
          <Field label="Project Manager" required error={errText('pmUserId', t('Pilih Project Manager', 'Select a Project Manager'))}>
            <Select state={errState('pmUserId')} value={form.pmUserId} onChange={(e) => set('pmUserId', e.target.value)} onBlur={() => touch('pmUserId')}>
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
        <Field label="High-Level Project Cost (IDR)" required error={errText('hiCostIdr', t('Masukkan nilai biaya lebih dari 0', 'Enter a cost greater than 0'))}>
          <MoneyInput state={errState('hiCostIdr')} value={form.hiCostIdr} onValueChange={(v) => set('hiCostIdr', v)} onBlur={() => touch('hiCostIdr')} placeholder="e.g. 1.000.000.000" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Schedule Start" required error={errText('hiScheduleStart')}>
            <Input type="date" state={errState('hiScheduleStart')} value={form.hiScheduleStart} onChange={(e) => set('hiScheduleStart', e.target.value)} onBlur={() => touch('hiScheduleStart')} />
          </Field>
          <Field label="Schedule End" required error={errText('hiScheduleEnd')}>
            <Input type="date" state={errState('hiScheduleEnd')} value={form.hiScheduleEnd} onChange={(e) => set('hiScheduleEnd', e.target.value)} onBlur={() => touch('hiScheduleEnd')} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="High-Level Deliverables / Expected Outcome" required error={errText('hiDeliverables')}>
            <Textarea state={errState('hiDeliverables')} value={form.hiDeliverables} onChange={(e) => set('hiDeliverables', e.target.value)} onBlur={() => touch('hiDeliverables')} />
          </Field>
        </div>
      </fieldset>

      {msg && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{msg}</p>}

      <div className="mt-5 flex items-center gap-2">
        {!locked && (
          <>
            <Button variant="secondary" onClick={saveDraft} disabled={save.isPending}>
              Save draft
            </Button>
            <Button data-tour="charter-commit" onClick={commitCharter} disabled={!charter || !allFilled || commit.isPending}>
              {commit.isPending ? 'Committing…' : 'Commit Charter'}
            </Button>
            {!charter && <span className="text-xs text-slate-500 dark:text-slate-400">{t('Simpan draft dulu, lalu Commit.', 'Save the draft first, then Commit.')}</span>}
            {charter && !allFilled && <span className="text-xs text-amber-500">{t('Lengkapi semua field wajib untuk mengaktifkan Commit.', 'Fill all required fields to enable Commit.')}</span>}
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

