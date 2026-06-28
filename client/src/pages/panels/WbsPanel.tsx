import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { GanttNode, TaskDependency, User } from '../../api/types';
import { Badge, Button, Card, Field, Input, Select, Textarea, SectionTitle, Spinner } from '../../components/ui';
import { formatDate, formatDateInput } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';

interface Row {
  node: GanttNode;
  depth: number;
  wbs: string; // outline number, e.g. 1.2.1
}

// Flatten the tree into ordered rows and assign hierarchical WBS outline numbers.
function flatten(nodes: GanttNode[], depth = 0, prefix = '', acc: Row[] = []): Row[] {
  nodes.forEach((node, i) => {
    const wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
    acc.push({ node, depth, wbs });
    if (node.children?.length) flatten(node.children, depth + 1, wbs, acc);
  });
  return acc;
}

function statusOf(pct: number): { label: string; color: string } {
  if (pct >= 100) return { label: 'Completed', color: 'green' };
  if (pct > 0) return { label: 'In progress', color: 'amber' };
  return { label: 'Not started', color: 'slate' };
}

const day = 86_400_000;

// Summary-task roll-up (MS-Project / WBS 100% rule): a parent's dates span its
// descendants and its % is the duration-weighted average of theirs. Leaves keep
// their own stored values. Returns a map of taskId → rolled metrics.
interface Roll { start: number; end: number; dur: number; pct: number; isParent: boolean }
function rollup(node: GanttNode, out: Map<string, Roll>): Roll {
  if (!node.children?.length) {
    const r: Roll = { start: +new Date(node.planStart), end: +new Date(node.planEnd), dur: node.durationDays, pct: node.progressPct, isParent: false };
    out.set(node.id, r);
    return r;
  }
  const kids = node.children.map((c) => rollup(c, out));
  const start = Math.min(...kids.map((k) => k.start));
  const end = Math.max(...kids.map((k) => k.end));
  const totalDur = kids.reduce((s, k) => s + k.dur, 0) || 1;
  const pct = Math.round(kids.reduce((s, k) => s + k.pct * k.dur, 0) / totalDur);
  const r: Roll = { start, end, dur: Math.round((end - start) / day) + 1, pct, isParent: true };
  out.set(node.id, r);
  return r;
}

