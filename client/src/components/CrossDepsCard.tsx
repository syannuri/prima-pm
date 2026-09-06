import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { Button, Card } from './ui';
import { useToast } from './Toast';

// Cross-project schedule dependencies for a project: what this project's tasks WAIT ON in other projects
// (incoming, with a late-predecessor flag) and what they BLOCK elsewhere (outgoing). Editors can add/remove
// links. Self-hides when there are none and the viewer can't edit.
interface CrossTaskRef { taskId: string; taskName: string; wbsCode: string; projectId: string; projectCode: string; projectName: string; finish?: string; start?: string }
interface CrossLink {
  id: string; type: string; lagDays: number;
  predecessor: CrossTaskRef; successor: CrossTaskRef;
  slackDays: number; late: boolean;
}
interface ScheduleTask { id: string; wbsCode: string; name: string }

export default function CrossDepsCard({ projectId, canEdit = false }: { projectId: string; canEdit?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const depsQ = useQuery({ queryKey: ['cross-deps', projectId], queryFn: () => api.get<{ incoming: CrossLink[]; outgoing: CrossLink[] }>(`/projects/${projectId}/cross-deps`) });
  const myTasksQ = useQuery({ queryKey: ['schedule', projectId], queryFn: () => api.get<{ tasks: ScheduleTask[] }>(`/projects/${projectId}/schedule`), enabled: open });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ projects: Project[] }>('/projects'), enabled: open });

  const [successorTaskId, setSuccessorTaskId] = useState('');
  const [predProjectId, setPredProjectId] = useState('');
  const [predecessorTaskId, setPredecessorTaskId] = useState('');
  const [lagDays, setLagDays] = useState(0);
  const predTasksQ = useQuery({ queryKey: ['schedule', predProjectId], queryFn: () => api.get<{ tasks: ScheduleTask[] }>(`/projects/${predProjectId}/schedule`), enabled: open && !!predProjectId });

  const refresh = () => qc.invalidateQueries({ queryKey: ['cross-deps', projectId] });
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong');

  const create = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/cross-deps`, { predecessorTaskId, successorTaskId, lagDays: lagDays || 0 }),
    onSuccess: () => { toast.success('Cross-project dependency added'); setSuccessorTaskId(''); setPredProjectId(''); setPredecessorTaskId(''); setLagDays(0); refresh(); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/projects/${projectId}/cross-deps/${id}`),
    onSuccess: () => { toast.success('Removed'); refresh(); },
    onError: onErr,
  });

  const incoming = depsQ.data?.incoming ?? [];
  const outgoing = depsQ.data?.outgoing ?? [];
  if (depsQ.isLoading) return null;
  if (incoming.length === 0 && outgoing.length === 0 && !canEdit) return null;

  const selectClass = 'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '—');

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Cross-project dependencies</h2>
          <p className="text-xs text-slate-400">Links to tasks in other projects, with schedule-impact flags.</p>
        </div>
        {canEdit && <button onClick={() => setOpen((o) => !o)} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">{open ? 'Close' : '+ Add'}</button>}
      </div>

      {open && canEdit && (
        <div className="mt-3 space-y-2 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-600">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-slate-500 dark:text-slate-400">This project's task (waits on)
              <select className={`${selectClass} mt-1 w-full`} value={successorTaskId} onChange={(e) => setSuccessorTaskId(e.target.value)}>
                <option value="">— select task —</option>
                {(myTasksQ.data?.tasks ?? []).map((t) => <option key={t.id} value={t.id}>{t.wbsCode} · {t.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">Other project
              <select className={`${selectClass} mt-1 w-full`} value={predProjectId} onChange={(e) => { setPredProjectId(e.target.value); setPredecessorTaskId(''); }}>
                <option value="">— select project —</option>
                {(projectsQ.data?.projects ?? []).filter((p) => p.id !== projectId).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">Predecessor task
              <select className={`${selectClass} mt-1 w-full`} value={predecessorTaskId} onChange={(e) => setPredecessorTaskId(e.target.value)} disabled={!predProjectId}>
                <option value="">— select task —</option>
                {(predTasksQ.data?.tasks ?? []).map((t) => <option key={t.id} value={t.id}>{t.wbsCode} · {t.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">Lag (days)
              <input type="number" className={`${selectClass} mt-1 w-full`} value={lagDays} onChange={(e) => setLagDays(Number(e.target.value))} />
            </label>
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={() => create.mutate()} disabled={!successorTaskId || !predecessorTaskId || create.isPending}>Add dependency</Button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-4">
        {incoming.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Waits on ({incoming.length})</p>
            <ul className="space-y-1.5">
              {incoming.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                  <span className="text-slate-700 dark:text-slate-200">{l.successor.wbsCode} {l.successor.taskName}</span>
                  <span className="text-slate-400">← {l.predecessor.projectCode} · {l.predecessor.taskName} (ends {fmt(l.predecessor.finish)})</span>
                  {l.late
                    ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">Late {Math.abs(l.slackDays)}d</span>
                    : <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{l.slackDays}d slack</span>}
                  {canEdit && <button onClick={() => remove.mutate(l.id)} className="ml-auto text-xs text-slate-400 hover:text-red-500" aria-label="Remove">✕</button>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {outgoing.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Blocks ({outgoing.length})</p>
            <ul className="space-y-1.5">
              {outgoing.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                  <span className="text-slate-700 dark:text-slate-200">{l.predecessor.wbsCode} {l.predecessor.taskName}</span>
                  <span className="text-slate-400">→ {l.successor.projectCode} · {l.successor.taskName} (starts {fmt(l.successor.start)})</span>
                  {l.late && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">at risk</span>}
                  {canEdit && <button onClick={() => remove.mutate(l.id)} className="ml-auto text-xs text-slate-400 hover:text-red-500" aria-label="Remove">✕</button>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {incoming.length === 0 && outgoing.length === 0 && (
          <p className="text-sm text-slate-500">No cross-project dependencies yet.</p>
        )}
      </div>
    </Card>
  );
}
