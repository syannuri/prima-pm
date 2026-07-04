import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Button, Card, Field, Input, Select, SectionTitle, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { formatNum, formatDateInput } from '../lib/format';

interface MyLine {
  id: string;
  projectCode: string;
  projectName: string;
  taskName: string | null;
  planMandays: number;
  progressPct: number;
  earnedMandays: number;
  consumedMandays: number;
}
interface MyEntry {
  id: string;
  costItemId: string;
  lineLabel: string;
  date: string;
  mandays: number;
  note: string | null;
}
interface MyTimesheetData {
  lines: MyLine[];
  entries: MyEntry[];
}

// Self-service timesheet: a member logs their OWN actual man-days against the
// tasks assigned to them, across all projects. No financials are shown.
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

  const { lines, entries } = data;
  const canSubmit = costItemId && date && Number(mandays) > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">My Timesheet</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Log the actual man-days you spend on the tasks assigned to you, across all your projects.</p>
      </div>

      {lines.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No tasks are assigned to you yet. Once a manpower line links a task to your account, it will appear here to log time against.
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <SectionTitle sub="Your assigned work — planned, delivered (progress × plan) and effort logged so far.">My assignments</SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3">Project</th>
                    <th className="px-2">Task</th>
                    <th className="px-2 text-right">Plan</th>
                    <th className="px-2 text-right">Earned</th>
                    <th className="px-2 text-right">Consumed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs text-slate-400">{l.projectCode}</span>
                        <div className="text-slate-700 dark:text-slate-200">{l.projectName}</div>
                      </td>
                      <td className="px-2 text-slate-600 dark:text-slate-300">{l.taskName ?? <span className="italic text-slate-400">unlinked</span>}</td>
                      <td className="px-2 text-right">{formatNum(l.planMandays, 0)}</td>
                      <td className="px-2 text-right">{formatNum(l.earnedMandays, 1)} <span className="text-xs text-slate-400">({l.progressPct}%)</span></td>
                      <td className="px-2 text-right font-medium text-slate-700 dark:text-slate-200">{formatNum(l.consumedMandays, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <SectionTitle sub="Record actual man-days you spent on a given day.">Log my man-days</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-[1fr_9rem_7rem_1fr_auto]">
              <Field label="Task">
                <Select value={costItemId} onChange={(e) => setCostItemId(e.target.value)}>
                  <option value="">— select —</option>
                  {lines.map((l) => (
                    <option key={l.id} value={l.id}>{l.projectCode} · {l.taskName ?? 'unlinked'}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Date">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Man-days">
                <Input type="number" min={0} step="0.5" placeholder="e.g. 1" value={mandays} onChange={(e) => setMandays(e.target.value)} />
              </Field>
              <Field label="Note (optional)">
                <Input placeholder="What did you work on" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Button disabled={!canSubmit || add.isPending} onClick={() => add.mutate()}>{add.isPending ? 'Saving…' : '+ Log'}</Button>
              </div>
            </div>
          </Card>
        </>
      )}

      <Card>
        <SectionTitle sub="Entries you logged. You can delete your own.">My entries</SectionTitle>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">You haven’t logged any man-days yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {entries.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="w-24 text-slate-500 dark:text-slate-400">{new Date(e.date).toLocaleDateString()}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{e.lineLabel}{e.note ? <span className="text-slate-400"> — {e.note}</span> : null}</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200">{formatNum(e.mandays, 1)} md</span>
                <button onClick={() => del.mutate(e.id)} className="text-xs text-red-500 hover:underline">delete</button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
