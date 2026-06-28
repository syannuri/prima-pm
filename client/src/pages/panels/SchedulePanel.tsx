import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Evm, GanttNode, TaskDependency } from '../../api/types';
import { Badge, Card, Field, Input, SectionTitle, Spinner } from '../../components/ui';
import { formatDate, formatDateInput, formatIdr, formatNum } from '../../lib/format';
import GanttChart, { type FlatRow as Flat } from './GanttChart';
import WbsPanel from './WbsPanel';

function flatten(nodes: GanttNode[], depth = 0, acc: Flat[] = []): Flat[] {
  for (const n of nodes) {
    acc.push({ node: n, depth });
    if (n.children?.length) flatten(n.children, depth + 1, acc);
  }
  return acc;
}

export default function SchedulePanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/schedule`;
  const ganttQ = useQuery({
    queryKey: ['gantt', projectId],
    queryFn: () => api.get<{ tree: GanttNode[]; dependencies: TaskDependency[] }>(`${base}/gantt`),
  });
  const syncQ = useQuery({ queryKey: ['mp-sync', projectId], queryFn: () => api.get<{ rows: ManpowerSyncRow[] }>(`${base}/manpower-sync`) });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['gantt', projectId] });
    qc.invalidateQueries({ queryKey: ['mp-sync', projectId] });
  };

  if (ganttQ.isLoading) return <Spinner />;
  const flat = ganttQ.data ? flatten(ganttQ.data.tree) : [];

  return (
    <div className="space-y-5">
      <EvmPanel base={base} />
      <WbsPanel projectId={projectId} />
      <Card>
        <SectionTitle sub="Drag bars to reschedule · drag the ● handle to link dependencies">Interactive Gantt — drag &amp; dependencies</SectionTitle>
        <GanttChart flat={flat} dependencies={ganttQ.data?.dependencies ?? []} base={base} onChange={invalidate} />
      </Card>
      <ManpowerSync rows={syncQ.data?.rows ?? []} />
    </div>
  );
}

interface ManpowerSyncRow {
  taskId: string; taskName: string; scheduleWorkingDays: number; linkedPlanMandays: number; variance: number;
  status: 'OK' | 'OVER_ALLOCATED' | 'UNDER_ALLOCATED' | 'NO_MANPOWER';
}
const SYNC_COLOR: Record<string, string> = { OK: 'green', OVER_ALLOCATED: 'red', UNDER_ALLOCATED: 'amber', NO_MANPOWER: 'slate' };

function ManpowerSync({ rows }: { rows: ManpowerSyncRow[] }) {
  return (
    <Card>
      <SectionTitle sub="Reconcile Cost manpower mandays against schedule duration">Manpower ↔ Schedule Sync</SectionTitle>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-slate-400 dark:text-slate-500">
            <th className="py-2">Task</th><th className="text-right">Sched. days</th><th className="text-right">Mandays</th>
            <th className="text-right">Variance</th><th className="text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.taskId} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-2">{r.taskName}</td>
              <td className="text-right">{r.scheduleWorkingDays}</td>
              <td className="text-right">{formatNum(r.linkedPlanMandays)}</td>
              <td className="text-right">{formatNum(r.variance)}</td>
              <td className="text-right"><Badge color={SYNC_COLOR[r.status]}>{r.status}</Badge></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="py-3 text-center text-slate-400 dark:text-slate-500">No tasks.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

function EvmPanel({ base }: { base: string }) {
  const [acOverride, setAcOverride] = useState('');
  const [statusDate, setStatusDate] = useState(formatDateInput(new Date()));
  const evmQ = useQuery({
    queryKey: ['evm', base, acOverride, statusDate],
    queryFn: () =>
      api.get<Evm>(
        `${base}/evm?statusDate=${statusDate}${acOverride !== '' ? `&actualCost=${Number(acOverride)}` : ''}`,
      ),
  });
  const e = evmQ.data;
  const hColor = e?.health === 'GREEN' ? 'green' : e?.health === 'AMBER' ? 'amber' : 'red';

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <SectionTitle sub="Earned Value Management — schedule + cost + progress">Project Health (EVM)</SectionTitle>
        <div className="flex items-end gap-2">
          <Field label="AC override (blank = recorded)"><Input type="number" placeholder="recorded AC" value={acOverride} onChange={(e2) => setAcOverride(e2.target.value)} /></Field>
          <Field label="Status date"><Input type="date" value={statusDate} onChange={(e2) => setStatusDate(e2.target.value)} /></Field>
        </div>
      </div>
      {e && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <Badge color={hColor}>Health: {e.health}</Badge>
            <span className="text-sm text-slate-500 dark:text-slate-400">{formatNum(e.percentComplete * 100, 1)}% complete · {e.leafTaskCount} leaf tasks</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="PV" value={formatIdr(e.pv)} />
            <Metric label="EV" value={formatIdr(e.ev)} />
            <Metric label="AC" value={formatIdr(e.ac)} />
            <Metric label="CPI" value={formatNum(e.cpi, 3)} warn={e.cpi < 1} />
            <Metric label="SPI" value={formatNum(e.spi, 3)} warn={e.spi < 1} />
            <Metric label="EAC" value={formatIdr(e.eac)} />
          </div>
          {/* Schedule baseline variance (finish vs baseline) */}
          {e.scheduleBaselinedAt ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500 dark:text-slate-400">Schedule variance:</span>
              <span className="text-slate-700 dark:text-slate-200">finish {formatDate(e.currentFinish)} vs baseline {formatDate(e.baselineFinish)}</span>
              {e.finishVarianceDays != null && (
                <Badge color={e.finishVarianceDays > 0 ? 'red' : e.finishVarianceDays < 0 ? 'green' : 'slate'}>
                  {e.finishVarianceDays > 0 ? `+${e.finishVarianceDays}d late` : e.finishVarianceDays < 0 ? `${e.finishVarianceDays}d early` : 'On schedule'}
                </Badge>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">No schedule baseline set — capture one in the WBS section below to track finish variance.</p>
          )}
        </>
      )}
    </Card>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-sm font-semibold ${warn ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{value}</div>
    </div>
  );
}

