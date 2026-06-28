import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Charter, ProjectCategory, User } from '../../api/types';
import { Badge, Button, Card, Field, Input, SectionTitle, Select, Spinner, Textarea } from '../../components/ui';
import { formatDate, formatDateInput } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import type { ChangeRequest, CharterVersion } from '../../api/types';
import Attachments from '../../components/Attachments';

const CATEGORIES: { value: ProjectCategory; label: string }[] = [
  { value: 'NETWORK_INFRA', label: 'Network Infrastructure' },
  { value: 'SERVER_INFRA', label: 'Server Infrastructure' },
  { value: 'CLOUD_INFRA', label: 'Cloud Infrastructure' },
  { value: 'CYBERSECURITY_INFRA', label: 'Cyber Security Infrastructure' },
  { value: 'APP_DEV', label: 'Application Development' },
];

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

export default function CharterPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(empty);
  const [msg, setMsg] = useState('');

  const charterQ = useQuery({
    queryKey: ['charter', projectId],
    queryFn: () => api.get<{ charter: Charter | null }>(`/projects/${projectId}/charter`),
  });
  const usersQ = useQuery({
    queryKey: ['directory'],
    queryFn: () => api.get<{ users: User[] }>('/users/directory'),
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
        pmUserId: charter.pmUserId,
      });
    }
  }, [charter]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/projects/${projectId}/charter`, { ...form, hiCostIdr: Number(form.hiCostIdr) }),
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
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : 'Commit failed'),
  });

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const allFilled = Object.values(form).every((v) => String(v).trim() !== '') && Number(form.hiCostIdr) > 0;

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
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Project Manager">
          <Select value={form.pmUserId} onChange={(e) => set('pmUserId', e.target.value)}>
            <option value="">— select PM —</option>
            {usersQ.data?.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
            ))}
          </Select>
        </Field>
        <Field label="High-Level Project Cost (IDR)">
          <Input type="number" value={form.hiCostIdr} onChange={(e) => set('hiCostIdr', e.target.value)} />
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
            <Button onClick={() => commit.mutate()} disabled={!charter || !allFilled || commit.isPending}>
              {commit.isPending ? 'Committing…' : 'Commit Charter'}
            </Button>
            {!charter && <span className="text-xs text-slate-400 dark:text-slate-500">Save the draft first, then Commit.</span>}
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

    {charter && <ChangeRequestSection projectId={projectId} locked={locked} />}
    </div>
  );
}

const CR_COLOR: Record<string, string> = {
  SUBMITTED: 'amber',
  UNDER_REVIEW: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
};

function ChangeRequestSection({ projectId, locked }: { projectId: string; locked: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const base = `/projects/${projectId}/charter`;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [err, setErr] = useState('');

  const crQ = useQuery({
    queryKey: ['charter-crs', projectId],
    queryFn: () => api.get<{ changeRequests: ChangeRequest[] }>(`${base}/change-requests`),
  });
  const verQ = useQuery({
    queryKey: ['charter-versions', projectId],
    queryFn: () => api.get<{ versions: CharterVersion[] }>(`${base}/versions`),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['charter-crs', projectId] });
    qc.invalidateQueries({ queryKey: ['charter-versions', projectId] });
    qc.invalidateQueries({ queryKey: ['charter', projectId] });
    qc.invalidateQueries({ queryKey: ['project', projectId] });
  };

  const raise = useMutation({
    mutationFn: () => api.post(`${base}/change-requests`, { title, description }),
    onSuccess: () => { setTitle(''); setDescription(''); setErr(''); refresh(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVED' | 'REJECTED' }) =>
      api.patch(`${base}/change-requests/${id}`, { decision }),
    onSuccess: refresh,
  });

  const isApprover = user && ['ADMIN', 'PMO'].includes(user.role);
  const crs = crQ.data?.changeRequests ?? [];

  return (
    <Card>
      <SectionTitle sub="Edit a committed charter through controlled change. Approval unlocks editing & bumps the version.">
        Change Requests &amp; Version History
      </SectionTitle>

      {locked && (
        <div className="mb-4 grid gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-3 md:grid-cols-2">
          <Field label="Change title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Increase budget for extra scope" />
          </Field>
          <Field label="Reason / description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why the charter must change" />
          </Field>
          <div className="md:col-span-2 flex items-center gap-2">
            <Button onClick={() => raise.mutate()} disabled={!title || !description || raise.isPending}>
              Submit Change Request
            </Button>
            {err && <span className="text-sm text-red-600">{err}</span>}
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-medium uppercase text-slate-400 dark:text-slate-500">Change Requests</div>
          {!crs.length && <p className="text-sm text-slate-400 dark:text-slate-500">No change requests.</p>}
          <div className="space-y-2">
            {crs.map((cr) => (
              <div key={cr.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{cr.title}</span>
                  <Badge color={CR_COLOR[cr.status]}>{cr.status}</Badge>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">{cr.description}</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  by {cr.requester?.name ?? '—'} · {formatDate(cr.createdAt)}
                  {cr.decider && ` · decided by ${cr.decider.name}`}
                </p>
                {isApprover && (cr.status === 'SUBMITTED' || cr.status === 'UNDER_REVIEW') && (
                  <div className="mt-2 flex gap-2">
                    <Button variant="primary" onClick={() => decide.mutate({ id: cr.id, decision: 'APPROVED' })} disabled={decide.isPending}>
                      Approve
                    </Button>
                    <Button variant="danger" onClick={() => decide.mutate({ id: cr.id, decision: 'REJECTED' })} disabled={decide.isPending}>
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase text-slate-400 dark:text-slate-500">Version History</div>
          {!verQ.data?.versions.length && <p className="text-sm text-slate-400 dark:text-slate-500">No committed versions yet.</p>}
          <div className="space-y-1">
            {verQ.data?.versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 py-1 text-sm">
                <span className="font-medium">Version {v.version}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">committed {formatDate(v.committedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
