import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button, Modal, Select, Spinner } from './ui';
import { formatIdr, formatDate } from '../lib/format';

// Baseline revision history (Fase 3). Read-only viewer over the versions captured at each baseline
// lock: list the revisions, and compare any two — schedule variance per task (Δstart/Δfinish/Δweight)
// + cost variance (ΔPMB/ΔBAC/Δreserves). Complements BaselineLock; any project member can view.
interface VersionSummary {
  id: string;
  version: number;
  reason: string | null;
  committedByName: string | null;
  committedAt: string;
  costBaseline: string | null;
  budgetAtCompletion: string | null;
}
interface ScheduleRow {
  taskId: string;
  wbsCode: string;
  name: string;
  baselineStart: string | null;
  baselineFinish: string | null;
  weight: number | null;
}
interface CostSnap {
  directTotal: string;
  indirectTotal: string;
  contingencyReserve: string;
  managementReserve: string;
  costBaseline: string;
  budgetAtCompletion: string;
}
interface VersionDetail extends VersionSummary {
  committedBy: string;
  schedule: ScheduleRow[];
  cost: CostSnap;
}

const dayDiff = (base?: string | null, comp?: string | null): number | null => {
  if (!base || !comp) return null;
  return Math.round((new Date(comp).getTime() - new Date(base).getTime()) / 86_400_000);
};
// A signed delta with colour: +N days late (amber), -N days early (emerald), 0 muted.
function DeltaDays({ n }: { n: number | null }) {
  if (n === null) return <span className="text-slate-400">—</span>;
  if (n === 0) return <span className="text-slate-400">0</span>;
  return <span className={n > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>{n > 0 ? `+${n}` : n}d</span>;
}
function DeltaIdr({ base, comp }: { base: string; comp: string }) {
  const d = Number(comp) - Number(base);
  if (d === 0) return <span className="text-slate-400">—</span>;
  return <span className={d > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>{d > 0 ? '+' : '−'}{formatIdr(Math.abs(d))}</span>;
}

export default function BaselineHistory({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" className="!py-1 text-xs" onClick={() => setOpen(true)}>Baseline history</Button>
      {open && <HistoryModal projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  );
}

function HistoryModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const listQ = useQuery({
    queryKey: ['baseline-versions', projectId],
    queryFn: () => api.get<{ versions: VersionSummary[] }>(`/projects/${projectId}/baseline/versions`),
  });
  const versions = listQ.data?.versions ?? [];
  const [compare, setCompare] = useState(false);

  return (
    <Modal onClose={onClose} title="Baseline history">
      {listQ.isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : versions.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          No baseline committed yet. A revision is captured each time the baseline is locked.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500 dark:text-slate-400">{versions.length} revision{versions.length > 1 ? 's' : ''} — each captured at a baseline lock.</p>
            {versions.length >= 2 && (
              <Button variant="secondary" className="!py-1 text-xs" onClick={() => setCompare((c) => !c)}>
                {compare ? 'Back to list' : 'Compare versions'}
              </Button>
            )}
          </div>
          {compare ? <CompareView projectId={projectId} versions={versions} /> : <VersionList versions={versions} />}
        </div>
      )}
    </Modal>
  );
}

function VersionList({ versions }: { versions: VersionSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <th className="py-2 pr-3">Rev</th>
            <th className="py-2 pr-3">Committed</th>
            <th className="py-2 pr-3">By</th>
            <th className="py-2 pr-3">Reason</th>
            <th className="py-2 pr-3 text-right">PMB</th>
            <th className="py-2 text-right">BAC</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-2 pr-3 font-semibold">B{v.version}</td>
              <td className="py-2 pr-3 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(v.committedAt)}</td>
              <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{v.committedByName ?? '—'}</td>
              <td className="py-2 pr-3 text-slate-500 dark:text-slate-400">{v.reason ?? <span className="text-slate-400">—</span>}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatIdr(v.costBaseline)}</td>
              <td className="py-2 text-right tabular-nums">{formatIdr(v.budgetAtCompletion)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompareView({ projectId, versions }: { projectId: string; versions: VersionSummary[] }) {
  // Default: previous vs latest (list is newest-first).
  const [aVer, setAVer] = useState(versions[1]?.version ?? versions[0].version);
  const [bVer, setBVer] = useState(versions[0].version);

  const aQ = useQuery({
    queryKey: ['baseline-version', projectId, aVer],
    queryFn: () => api.get<{ version: VersionDetail }>(`/projects/${projectId}/baseline/versions/${aVer}`),
  });
  const bQ = useQuery({
    queryKey: ['baseline-version', projectId, bVer],
    queryFn: () => api.get<{ version: VersionDetail }>(`/projects/${projectId}/baseline/versions/${bVer}`),
  });
  const a = aQ.data?.version;
  const b = bQ.data?.version;

  const rows = useMemo(() => {
    if (!a || !b) return [];
    const byId = new Map(a.schedule.map((s) => [s.taskId, s]));
    const seen = new Set<string>();
    const out: Array<{ key: string; wbsCode: string; name: string; dStart: number | null; dFinish: number | null; dWeight: number | null; status: 'changed' | 'added' | 'removed' }> = [];
    for (const s of b.schedule) {
      seen.add(s.taskId);
      const prev = byId.get(s.taskId);
      if (!prev) { out.push({ key: s.taskId, wbsCode: s.wbsCode, name: s.name, dStart: null, dFinish: null, dWeight: s.weight, status: 'added' }); continue; }
      const dStart = dayDiff(prev.baselineStart, s.baselineStart);
      const dFinish = dayDiff(prev.baselineFinish, s.baselineFinish);
      const dWeight = (s.weight ?? 0) - (prev.weight ?? 0);
      if (dStart || dFinish || dWeight) out.push({ key: s.taskId, wbsCode: s.wbsCode, name: s.name, dStart, dFinish, dWeight, status: 'changed' });
    }
    for (const s of a.schedule) if (!seen.has(s.taskId)) out.push({ key: s.taskId, wbsCode: s.wbsCode, name: s.name, dStart: null, dFinish: null, dWeight: -(s.weight ?? 0), status: 'removed' });
    return out.sort((x, y) => x.wbsCode.localeCompare(y.wbsCode, undefined, { numeric: true }));
  }, [a, b]);

  const picker = (label: string, val: number, set: (n: number) => void) => (
    <label className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
      {label}
      <Select value={val} onChange={(e) => set(Number(e.target.value))} className="!py-1 text-xs">
        {versions.map((v) => <option key={v.id} value={v.version}>B{v.version} · {formatDate(v.committedAt)}</option>)}
      </Select>
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {picker('From', aVer, setAVer)}
        <span className="text-slate-400">→</span>
        {picker('To', bVer, setBVer)}
      </div>

      {aVer === bVer ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Pick two different revisions to compare.</p>
      ) : aQ.isLoading || bQ.isLoading || !a || !b ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <>
          {/* Cost variance */}
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Cost</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-1.5 pr-3">Component</th>
                  <th className="py-1.5 pr-3 text-right">B{a.version}</th>
                  <th className="py-1.5 pr-3 text-right">B{b.version}</th>
                  <th className="py-1.5 text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ['PMB (cost baseline)', 'costBaseline'],
                  ['BAC', 'budgetAtCompletion'],
                  ['Contingency', 'contingencyReserve'],
                  ['Mgmt reserve', 'managementReserve'],
                ] as const).map(([label, key]) => (
                  <tr key={key} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-300">{label}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatIdr(a.cost[key])}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatIdr(b.cost[key])}</td>
                    <td className="py-1.5 text-right tabular-nums"><DeltaIdr base={a.cost[key]} comp={b.cost[key]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Schedule variance */}
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Schedule {rows.length > 0 && <span className="font-normal normal-case text-slate-400">· {rows.length} task{rows.length > 1 ? 's' : ''} changed</span>}
            </h4>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No task-level schedule changes between these revisions.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      <th className="py-1.5 pr-3">WBS</th>
                      <th className="py-1.5 pr-3">Task</th>
                      <th className="py-1.5 pr-3 text-right">ΔStart</th>
                      <th className="py-1.5 pr-3 text-right">ΔFinish</th>
                      <th className="py-1.5 text-right">ΔWeight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-slate-500 dark:text-slate-400">{r.wbsCode}</td>
                        <td className="py-1.5 pr-3">
                          {r.name}
                          {r.status === 'added' && <span className="ml-1 text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">new</span>}
                          {r.status === 'removed' && <span className="ml-1 text-[10px] font-semibold uppercase text-rose-500">removed</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums"><DeltaDays n={r.dStart} /></td>
                        <td className="py-1.5 pr-3 text-right tabular-nums"><DeltaDays n={r.dFinish} /></td>
                        <td className="py-1.5 text-right tabular-nums">{r.dWeight ? (r.dWeight > 0 ? `+${r.dWeight}` : r.dWeight) : <span className="text-slate-400">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
