import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { AcceptanceDecision, AcceptanceSignoff, LessonCategory, LessonLearned } from '../../api/types';
import { Badge, Button, Card, Field, Input, Modal, SectionTitle, Select, Spinner, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useProjectWrite } from '../../lib/useProjectWrite';
import { formatDate } from '../../lib/format';

const LESSON_CATEGORIES: LessonCategory[] = ['WENT_WELL', 'WENT_WRONG', 'RECOMMENDATION'];
const LESSON_LABEL: Record<LessonCategory, string> = { WENT_WELL: 'Went well', WENT_WRONG: 'Went wrong', RECOMMENDATION: 'Recommendation' };
const LESSON_COLOR: Record<LessonCategory, string> = { WENT_WELL: 'green', WENT_WRONG: 'red', RECOMMENDATION: 'sky' };

const DECISIONS: AcceptanceDecision[] = ['ACCEPTED', 'ACCEPTED_WITH_CONDITIONS', 'REJECTED'];
const DECISION_LABEL: Record<AcceptanceDecision, string> = {
  ACCEPTED: 'Accepted',
  ACCEPTED_WITH_CONDITIONS: 'Accepted w/ conditions',
  REJECTED: 'Rejected',
};
const DECISION_COLOR: Record<AcceptanceDecision, string> = { ACCEPTED: 'green', ACCEPTED_WITH_CONDITIONS: 'amber', REJECTED: 'red' };

// Project closeout artifacts (PMBOK Close-Project): a lessons-learned register and
// formal deliverable acceptance sign-offs. Both surface as advisory items on the
// closure-readiness checklist. Available throughout the project (lessons accrue as
// you go; acceptance is recorded near the end).
export default function CloseoutPanel({ projectId }: { projectId: string }) {
  const canWrite = useProjectWrite(projectId);
  return (
    <div className="space-y-5">
      <LessonsSection projectId={projectId} canWrite={canWrite} />
      <AcceptanceSection projectId={projectId} canWrite={canWrite} />
    </div>
  );
}

// --- Lessons learned ---------------------------------------------------------