export default function WbsPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const base = `/projects/${projectId}/schedule`;
  const canEdit = !!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER'].includes(user.role);

  const ganttQ = useQuery({
    queryKey: ['gantt', projectId],
    queryFn: () => api.get<{ tree: GanttNode[]; dependencies: TaskDependency[] }>(`${base}/gantt`),
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['gantt', projectId] });
    qc.invalidateQueries({ queryKey: ['mp-sync', projectId] });
  };

  const rows = useMemo(() => (ganttQ.data ? flatten(ganttQ.data.tree) : []), [ganttQ.data]);
  const rolled = useMemo(() => {
    const m = new Map<string, Roll>();
    (ganttQ.data?.tree ?? []).forEach((n) => rollup(n, m));
    return m;
  }, [ganttQ.data]);

  // Timeline axis: span of all (rolled) plan dates → month ticks.
  const axis = useMemo(() => {
    if (!rows.length) return null;
    const starts = rows.map((r) => rolled.get(r.node.id)?.start ?? +new Date(r.node.planStart));
    const ends = rows.map((r) => rolled.get(r.node.id)?.end ?? +new Date(r.node.planEnd));
    const min = Math.min(...starts);
    const max = Math.max(...ends);
    const span = Math.max(max - min, day);
    const months: { label: string; leftPct: number }[] = [];
    const d = new Date(min);
    d.setUTCDate(1);
    while (+d <= max) {
      months.push({
        label: d.toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
        leftPct: Math.max(0, ((+d - min) / span) * 100),
      });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return { min, span, months };
  }, [rows, rolled]);

  const [form, setForm] = useState<{ parentId: string | null; edit?: GanttNode } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const colCount = 8 + (canEdit ? 1 : 0);

  const progress = useMutation({
    mutationFn: ({ id, pct }: { id: string; pct: number }) => api.patch(`${base}/tasks/${id}/progress`, { progressPct: pct }),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`${base}/tasks/${id}`),
    onSuccess: invalidate,
  });

  if (ganttQ.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <SectionTitle sub="Deliverable-oriented breakdown of work — tasks, subtasks, dates, % complete (MS-Project style)">
          Work Breakdown Structure
        </SectionTitle>
        {canEdit && <Button onClick={() => setForm({ parentId: null })}>+ Add Task</Button>}
      </div>

      {!rows.length ? (
        <p className="py-8 text-center text-slate-500 dark:text-slate-400">
          No work packages yet.{canEdit ? ' Click “+ Add Task” to start the breakdown.' : ''}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400 dark:text-slate-500 [&>th]:border-b [&>th]:border-slate-200 [&>th]:dark:border-slate-800 [&>th]:py-2 [&>th]:pr-3">
                <th className="w-12">WBS</th>
                <th className="min-w-[16rem]">Task</th>
                <th className="text-right">Start</th>
                <th className="text-right">Finish</th>
                <th className="text-right">Dur</th>
                <th className="text-right">% </th>
                <th>Status</th>
                {/* Timeline header with month ticks */}
                <th className="w-[320px]">
                  <div className="relative h-4 w-[300px]">
                    {axis?.months.map((m) => (
                      <span key={m.label} className="absolute -top-0.5 text-[10px] font-normal normal-case text-slate-400 dark:text-slate-500" style={{ left: `${m.leftPct}%` }}>{m.label}</span>
                    ))}
                  </div>
                </th>
                {canEdit && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ node, depth, wbs }) => {
                const r = rolled.get(node.id) ?? { start: +new Date(node.planStart), end: +new Date(node.planEnd), dur: node.durationDays, pct: node.progressPct, isParent: false };
                const st = statusOf(r.pct);
                const leftPct = axis ? ((r.start - axis.min) / axis.span) * 100 : 0;
                const widthPct = axis ? Math.max(1.5, ((r.end - r.start) / axis.span) * 100) : 0;
                const hasDict = !!(node.description || node.deliverable || node.acceptanceCriteria || node.pic);
                const isOpen = expanded.has(node.id);
                return (
                  <Fragment key={node.id}>
                  <tr className="[&>td]:border-b [&>td]:border-slate-100 [&>td]:dark:border-slate-800 [&>td]:py-1.5 [&>td]:pr-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="font-mono text-xs text-slate-400 dark:text-slate-500">{wbs}</td>
                    <td>
                      <span style={{ paddingLeft: `${depth * 18}px` }} className="flex items-center gap-1">
                        <button onClick={() => toggle(node.id)} title="WBS dictionary" className={`grid h-4 w-4 shrink-0 place-items-center rounded text-[10px] ${hasDict ? 'text-brand-600' : 'text-slate-300 dark:text-slate-600'} hover:bg-slate-200 dark:hover:bg-slate-700`}>
                          {isOpen ? '▾' : 'ⓘ'}
                        </button>
                        {node.isMilestone && <span className="text-brand-600" title="Milestone">◆</span>}
                        <span className={depth === 0 ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'}>{node.name}</span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-right text-xs text-slate-500 dark:text-slate-400">{formatDate(new Date(r.start))}</td>
                    <td className="whitespace-nowrap text-right text-xs text-slate-500 dark:text-slate-400">{formatDate(new Date(r.end))}</td>
                    <td className="text-right tabular-nums text-xs text-slate-500 dark:text-slate-400">{r.dur}d</td>
                    <td className="text-right">
                      {canEdit && !r.isParent ? (
                        <input
                          type="number" min={0} max={100} defaultValue={node.progressPct}
                          onBlur={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value))); if (v !== node.progressPct) progress.mutate({ id: node.id, pct: v }); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className="w-14 rounded border border-slate-300 bg-white px-1 py-0.5 text-right text-xs tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      ) : (
                        <span className={`tabular-nums text-xs ${r.isParent ? 'text-slate-400 dark:text-slate-500' : ''}`} title={r.isParent ? 'Rolled up from subtasks' : undefined}>
                          {r.pct}%{r.isParent && ' ∑'}
                        </span>
                      )}
                    </td>
                    <td><Badge color={st.color}>{st.label}</Badge></td>
                    <td>
                      <div className="relative h-4 w-[300px] rounded bg-slate-100 dark:bg-slate-800">
                        <div
                          className={`absolute top-0 h-4 rounded ${st.color === 'green' ? 'bg-green-400' : st.color === 'amber' ? 'bg-amber-400' : 'bg-brand-400'}`}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          title={`${formatDate(new Date(r.start))} → ${formatDate(new Date(r.end))} · ${r.pct}%`}
                        >
                          <div className="h-4 rounded bg-black/25" style={{ width: `${r.pct}%` }} />
                        </div>
                      </div>
                    </td>
                    {canEdit && (
                      <td className="whitespace-nowrap text-right text-xs">
                        <button onClick={() => setForm({ parentId: node.id })} className="text-brand-600 hover:underline" title="Add subtask">+ Sub</button>
                        <button onClick={() => setForm({ parentId: node.parentTaskId, edit: node })} className="ml-2 text-slate-500 hover:underline dark:text-slate-400">Edit</button>
                        <button onClick={() => { if (confirm(`Delete “${node.name}” and its subtasks?`)) del.mutate(node.id); }} className="ml-2 text-red-500 hover:underline">Del</button>
                      </td>
                    )}
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={colCount} className="border-b border-slate-100 bg-slate-50/60 px-3 py-3 dark:border-slate-800 dark:bg-slate-800/30">
                        <DictionaryView node={node} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {del.isError && <p className="mt-2 text-sm text-red-600">{(del.error as Error).message}</p>}

      {form && (
        <TaskForm
          base={base}
          parentId={form.parentId}
          edit={form.edit}
          siblingCount={rows.filter((r) => r.node.parentTaskId === form.parentId).length}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); invalidate(); }}
        />
      )}
    </Card>
  );
}

