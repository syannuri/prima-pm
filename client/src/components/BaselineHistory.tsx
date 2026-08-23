import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { Button, Modal, Select, Spinner, Textarea } from './ui';
import { formatIdr, formatDate } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { canGovernProject } from '../lib/perms';
import { useToast } from './Toast';

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
  const { user } = useAuth();
  const listQ = useQuery({
    queryKey: ['baseline-versions', projectId],
    queryFn: () => api.get<{ versions: VersionSummary[] }>(`/projects/${projectId}/baseline/versions`),
  });
  // Restore/adopt is an ADMIN/PMO governance action — mirror the server's requireProjectGovernance.
  const projectQ = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<{ project: Project }>(`/projects/${projectId}`),
  });
  const canManage = !!projectQ.data?.project && canGovernProject(user, projectQ.data.project, ['ADMIN', 'PMO']);
  const versions = listQ.data?.versions ?? [];
  const [compare, setCompare] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<VersionSummary | null>(null);

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
          {compare
            ? <CompareView projectId={projectId} versions={versions} />
            : <VersionList versions={versions} canManage={canManage} onRestore={setRestoreTarget} />}
        </div>
      )}
      {restoreTarget && (
        <RestoreModal projectId={projectId} target={restoreTarget} isLatest={restoreTarget.version === versions[0]?.version} onClose={() => setRestoreTarget(null)} />
      )}
    </Modal>
  );
}

function VersionList({ versions, canManage, onRestore }: { versions: VersionSummary[]; canManage: boolean; onRestore: (v: VersionSummary) => void }) {
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
            <th className="py-2 pr-3 text-right">BAC</th>
            {canManage && <th className="py-2 text-right"></th>}
          </tr>
        </thead>
        <tbody>
          {versions.map((v, i) => (
            <tr key={v.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-2 pr-3 font-semibold">B{v.version}</td>
              <td className="py-2 pr-3 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(v.committedAt)}</td>
              <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{v.committedByName ?? '—'}</td>
              <td className="py-2 pr-3 text-slate-500 dark:text-slate-400">{v.reason ?? <span className="text-slate-400">—</span>}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatIdr(v.costBaseline)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatIdr(v.budgetAtCompletion)}</td>
              {canManage && (
                <td className="py-2 text-right whitespace-nowrap">
                  {i === 0 ? (
                    <span className="text-[11px] text-slate-400" title="This is the current baseline.">current</span>
                  ) : (
                    <Button variant="secondary" className="!py-0.5 text-[11px]" onClick={() => onRestore(v)}>Restore</Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Confirm + apply a restore/adopt of a prior revision. ADMIN/PMO only (server-enforced). Adopts the
// chosen revision as a NEW "Restored from Bn" version and re-bases the live baseline to it.
function RestoreModal({ projectId, target, isLatest, onClose }: { projectId: string; target: VersionSummary; isLatest: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const restore = useMutation({
    mutationFn: () => api.post<{ fromVersion: number; newVersion: number; tasksRestored: number; tasksMissing: number; tasksUntouched: number }>(
      `/projects/${projectId}/baseline/versions/${target.version}/restore`,
      { reason: reason.trim() || undefined },
    ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['baseline-versions', projectId] });
      qc.invalidateQueries({ queryKey: ['cost', projectId] });
      qc.invalidateQueries({ queryKey: ['gantt', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      const extras = [
        res.tasksMissing ? `${res.tasksMissing} since-deleted task${res.tasksMissing > 1 ? 's' : ''} skipped` : '',
        res.tasksUntouched ? `${res.tasksUntouched} newer task${res.tasksUntouched > 1 ? 's' : ''} left as-is` : '',
      ].filter(Boolean).join(' · ');
      toast.success(`Restored B${res.fromVersion} → B${res.newVersion} · ${res.tasksRestored} task${res.tasksRestored === 1 ? '' : 's'} re-based${extras ? ` (${extras})` : ''}.`);
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to restore baseline version'),
  });

  return (
    <Modal onClose={onClose} title={`Restore baseline B${target.version}`}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          This adopts revision <span className="font-semibold">B{target.version}</span> ({formatDate(target.committedAt)}) as the current
          baseline — the schedule freeze (per-task) and the cost baseline (PMB {formatIdr(target.costBaseline)} / BAC {formatIdr(target.budgetAtCompletion)})
          are re-based to it, and it is recorded as a new revision. Nothing is deleted; the live plan and actuals are untouched. Only the
          cost baseline TOTALS are restored (individual cost lines aren't reconstructed). Tasks added since B{target.version} keep their current baseline.
        </p>
        {isLatest && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            This is already the current baseline — restoring it just re-stamps it as a new revision.
          </p>
        )}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Reason (optional)</label>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`e.g. Reverting the re-baseline — adopt B${target.version} as the plan of record.`} />
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={restore.isPending} onClick={() => restore.mutate()}>
            {restore.isPending ? 'Restoring…' : `Restore B${target.version}`}
          </Button>
        </div>
      </div>
    </Modal>
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
