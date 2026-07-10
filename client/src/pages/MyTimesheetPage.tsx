import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Badge, Button, Card, Input, Select, SectionTitle, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { PROJECT_STATUS_BADGE } from '../lib/labels';
import { formatNum, formatDateInput } from '../lib/format';

interface MyLine {
  id: string;
  projectCode: string;
  projectName: string;
  projectStatus: string;
  taskName: string | null;
  planMandays: number;
  progressPct: number;
  earnedMandays: number;
  consumedMandays: number;
}
interface MyEntry {
  id: string;
  costItemId: string;
  projectCode: string;
  lineLabel: string;
  date: string;
  mandays: number;
  note: string | null;
}
interface MyTimesheetData {
  lines: MyLine[];
  entries: MyEntry[];
}

// Timesheet is logged only on ACTIVE (in-progress) projects; the server enforces it too.
const ACTIVE = 'IN_PROGRESS';
const STATUS_TEXT: Record<string, string> = {
  DRAFT: 'Draft', CHARTERED: 'Planning', IN_PROGRESS: 'Active', ON_HOLD: 'On hold', CLOSED: 'Closed',
};

interface Group { code: string; name: string; status: string; lines: MyLine[] }

// Self-service timesheet: a member logs their OWN actual man-days against the tasks
// assigned to them, grouped by project. No financials are shown.
export default function MyTimesheetPage() {
  const qc = useQueryClient();
  const toast = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['my-timesheet'],
    queryFn: () => api.get<MyTimesheetData>('/me/timesheet'),
  });

  const [costItemId, setCostItemId] = useState('');
  const [date, setDate] = useState(formatDateInput(new Date()));
  const [mandays, setMandays] = useState('');
  const [note, setNote] = useState('');

  const lines = data?.lines ?? [];
  const entries = data?.entries ?? [];

  // Assignments grouped by project code — active projects first, then by code.
  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Group>();
    for (const l of lines) {
      let g = m.get(l.projectCode);
      if (!g) { g = { code: l.projectCode, name: l.projectName, status: l.projectStatus, lines: [] }; m.set(l.projectCode, g); }
      g.lines.push(l);
    }
    const rank = (s: string) => (s === ACTIVE ? 0 : 1);
    return [...m.values()].sort((a, b) => rank(a.status) - rank(b.status) || a.code.localeCompare(b.code));
  }, [lines]);
  const activeGroups = groups.filter((g) => g.status === ACTIVE);

  // My entries grouped by project code (most-recent projects keep their entry order).
  const entryGroups = useMemo<[string, MyEntry[]][]>(() => {
    const m = new Map<string, MyEntry[]>();
    for (const e of entries) { const a = m.get(e.projectCode) ?? []; a.push(e); m.set(e.projectCode, a); }
    return [...m.entries()];
  }, [entries]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['my-timesheet'] });
    qc.invalidateQueries({ queryKey: ['resource-capacity'] });
  };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong');

  const add = useMutation({
    mutationFn: () => api.post('/me/timesheet', { costItemId, date, mandays: Number(mandays), note: note.trim() || undefined }),
    onSuccess: () => { invalidate(); toast.success('Man-days logged'); setMandays(''); setNote(''); },
    onError: onErr,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/me/timesheet/${id}`),
    onSuccess: () => { invalidate(); toast.success('Entry deleted'); },
    onError: onErr,
  });

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!data) return <Card>Could not load your timesheet.</Card>;

  const canSubmit = costItemId && date && Number(mandays) > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">My Timesheet</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Log the actual man-days you spend on your assigned tasks, by project.</p>
      </div>

      {lines.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No tasks are assigned to you yet. Once a manpower line links a task to your account, it will appear here to log time against.
          </p>
        </Card>
      ) : (
        <>
          {/* Log form first — the primary action. */}
          <Card>
            <SectionTitle sub="Only active (in-progress) projects can be logged.">Log man-days</SectionTitle>
            {activeGroups.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                None of your projects are active right now. Time can only be logged on in-progress projects.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-[1fr_9rem_6rem_auto]">
                <Select aria-label="Task" value={costItemId} onChange={(e) => setCostItemId(e.target.value)}>
                  <option value="">— select a task —</option>
                  {activeGroups.map((g) => (
                    <optgroup key={g.code} label={`${g.code} — ${g.name}`}>
                      {g.lines.map((l) => (
                        <option key={l.id} value={l.id}>{l.taskName ?? 'unlinked'}</option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                <Input aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                <Input aria-label="Man-days" type="number" min={0} step="0.5" placeholder="man-days" value={mandays} onChange={(e) => setMandays(e.target.value)} />
                <Button disabled={!canSubmit || add.isPending} onClick={() => add.mutate()}>{add.isPending ? 'Saving…' : '+ Log'}</Button>
                <Input aria-label="Note" className="sm:col-span-4" placeholder="Note (optional) — what did you work on?" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            )}
          </Card>

          {/* Assignments grouped by project. */}
          <Card>
            <SectionTitle sub="Planned vs delivered (progress × plan) vs logged, per project.">My assignments</SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400">
                    <th className="py-1.5">Task</th>
                    <th className="px-2 text-right">Plan</th>
                    <th className="px-2 text-right">Earned</th>
                    <th className="px-2 text-right">Logged</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g.code}>
                      <tr className="border-t border-slate-100 dark:border-slate-800">
                        <td colSpan={4} className="bg-slate-50/70 py-1.5 dark:bg-slate-800/40">
                          <span className="font-mono text-xs text-slate-400">{g.code}</span>
                          <span className="ml-2 text-slate-700 dark:text-slate-200">{g.name}</span>
                          <span className="ml-2"><Badge color={PROJECT_STATUS_BADGE[g.status]}>{STATUS_TEXT[g.status] ?? g.status}</Badge></span>
                        </td>
                      </tr>
                      {g.lines.map((l) => (
                        <tr key={l.id} className="border-t border-slate-50 dark:border-slate-800/60">
                          <td className="py-1.5 pl-3 text-slate-600 dark:text-slate-300">{l.taskName ?? <span className="italic text-slate-400">unlinked</span>}</td>
                          <td className="px-2 text-right tabular-nums">{formatNum(l.planMandays, 0)}</td>
                          <td className="px-2 text-right tabular-nums text-slate-500">{formatNum(l.earnedMandays, 1)} <span className="text-xs text-slate-400">({l.progressPct}%)</span></td>
                          <td className="px-2 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">{formatNum(l.consumedMandays, 1)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Recent entries grouped by project. */}
      <Card>
        <SectionTitle sub="Entries you logged. You can delete your own.">My entries</SectionTitle>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">You haven’t logged any man-days yet.</p>
        ) : (
          <div className="space-y-3">
            {entryGroups.map(([code, es]) => (
              <div key={code}>
                <div className="mb-1 font-mono text-xs text-slate-400">{code}</div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {es.map((e) => (
                    <div key={e.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                      <span className="w-24 shrink-0 text-slate-500 dark:text-slate-400">{new Date(e.date).toLocaleDateString()}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{e.lineLabel}{e.note ? <span className="text-slate-400"> — {e.note}</span> : null}</span>
                      <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatNum(e.mandays, 1)} md</span>
                      <button onClick={() => del.mutate(e.id)} className="text-xs text-red-500 hover:underline">delete</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
