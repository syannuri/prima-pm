import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { Button, Card, Field, Input, Select, SectionTitle, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { formatNum, formatDateInput } from '../../lib/format';

interface TimesheetLine {
  id: string;
  label: string;
  resourceName: string;
  taskName: string | null;
  planMandays: number;
  progressPct: number;
  earnedMandays: number;
  consumedMandays: number;
  efficiency: number | null;
}
interface TimesheetEntry {
  id: string;
  costItemId: string;
  lineLabel: string;
  date: string;
  mandays: number;
  note: string | null;
}
interface TimesheetData {
  lines: TimesheetLine[];
  entries: TimesheetEntry[];
  totals: { planMandays: number; earnedMandays: number; consumedMandays: number };
}

const effClass = (e: number | null) =>
  e == null ? 'text-slate-400' : e >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400';

// Timesheet: log ACTUAL man-days consumed against a manpower line, and compare
// against earned man-days (progress × plan). Efficiency = earned ÷ consumed — a
// labour CPI: < 1 means more effort spent than the delivered work is worth.
export default function TimesheetPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = !!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE'].includes(user.role);

  const { data, isLoading } = useQuery({
    queryKey: ['timesheet', projectId],
    queryFn: () => api.get<TimesheetData>(`/projects/${projectId}/timesheet`),
  });

  const [costItemId, setCostItemId] = useState('');
  const [date, setDate] = useState(formatDateInput(new Date()));
  const [mandays, setMandays] = useState('');
  const [note, setNote] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['timesheet', projectId] });
    qc.invalidateQueries({ queryKey: ['resource-capacity'] });
  };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong');

  const add = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/timesheet`, { costItemId, date, mandays: Number(mandays), note: note.trim() || undefined }),
    onSuccess: () => { invalidate(); toast.success('Man-days logged'); setMandays(''); setNote(''); },
    onError: onErr,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/projects/${projectId}/timesheet/${id}`),
    onSuccess: () => { invalidate(); toast.success('Entry deleted'); },
    onError: onErr,
  });

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!data) return <Card>Could not load timesheet.</Card>;

  const { lines, entries, totals } = data;
  const canSubmit = costItemId && date && Number(mandays) > 0;

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle sub="Planned vs delivered (earned = progress × plan) vs actual effort logged. Efficiency = earned ÷ consumed (a labour CPI).">
          Effort — plan · earned · consumed
        </SectionTitle>

        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No manpower lines yet. Add manpower in the Cost tab (and link it to a task) to track effort here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3">Resource</th>
                  <th className="px-2">Task</th>
                  <th className="px-2 text-right">Plan</th>
                  <th className="px-2 text-right">Earned</th>
                  <th className="px-2 text-right">Consumed</th>
                  <th className="px-2 text-right">Efficiency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 pr-3 font-medium text-slate-700 dark:text-slate-200">{l.resourceName}</td>
                    <td className="px-2 text-slate-500 dark:text-slate-400">{l.taskName ?? <span className="italic text-slate-400">unlinked</span>}</td>
                    <td className="px-2 text-right">{formatNum(l.planMandays, 0)}</td>
                    <td className="px-2 text-right">{formatNum(l.earnedMandays, 1)} <span className="text-xs text-slate-400">({l.progressPct}%)</span></td>
                    <td className="px-2 text-right">{formatNum(l.consumedMandays, 1)}</td>
                    <td className={`px-2 text-right font-semibold ${effClass(l.efficiency)}`}>{l.efficiency != null ? l.efficiency.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold dark:border-slate-700">
                  <td className="py-2 pr-3">Total</td>
                  <td className="px-2" />
                  <td className="px-2 text-right">{formatNum(totals.planMandays, 0)}</td>
                  <td className="px-2 text-right">{formatNum(totals.earnedMandays, 1)}</td>
                  <td className="px-2 text-right">{formatNum(totals.consumedMandays, 1)}</td>
                  <td className={`px-2 text-right ${effClass(totals.consumedMandays > 0 ? totals.earnedMandays / totals.consumedMandays : null)}`}>
                    {totals.consumedMandays > 0 ? (totals.earnedMandays / totals.consumedMandays).toFixed(2) : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {canWrite && lines.length > 0 && (
        <Card>
          <SectionTitle sub="Record actual man-days spent by a resource on a given day.">Log man-days</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-[1fr_9rem_7rem_1fr_auto]">
            <Field label="Manpower line">
              <Select value={costItemId} onChange={(e) => setCostItemId(e.target.value)}>
                <option value="">— select —</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>{l.resourceName}{l.taskName ? ` · ${l.taskName}` : ''}</option>
                ))}
              </Select>
            </Field>
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Man-days">
              <Input type="number" min={0} step="0.5" placeholder="e.g. 1.5" value={mandays} onChange={(e) => setMandays(e.target.value)} />
            </Field>
            <Field label="Note (optional)">
              <Input placeholder="What was done" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <Button disabled={!canSubmit || add.isPending} onClick={() => add.mutate()}>{add.isPending ? 'Saving…' : '+ Log'}</Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle sub="Individual timesheet entries.">Logged entries</SectionTitle>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No man-days logged yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {entries.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="w-24 text-slate-500 dark:text-slate-400">{new Date(e.date).toLocaleDateString()}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{e.lineLabel}{e.note ? <span className="text-slate-400"> — {e.note}</span> : null}</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200">{formatNum(e.mandays, 1)} md</span>
                {canWrite && <button onClick={() => del.mutate(e.id)} className="text-xs text-red-500 hover:underline">delete</button>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
