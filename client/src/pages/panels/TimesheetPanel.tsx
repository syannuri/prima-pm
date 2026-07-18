import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { CostSummary } from '../../api/types';
import { Button, Card, Input, Select, SectionTitle, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useProjectWrite } from '../../lib/useProjectWrite';
import { formatNum, formatDateInput, formatIdr } from '../../lib/format';

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

// Remaining is only meaningful once a budget exists; colour it red once spend exceeds budget.
const remClass = (rem: number) =>
  rem < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200';

// Timesheet: log ACTUAL man-days consumed against a manpower line, and compare
// against earned man-days (progress × plan). Efficiency = earned ÷ consumed — a
// labour CPI: < 1 means more effort spent than the delivered work is worth.
export default function TimesheetPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = useProjectWrite(projectId, ['FINANCE']);

  const { data, isLoading } = useQuery({
    queryKey: ['timesheet', projectId],
    queryFn: () => api.get<TimesheetData>(`/projects/${projectId}/timesheet`),
  });
  // Cost baseline + actuals — for the "remaining Direct/Indirect budget" context above the form.
  // Shares the ['cost'] key with the Cost tab, so logging man-days (which invalidates it) refreshes both.
  const { data: cost } = useQuery({
    queryKey: ['cost', projectId],
    queryFn: () => api.get<CostSummary>(`/projects/${projectId}/cost`),
  });

  const [costItemId, setCostItemId] = useState('');
  const [date, setDate] = useState(formatDateInput(new Date()));
  const [mandays, setMandays] = useState('');
  const [note, setNote] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['timesheet', projectId] });
    qc.invalidateQueries({ queryKey: ['resource-capacity'] });
    qc.invalidateQueries({ queryKey: ['cost', projectId] }); // refresh the Cost-tab "Labour actual" reference
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
  const totalEff = totals.consumedMandays > 0 ? totals.earnedMandays / totals.consumedMandays : null;
  const remainingMandays = totals.planMandays - totals.consumedMandays;

  // Remaining budget, split Direct vs Indirect. Budgets come from the frozen cost baseline;
  // actuals are split server-side by their category (labour is always direct; the labour
  // sentinel AC entry isn't double-counted).
  const directBudget = Number(cost?.baseline?.directTotal ?? 0);
  const indirectBudget = Number(cost?.baseline?.indirectTotal ?? 0);
  const directActual = cost?.directActual ?? 0;
  const indirectActual = cost?.indirectActual ?? 0;
  const hasBudget = !!cost?.baseline && (directBudget > 0 || indirectBudget > 0);

  return (
    <div className="space-y-4">
      {/* Pre-entry context as a compact strip (was a full card): remaining budget + man-day headroom. */}
      {lines.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
          {hasBudget ? (
            <>
              <StripStat label="Direct left" value={formatIdr(directBudget - directActual)} tone={remClass(directBudget - directActual)} />
              <StripStat label="Indirect left" value={formatIdr(indirectBudget - indirectActual)} tone={remClass(indirectBudget - indirectActual)} />
            </>
          ) : (
            <span className="text-sm text-slate-500 dark:text-slate-400">No cost baseline yet — set Direct/Indirect budgets in the Cost tab.</span>
          )}
          <StripStat label="Man-days left" value={formatNum(remainingMandays, 1)} tone={remClass(remainingMandays)} sub={`plan ${formatNum(totals.planMandays, 0)} · logged ${formatNum(totals.consumedMandays, 1)}`} />
        </div>
      )}

      {/* Log form first — the primary action (matches My Timesheet). */}
      {canWrite && lines.length > 0 && (
        <Card>
          <SectionTitle sub="Record actual man-days spent by a resource on a given day.">Log man-days</SectionTitle>
          {/* Phones: date + man-days share a row (so the native date picker isn't full-width); resource, Log and note span both columns. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_9rem_6rem_auto]">
            <Select aria-label="Manpower line" className="col-span-2 sm:col-span-1" value={costItemId} onChange={(e) => setCostItemId(e.target.value)}>
              <option value="">— select a resource —</option>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>{l.resourceName}{l.taskName ? ` · ${l.taskName}` : ''}</option>
              ))}
            </Select>
            <Input aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input aria-label="Man-days" type="number" min={0} step="0.5" placeholder="man-days" value={mandays} onChange={(e) => setMandays(e.target.value)} />
            <Button className="col-span-2 sm:col-span-1" disabled={!canSubmit || add.isPending} onClick={() => add.mutate()}>{add.isPending ? 'Saving…' : '+ Log'}</Button>
            <Input aria-label="Note" className="col-span-2 sm:col-span-4" placeholder="Note (optional) — what was done?" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle sub="Planned vs delivered (earned = progress × plan) vs actual effort logged. Efficiency = earned ÷ consumed (a labour CPI).">
          Effort — plan · earned · consumed
        </SectionTitle>

        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No manpower lines yet. Add manpower in the Cost tab (and link it to a task) to track effort here.
          </p>
        ) : (
          <>
          {/* Desktop: table. Mobile (< sm): card list below. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="py-1.5 pr-3">Resource</th>
                  <th className="px-2">Task</th>
                  <th className="px-2 text-right">Plan</th>
                  <th className="px-2 text-right">Earned</th>
                  <th className="px-2 text-right">Logged</th>
                  <th className="px-2 text-right">Remaining</th>
                  <th className="px-2 text-right">Efficiency</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t border-slate-50 dark:border-slate-800/60">
                    <td className="py-1.5 pr-3 font-medium text-slate-700 dark:text-slate-200">{l.resourceName}</td>
                    <td className="px-2 text-slate-500 dark:text-slate-400">{l.taskName ?? <span className="italic text-slate-400">unlinked</span>}</td>
                    <td className="px-2 text-right tabular-nums">{formatNum(l.planMandays, 0)}</td>
                    <td className="px-2 text-right tabular-nums text-slate-500">{formatNum(l.earnedMandays, 1)} <span className="text-xs text-slate-400">({l.progressPct}%)</span></td>
                    <td className="px-2 text-right tabular-nums font-medium text-slate-700 dark:text-slate-200">{formatNum(l.consumedMandays, 1)}</td>
                    <td className={`px-2 text-right tabular-nums font-medium ${remClass(l.planMandays - l.consumedMandays)}`}>{formatNum(l.planMandays - l.consumedMandays, 1)}</td>
                    <td className={`px-2 text-right font-semibold tabular-nums ${effClass(l.efficiency)}`}>{l.efficiency != null ? l.efficiency.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-semibold dark:border-slate-700">
                  <td className="py-1.5 pr-3">Total</td>
                  <td className="px-2" />
                  <td className="px-2 text-right tabular-nums">{formatNum(totals.planMandays, 0)}</td>
                  <td className="px-2 text-right tabular-nums">{formatNum(totals.earnedMandays, 1)}</td>
                  <td className="px-2 text-right tabular-nums">{formatNum(totals.consumedMandays, 1)}</td>
                  <td className={`px-2 text-right tabular-nums ${remClass(remainingMandays)}`}>{formatNum(remainingMandays, 1)}</td>
                  <td className={`px-2 text-right tabular-nums ${effClass(totalEff)}`}>{totalEff != null ? totalEff.toFixed(2) : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {/* Mobile card list — table hidden < sm. */}
          <div className="space-y-2 sm:hidden">
            {lines.map((l) => (
              <div key={l.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-700 dark:text-slate-200">{l.resourceName}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{l.taskName ?? <span className="italic text-slate-400">unlinked</span>}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">Efficiency</div>
                    <div className={`font-semibold tabular-nums ${effClass(l.efficiency)}`}>{l.efficiency != null ? l.efficiency.toFixed(2) : '—'}</div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div><div className="text-slate-400">Plan</div><div className="tabular-nums font-medium text-slate-700 dark:text-slate-200">{formatNum(l.planMandays, 0)}</div></div>
                  <div><div className="text-slate-400">Earned</div><div className="tabular-nums text-slate-600 dark:text-slate-300">{formatNum(l.earnedMandays, 1)} <span className="text-slate-400">({l.progressPct}%)</span></div></div>
                  <div><div className="text-slate-400">Logged</div><div className="tabular-nums font-medium text-slate-700 dark:text-slate-200">{formatNum(l.consumedMandays, 1)}</div></div>
                  <div><div className="text-slate-400">Remaining</div><div className={`tabular-nums font-medium ${remClass(l.planMandays - l.consumedMandays)}`}>{formatNum(l.planMandays - l.consumedMandays, 1)}</div></div>
                </div>
              </div>
            ))}
            <div className="rounded-lg border-2 border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700 dark:text-slate-200">Total</span>
                <span className={`font-semibold tabular-nums ${effClass(totalEff)}`}>Eff {totalEff != null ? totalEff.toFixed(2) : '—'}</span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-slate-400">Plan </span><span className="tabular-nums font-medium">{formatNum(totals.planMandays, 0)}</span></div>
                <div><span className="text-slate-400">Earned </span><span className="tabular-nums">{formatNum(totals.earnedMandays, 1)}</span></div>
                <div><span className="text-slate-400">Logged </span><span className="tabular-nums font-medium">{formatNum(totals.consumedMandays, 1)}</span></div>
                <div><span className="text-slate-400">Remaining </span><span className={`tabular-nums font-medium ${remClass(remainingMandays)}`}>{formatNum(remainingMandays, 1)}</span></div>
              </div>
            </div>
          </div>
          </>
        )}
      </Card>

      <Card>
        <SectionTitle sub="Individual timesheet entries.">Logged entries</SectionTitle>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No man-days logged yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {entries.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <span className="w-24 shrink-0 text-slate-500 dark:text-slate-400">{new Date(e.date).toLocaleDateString()}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{e.lineLabel}{e.note ? <span className="text-slate-400"> — {e.note}</span> : null}</span>
                <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatNum(e.mandays, 1)} md</span>
                {canWrite && <button onClick={() => del.mutate(e.id)} className="text-xs text-red-500 hover:underline">delete</button>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// Compact header stat for the timesheet strip: label + value, optional red tone + sub-note.
function StripStat({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${tone || 'text-slate-800 dark:text-slate-100'}`}>
        {value}
        {sub && <span className="ml-1.5 text-xs font-normal normal-case text-slate-400">{sub}</span>}
      </span>
    </div>
  );
}