function LessonsSection({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/closeout/lessons`;
  const [editing, setEditing] = useState<LessonLearned | null>(null);
  const [creating, setCreating] = useState(false);

  const q = useQuery({ queryKey: ['lessons', projectId], queryFn: () => api.get<{ lessons: LessonLearned[] }>(base) });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['lessons', projectId] });
    qc.invalidateQueries({ queryKey: ['closure-readiness', projectId] });
    qc.invalidateQueries({ queryKey: ['next-steps', projectId] });
  };

  if (q.isLoading) return <Card><Spinner /></Card>;
  const lessons = q.data?.lessons ?? [];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle sub="What went well, what didn't, and recommendations for future projects — the lessons-learned register.">Lessons Learned</SectionTitle>
        {canWrite && <Button onClick={() => setCreating(true)}>+ Add lesson</Button>}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {LESSON_CATEGORIES.map((c) => (
          <Badge key={c} color={LESSON_COLOR[c]}>{LESSON_LABEL[c]}: {lessons.filter((l) => l.category === c).length}</Badge>
        ))}
      </div>

      <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        {lessons.map((l) => (
          <div key={l.id} className="flex items-start gap-3 py-2.5">
            <Badge color={LESSON_COLOR[l.category]}>{LESSON_LABEL[l.category]}</Badge>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-700 dark:text-slate-200">{l.title}</div>
              {l.description && <div className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{l.description}</div>}
              <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                {l.createdByName ?? 'Unknown'} · {formatDate(l.createdAt)}
              </div>
            </div>
            {canWrite && (
              <div className="shrink-0 whitespace-nowrap">
                <button onClick={() => setEditing(l)} className="mr-2 text-xs text-brand-600 hover:underline">edit</button>
                <DeleteBtn base={base} id={l.id} label={l.title} onDone={invalidate} kind="lesson" />
              </div>
            )}
          </div>
        ))}
        {!lessons.length && <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">No lessons recorded yet.</p>}
      </div>

      {(creating || editing) && (
        <LessonForm base={base} lesson={editing} onClose={() => { setCreating(false); setEditing(null); }} onDone={invalidate} />
      )}
    </Card>
  );
}

function LessonForm({ base, lesson, onClose, onDone }: { base: string; lesson: LessonLearned | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    category: lesson?.category ?? 'RECOMMENDATION',
    title: lesson?.title ?? '',
    description: lesson?.description ?? '',
  });
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { category: f.category, title: f.title.trim() };
      if (f.description.trim()) body.description = f.description.trim();
      return lesson ? api.put(`${base}/${lesson.id}`, body) : api.post(base, body);
    },
    onSuccess: () => { toast.success(lesson ? 'Lesson updated' : 'Lesson added'); onDone(); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to save lesson'),
  });

  return (
    <Modal onClose={onClose} title={lesson ? 'Edit lesson' : 'Add a lesson'} size="lg">
      <div className="space-y-3">
        <Field label="Category">
          <Select value={f.category} onChange={(e) => set('category', e.target.value)}>
            {LESSON_CATEGORIES.map((c) => <option key={c} value={c}>{LESSON_LABEL[c]}</option>)}
          </Select>
        </Field>
        <Field label="Lesson"><Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Early stakeholder demos reduced rework" /></Field>
        <Field label="Details" hint="Context and the recommendation for next time.">
          <Textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="What happened, why it mattered, what to do differently…" />
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={f.title.trim().length < 3 || save.isPending}>{lesson ? 'Save' : 'Add lesson'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// --- Acceptance sign-offs ----------------------------------------------------

function AcceptanceSection({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/closeout/acceptances`;
  const [creating, setCreating] = useState(false);

  const q = useQuery({ queryKey: ['acceptances', projectId], queryFn: () => api.get<{ acceptances: AcceptanceSignoff[] }>(base) });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['acceptances', projectId] });
    qc.invalidateQueries({ queryKey: ['closure-readiness', projectId] });
    qc.invalidateQueries({ queryKey: ['next-steps', projectId] });
  };

  if (q.isLoading) return <Card><Spinner /></Card>;
  const acceptances = q.data?.acceptances ?? [];
  const accepted = acceptances.filter((a) => a.decision !== 'REJECTED').length;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle sub="Formal deliverable acceptance from the sponsor / customer — the closing sign-off record.">Acceptance Sign-off</SectionTitle>
        {canWrite && <Button onClick={() => setCreating(true)}>+ Record sign-off</Button>}
      </div>

      <div className="mt-2">
        <Badge color={accepted > 0 ? 'green' : 'amber'}>{accepted > 0 ? `${accepted} acceptance${accepted > 1 ? 's' : ''} on record` : 'No acceptance yet'}</Badge>
      </div>

      {/* Desktop: full register. Mobile: stacked cards so Decision + Comments never clip off the right edge. */}
      <div className="mt-3 hidden overflow-x-auto sm:block">
        <table className="prima-rows w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
              <th className="py-2">Party</th><th>Decision</th><th>Signed by</th><th>Date</th><th>Comments</th><th></th>
            </tr>
          </thead>
          <tbody>
            {acceptances.map((a) => (
              <tr key={a.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{a.party}</td>
                <td className="py-2"><Badge color={DECISION_COLOR[a.decision]}>{DECISION_LABEL[a.decision]}</Badge></td>
                <td className="py-2 text-slate-600 dark:text-slate-300">{a.signedByName ?? '—'}</td>
                <td className="py-2 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{formatDate(a.signedAt)}</td>
                <td className="py-2">
                  {a.comments
                    ? <div className="max-w-[18rem] whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">{a.comments}</div>
                    : <span className="text-slate-500 dark:text-slate-400">—</span>}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {canWrite && <DeleteBtn base={base} id={a.id} label={`${a.party} sign-off`} onDone={invalidate} kind="acceptance" />}
                </td>
              </tr>
            ))}
            {!acceptances.length && <tr><td colSpan={6} className="py-4 text-center text-slate-500 dark:text-slate-400">No sign-offs recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-3 space-y-2 sm:hidden">
        {acceptances.map((a) => (
          <div key={a.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-slate-700 dark:text-slate-200">{a.party}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{a.signedByName ?? '—'}</p>
              </div>
              <Badge color={DECISION_COLOR[a.decision]}>{DECISION_LABEL[a.decision]}</Badge>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Date</dt>
                <dd className="text-slate-600 dark:text-slate-300">{formatDate(a.signedAt)}</dd>
              </div>
              {a.comments && (
                <div className="col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Comments</dt>
                  <dd className="whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">{a.comments}</dd>
                </div>
              )}
            </dl>
            {canWrite && (
              <div className="mt-2 flex justify-end gap-4 border-t border-slate-100 pt-2 dark:border-slate-800">
                <DeleteBtn base={base} id={a.id} label={`${a.party} sign-off`} onDone={invalidate} kind="acceptance" />
              </div>
            )}
          </div>
        ))}
        {!acceptances.length && <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">No sign-offs recorded yet.</p>}
      </div>

      {creating && <AcceptanceForm base={base} onClose={() => setCreating(false)} onDone={invalidate} />}
    </Card>
  );
}

function AcceptanceForm({ base, onClose, onDone }: { base: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    party: '',
    decision: 'ACCEPTED' as AcceptanceDecision,
    signedByName: '',
    signedAt: new Date().toISOString().slice(0, 10),
    comments: '',
  });
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { party: f.party.trim(), decision: f.decision, signedAt: f.signedAt };
      if (f.signedByName.trim()) body.signedByName = f.signedByName.trim();
      if (f.comments.trim()) body.comments = f.comments.trim();
      return api.post(base, body);
    },
    onSuccess: () => { toast.success('Sign-off recorded'); onDone(); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to record sign-off'),
  });

  return (
    <Modal onClose={onClose} title="Record an acceptance sign-off" size="lg">
      <div className="space-y-3">
        {/* 2-col even on phones so the sign-off Date picker isn't full-width (it pairs with "Signed by"). */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Accepting party"><Input value={f.party} onChange={(e) => set('party', e.target.value)} placeholder="e.g. Sponsor, Customer — Bank X" /></Field>
          <Field label="Decision">
            <Select value={f.decision} onChange={(e) => set('decision', e.target.value)}>
              {DECISIONS.map((d) => <option key={d} value={d}>{DECISION_LABEL[d]}</option>)}
            </Select>
          </Field>
          <Field label="Signed by" hint="Name of the person who signed (may be external)."><Input value={f.signedByName} onChange={(e) => set('signedByName', e.target.value)} placeholder="e.g. Dewi Sponsor" /></Field>
          <Field label="Date"><Input type="date" value={f.signedAt} onChange={(e) => set('signedAt', e.target.value)} /></Field>
        </div>
        <Field label="Comments" hint="Conditions, scope accepted, or reason for rejection.">
          <Textarea rows={2} value={f.comments} onChange={(e) => set('comments', e.target.value)} placeholder="e.g. All deliverables accepted; warranty period 30 days." />
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={f.party.trim().length < 2 || save.isPending}>Record sign-off</Button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteBtn({ base, id, label, onDone, kind }: { base: string; id: string; label: string; onDone: () => void; kind: 'lesson' | 'acceptance' }) {
  const toast = useToast();
  const confirm = useConfirm();
  const del = useMutation({
    mutationFn: () => api.del(`${base}/${id}`),
    onSuccess: () => { onDone(); toast.success(kind === 'lesson' ? 'Lesson deleted' : 'Sign-off deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete'),
  });
  const onClick = async () => {
    if (await confirm({ title: `Delete ${kind}?`, message: <>Delete <strong>{label}</strong>?</>, confirmLabel: 'Delete', danger: true })) del.mutate();
  };
  return <button onClick={onClick} className="text-xs text-red-500 hover:underline">delete</button>;
}
