import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { UatStatus, UatSummary, UatTestCase } from '../../api/types';
import { Badge, Button, Card, Field, Input, Modal, SectionTitle, Select, Spinner, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { formatDate } from '../../lib/format';

const STATUSES: UatStatus[] = ['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED'];
const STATUS_LABEL: Record<UatStatus, string> = { NOT_RUN: 'Not run', PASS: 'Pass', FAIL: 'Fail', BLOCKED: 'Blocked' };
const STATUS_COLOR: Record<UatStatus, string> = { NOT_RUN: 'slate', PASS: 'green', FAIL: 'red', BLOCKED: 'amber' };

export default function UatPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const base = `/projects/${projectId}/uat`;
  const canEdit = !!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER'].includes(user.role);
  const [form, setForm] = useState<null | { edit?: UatTestCase }>(null);

  const q = useQuery({ queryKey: ['uat', projectId], queryFn: () => api.get<{ items: UatTestCase[]; summary: UatSummary }>(base) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['uat', projectId] });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`${base}/${id}`),
    onSuccess: () => { invalidate(); toast.success('Test case deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete'),
  });

  if (q.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  const items = q.data?.items ?? [];
  const s = q.data?.summary;

  return (
    <div className="space-y-5">
      <Card>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <SectionTitle sub="User Acceptance Testing — define test cases (given/when/then) and record Pass/Fail results.">UAT — Test Cases</SectionTitle>
          {canEdit && <Button onClick={() => setForm({})}>+ Add test case</Button>}
        </div>

        {/* Summary strip */}
        {s && s.total > 0 && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi label="Total" value={`${s.total}`} />
              <Kpi label="Passed" value={`${s.pass}`} tone="green" />
              <Kpi label="Failed" value={`${s.fail}`} tone="red" />
              <Kpi label="Blocked" value={`${s.blocked}`} tone="amber" />
              <Kpi label="Not run" value={`${s.notRun}`} />
              <Kpi label="Pass rate" value={`${s.passRate}%`} sub={`${s.executed}/${s.total} executed`} tone={s.passRate >= 90 ? 'green' : s.passRate >= 60 ? 'amber' : 'red'} />
            </div>
            <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              {/* stacked pass/fail/blocked bar */}
              <div className="flex h-full">
                <span className="bg-green-500" style={{ width: `${pct(s.pass, s.total)}%` }} />
                <span className="bg-red-500" style={{ width: `${pct(s.fail, s.total)}%` }} />
                <span className="bg-amber-500" style={{ width: `${pct(s.blocked, s.total)}%` }} />
              </div>
            </div>
          </>
        )}

        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No UAT test cases yet.{canEdit ? ' Click “+ Add test case” to build the acceptance test set.' : ''}
          </p>
        ) : (
          <>
            {/* Desktop: full table. Mobile: stacked cards so Expected/Status/Tester/actions never clip off-screen. */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400 [&>th]:py-2 [&>th]:pr-3">
                    <th className="w-16">Code</th><th className="min-w-[14rem]">Test case</th><th>Expected</th>
                    <th>Status</th><th>Tester</th><th className="text-right">Run</th>{canEdit && <th className="text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id} className="border-b border-slate-100 align-top dark:border-slate-800 [&>td]:py-2 [&>td]:pr-3">
                      <td className="font-mono text-xs text-slate-500 dark:text-slate-400">{t.code}</td>
                      <td>
                        <div className="font-medium text-slate-800 dark:text-slate-100">{t.title}</div>
                        {t.scenario && <div className="text-xs text-slate-500 dark:text-slate-400">{t.scenario}</div>}
                        {t.status === 'FAIL' && t.notes && <div className="mt-0.5 text-xs text-red-600 dark:text-red-400">Defect: {t.notes}</div>}
                      </td>
                      <td className="text-xs text-slate-600 dark:text-slate-300">{t.expected}{t.actual && <div className="mt-0.5 text-slate-400">Actual: {t.actual}</div>}</td>
                      <td><Badge color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status]}</Badge></td>
                      <td className="text-xs text-slate-500 dark:text-slate-400">{t.testerName ?? '—'}</td>
                      <td className="whitespace-nowrap text-right text-xs text-slate-500 dark:text-slate-400">{t.executedAt ? formatDate(t.executedAt) : '—'}</td>
                      {canEdit && (
                        <td className="whitespace-nowrap text-right text-xs">
                          <button onClick={() => setForm({ edit: t })} className="text-brand-600 hover:underline">Run / Edit</button>
                          <button
                            onClick={async () => { if (await confirm({ title: 'Delete test case?', message: <>Delete <strong>{t.code}</strong>?</>, confirmLabel: 'Delete', danger: true })) del.mutate(t.id); }}
                            className="ml-2 text-red-500 hover:underline">Del</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 sm:hidden">
              {items.map((t) => (
                <div key={t.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{t.code}</span>
                      <p className="font-medium text-slate-800 dark:text-slate-100">{t.title}</p>
                      {t.scenario && <p className="text-xs text-slate-500 dark:text-slate-400">{t.scenario}</p>}
                    </div>
                    <Badge color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-2 text-xs dark:border-slate-800">
                    <div className="col-span-2">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Expected</dt>
                      <dd className="text-slate-600 dark:text-slate-300">{t.expected}{t.actual && <div className="mt-0.5 text-slate-400">Actual: {t.actual}</div>}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Tester</dt>
                      <dd className="text-slate-600 dark:text-slate-300">{t.testerName ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Run</dt>
                      <dd className="text-slate-600 dark:text-slate-300">{t.executedAt ? formatDate(t.executedAt) : '—'}</dd>
                    </div>
                  </dl>
                  {t.status === 'FAIL' && t.notes && <p className="mt-2 text-xs text-red-600 dark:text-red-400">Defect: {t.notes}</p>}
                  {canEdit && (
                    <div className="mt-2 flex justify-end gap-4 border-t border-slate-100 pt-2 text-xs dark:border-slate-800">
                      <button onClick={() => setForm({ edit: t })} className="font-medium text-brand-600 hover:underline">Run / Edit</button>
                      <button
                        onClick={async () => { if (await confirm({ title: 'Delete test case?', message: <>Delete <strong>{t.code}</strong>?</>, confirmLabel: 'Delete', danger: true })) del.mutate(t.id); }}
                        className="font-medium text-red-500 hover:underline">Del</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {form && <TestCaseModal base={base} edit={form.edit} onClose={() => setForm(null)} onSaved={() => { setForm(null); invalidate(); }} />}
    </div>
  );
}

function pct(n: number, total: number) { return total > 0 ? Math.round((n / total) * 100) : 0; }

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'red' | 'amber' }) {
  const color = tone === 'green' ? 'text-green-600 dark:text-green-400' : tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100';
  return (
    <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

function TestCaseModal({ base, edit, onClose, onSaved }: { base: string; edit?: UatTestCase; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(edit?.title ?? '');
  const [scenario, setScenario] = useState(edit?.scenario ?? '');
  const [steps, setSteps] = useState(edit?.steps ?? '');
  const [expected, setExpected] = useState(edit?.expected ?? '');
  const [status, setStatus] = useState<UatStatus>(edit?.status ?? 'NOT_RUN');
  const [actual, setActual] = useState(edit?.actual ?? '');
  const [testerName, setTester] = useState(edit?.testerName ?? '');
  const [notes, setNotes] = useState(edit?.notes ?? '');
  const [err, setErr] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const def = { title, scenario: scenario || null, steps: steps || null, expected };
      if (!edit) return api.post(`${base}`, { title, scenario: scenario || undefined, steps: steps || undefined, expected });
      return api.patch(`${base}/${edit.id}`, { ...def, status, actual: actual || null, testerName: testerName || null, notes: notes || null });
    },
    onSuccess: () => { toast.success(edit ? 'Test case saved' : 'Test case added'); onSaved(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to save'),
  });

  return (
    <Modal onClose={onClose} title={edit ? `${edit.code} — Run / edit test case` : 'Add UAT test case'} size="lg">
      <div className="space-y-3">
        <Field label="Title *"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Login with valid credentials" /></Field>
        <Field label="Scenario / preconditions (given)"><Textarea rows={2} value={scenario} onChange={(e) => setScenario(e.target.value)} placeholder="e.g. User has an active account" /></Field>
        <Field label="Steps to execute (when)"><Textarea rows={2} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="1. Open login  2. Enter credentials  3. Submit" /></Field>
        <Field label="Expected result (then) *"><Textarea rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="e.g. Redirected to the dashboard" /></Field>

        {edit && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Execution result</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as UatStatus)}>{STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}</Select></Field>
              <Field label="Tester"><Input value={testerName} onChange={(e) => setTester(e.target.value)} placeholder="Who ran it" /></Field>
            </div>
            <Field label="Actual result"><Textarea rows={2} value={actual} onChange={(e) => setActual(e.target.value)} placeholder="What actually happened" /></Field>
            <Field label="Notes / defect reference"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. DEF-101" /></Field>
          </div>
        )}

        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{err}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={!title || !expected || save.isPending} onClick={() => { setErr(''); save.mutate(); }}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
