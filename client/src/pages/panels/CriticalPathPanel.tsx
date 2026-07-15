import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { CpmResult } from '../../api/types';
import { Badge, Card, SectionTitle, Spinner } from '../../components/ui';

// Critical Path Method view — derives the critical path & total float from the task
// network (durations + FS/SS/FF/SF dependencies). Days are network offsets from t=0.
export default function CriticalPathPanel({ projectId }: { projectId: string }) {
  const q = useQuery({ queryKey: ['cpm', projectId], queryFn: () => api.get<CpmResult>(`/projects/${projectId}/schedule/cpm`) });
  if (q.isLoading) return <Card><div className="flex justify-center py-6"><Spinner /></div></Card>;
  const cpm = q.data;
  if (!cpm) return null;

  return (
    <Card>
      <SectionTitle sub="The longest chain of dependent tasks — any slip here slips the project. Float is the slack before a task becomes critical.">Critical Path (CPM)</SectionTitle>

      {cpm.cyclic ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          A dependency cycle was detected — resolve it in the Gantt to compute the critical path.
        </p>
      ) : !cpm.hasNetwork ? (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
          No task dependencies yet. Link tasks (finish-to-start etc.) in the Gantt to compute the critical path and float.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Critical path" value={`${cpm.projectDuration} d`} sub="longest chain" />
            <Stat label="Critical tasks" value={`${cpm.criticalCount} / ${cpm.taskCount}`} sub="zero float" />
            <Stat label="Total tasks" value={String(cpm.taskCount)} sub="activities" />
            <Stat label="Has slack" value={String(cpm.tasks.filter((t) => !t.critical).length)} sub="off the path" />
          </div>

          {/* Desktop: full network table. Mobile (< sm): card list below. */}
          <div className="mt-4 hidden overflow-x-auto sm:block">
            <table className="prima-rows w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                  <th className="py-2">WBS</th><th>Task</th>
                  <th className="text-right">Dur</th>
                  <th className="text-right">Early (ES–EF)</th>
                  <th className="text-right">Late (LS–LF)</th>
                  <th className="text-right">Float</th>
                  <th>On path</th>
                </tr>
              </thead>
              <tbody>
                {cpm.tasks.map((t) => (
                  <tr key={t.id} className={`border-b border-slate-100 dark:border-slate-800 ${t.critical ? 'bg-brand-50/40 dark:bg-brand-900/10' : ''}`}>
                    <td className="py-2 font-mono text-xs">{t.wbsCode}</td>
                    <td className="py-2">
                      <span className={t.critical ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'}>
                        {t.critical && <span className="mr-1 text-brand-500" title="On the critical path">▸</span>}{t.name}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{t.duration}d</td>
                    <td className="py-2 text-right tabular-nums text-xs text-slate-500 dark:text-slate-400">d{t.es}–d{t.ef}</td>
                    <td className="py-2 text-right tabular-nums text-xs text-slate-500 dark:text-slate-400">d{t.ls}–d{t.lf}</td>
                    <td className={`py-2 text-right tabular-nums font-medium ${t.critical ? 'text-brand-600 dark:text-brand-400' : t.totalFloat <= 2 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>{t.totalFloat}d</td>
                    <td className="py-2">{t.critical ? <Badge color="coral">Critical</Badge> : <span className="text-xs text-slate-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list — same rows, so the Early/Late/Float columns don't scroll off-screen. */}
          <div className="mt-4 space-y-2 sm:hidden">
            {cpm.tasks.map((t) => (
              <div key={t.id} className={`rounded-xl border p-3 ${t.critical ? 'border-brand-300 bg-brand-50/40 dark:border-brand-800 dark:bg-brand-900/10' : 'border-slate-200 dark:border-slate-800'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-1.5">
                    <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{t.wbsCode}</span>
                    <span className={t.critical ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'}>
                      {t.critical && <span className="mr-1 text-brand-500" title="On the critical path">▸</span>}{t.name}
                    </span>
                  </div>
                  {t.critical ? <Badge color="coral">Critical</Badge> : <span className="text-xs text-slate-400">—</span>}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2 text-xs dark:border-slate-800">
                  <div><dt className="text-slate-500 dark:text-slate-400">Duration</dt><dd className="tabular-nums text-slate-700 dark:text-slate-200">{t.duration}d</dd></div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Float</dt>
                    <dd className={`tabular-nums font-medium ${t.critical ? 'text-brand-600 dark:text-brand-400' : t.totalFloat <= 2 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}>{t.totalFloat}d</dd>
                  </div>
                  <div><dt className="text-slate-500 dark:text-slate-400">Early (ES–EF)</dt><dd className="tabular-nums text-slate-600 dark:text-slate-300">d{t.es}–d{t.ef}</dd></div>
                  <div><dt className="text-slate-500 dark:text-slate-400">Late (LS–LF)</dt><dd className="tabular-nums text-slate-600 dark:text-slate-300">d{t.ls}–d{t.lf}</dd></div>
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">Days are network offsets from the earliest start (t=0), computed from durations &amp; dependency logic — independent of the calendar plan.</p>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}