// Read-only WBS dictionary detail shown when a row is expanded.
function DictionaryView({ node }: { node: GanttNode }) {
  const Item = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{value || <span className="text-slate-400 dark:text-slate-500">—</span>}</div>
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Item label="Owner (PIC)" value={node.pic?.name} />
      <Item label="Deliverable" value={node.deliverable} />
      <div className="sm:col-span-2"><Item label="Description / Scope" value={node.description} /></div>
      <div className="sm:col-span-2"><Item label="Acceptance criteria" value={node.acceptanceCriteria} /></div>
    </div>
  );
}

function TaskForm({ base, parentId, edit, siblingCount, onClose, onSaved }: {
  base: string; parentId: string | null; edit?: GanttNode; siblingCount: number; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(edit?.name ?? '');
  const [planStart, setStart] = useState(formatDateInput(edit?.planStart ?? new Date()));
  const [planEnd, setEnd] = useState(formatDateInput(edit?.planEnd ?? new Date()));
  const [progressPct, setProgress] = useState(edit?.progressPct ?? 0);
  const [isMilestone, setMilestone] = useState(edit?.isMilestone ?? false);
  const [description, setDescription] = useState(edit?.description ?? '');
  const [deliverable, setDeliverable] = useState(edit?.deliverable ?? '');
  const [acceptanceCriteria, setAcceptance] = useState(edit?.acceptanceCriteria ?? '');
  const [picUserId, setPic] = useState(edit?.picUserId ?? '');
  const [err, setErr] = useState('');
  const usersQ = useQuery({ queryKey: ['directory'], queryFn: () => api.get<{ users: User[] }>('/users/directory') });

  const save = useMutation({
    mutationFn: () => {
      // PUT replaces the whole task, so preserve parent/order/pic/actuals.
      const body = {
        name,
        planStart,
        planEnd,
        progressPct,
        isMilestone,
        parentTaskId: edit ? edit.parentTaskId : parentId,
        sortOrder: edit ? edit.sortOrder : siblingCount,
        picUserId: picUserId || undefined,
        description: description || null,
        deliverable: deliverable || null,
        acceptanceCriteria: acceptanceCriteria || null,
        actualStart: edit?.actualStart ?? undefined,
        actualFinish: edit?.actualFinish ?? undefined,
      };
      return edit ? api.put(`${base}/tasks/${edit.id}`, body) : api.post(`${base}/tasks`, body);
    },
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to save'),
  });

  const title = edit ? 'Edit task' : parentId ? 'Add subtask' : 'Add task';
  // A summary task's dates & % roll up from its subtasks, so they're not edited here.
  const isParent = !!edit?.children?.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
        <div className="space-y-3">
          <Field label="Task name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Requirements gathering" />
          </Field>
          {isParent ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Dates &amp; % roll up automatically from this task’s subtasks.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start"><Input type="date" value={planStart} onChange={(e) => setStart(e.target.value)} /></Field>
                <Field label="Finish"><Input type="date" value={planEnd} onChange={(e) => setEnd(e.target.value)} /></Field>
              </div>
              <Field label={`% Complete (${progressPct}%)`}>
                <input type="range" min={0} max={100} value={progressPct} onChange={(e) => setProgress(Number(e.target.value))} className="w-full accent-brand-600" />
              </Field>
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={isMilestone} onChange={(e) => setMilestone(e.target.checked)} className="accent-brand-600" />
            Milestone
          </label>

          {/* WBS dictionary */}
          <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">WBS dictionary (optional)</div>
            <div className="space-y-3">
              <Field label="Owner (PIC)">
                <Select value={picUserId} onChange={(e) => setPic(e.target.value)}>
                  <option value="">— unassigned —</option>
                  {usersQ.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </Select>
              </Field>
              <Field label="Deliverable"><Input value={deliverable} onChange={(e) => setDeliverable(e.target.value)} placeholder="e.g. Signed-off design document" /></Field>
              <Field label="Description / scope"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this work package covers" /></Field>
              <Field label="Acceptance criteria"><Textarea value={acceptanceCriteria} onChange={(e) => setAcceptance(e.target.value)} placeholder="Definition of done" /></Field>
            </div>
          </div>

          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{err}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" disabled={!name || !planStart || !planEnd || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
