import { useMemo, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { AgileBoard, BacklogItem, BacklogStatus, BacklogType, Sprint, User } from '../../api/types';
import { Badge, Button, Card, EmptyState, Input, SectionTitle, Select, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { BACKLOG_STATUS_LABEL, BACKLOG_TYPE_BADGE } from '../../lib/labels';
import AgileReports from './AgileReports';

const TYPES: BacklogType[] = ['STORY', 'TASK', 'BUG', 'EPIC'];
const STATUSES: BacklogStatus[] = ['TODO', 'IN_PROGRESS', 'DONE'];
// Column accent (top border) per status — a calm visual cue on the board.
const STATUS_ACCENT: Record<BacklogStatus, string> = {
  TODO: 'border-t-slate-400',
  IN_PROGRESS: 'border-t-sky-500',
  DONE: 'border-t-green-500',
};
const SPRINT_STATUSES = ['PLANNED', 'ACTIVE', 'CLOSED'] as const;
const sumPoints = (arr: BacklogItem[]) => arr.reduce((s, i) => s + (i.storyPoints ?? 0), 0);

export default function AgilePanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const canEdit = !!user && ['ADMIN', 'PMO', 'PROJECT_MANAGER'].includes(user.role);
  const base = `/projects/${projectId}/agile`;
  const [view, setView] = useState<'board' | 'backlog' | 'reports'>('board');

  const { data, isLoading } = useQuery({ queryKey: ['agile', projectId], queryFn: () => api.get<AgileBoard>(base) });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => api.get<{ users: User[] }>('/users/directory') });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['agile', projectId] });
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong');

  const createItem = useMutation({ mutationFn: (body: Record<string, unknown>) => api.post(`${base}/items`, body), onSuccess: () => { invalidate(); toast.success('Item added'); }, onError: onErr });
  const patchItem = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`${base}/items/${id}`, body), onSuccess: invalidate, onError: onErr });
  const delItem = useMutation({ mutationFn: (id: string) => api.del(`${base}/items/${id}`), onSuccess: () => { invalidate(); toast.success('Item deleted'); }, onError: onErr });
  const createSprint = useMutation({ mutationFn: (body: Record<string, unknown>) => api.post(`${base}/sprints`, body), onSuccess: () => { invalidate(); toast.success('Sprint created'); }, onError: onErr });
  const patchSprint = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`${base}/sprints/${id}`, body), onSuccess: invalidate, onError: onErr });
  const delSprint = useMutation({ mutationFn: (id: string) => api.del(`${base}/sprints/${id}`), onSuccess: () => { invalidate(); toast.success('Sprint deleted'); }, onError: onErr });

  const sprints = data?.sprints ?? [];
  const items = data?.items ?? [];
  const users = dirQ.data?.users ?? [];
  const backlog = items.filter((i) => !i.sprintId);
  const [boardSprint, setBoardSprint] = useState<string>('');
  const activeSprintId = useMemo(() => boardSprint || sprints.find((s) => s.status === 'ACTIVE')?.id || sprints[0]?.id || '', [boardSprint, sprints]);

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle sub="Agile delivery — product backlog, sprints and a Kanban board.">Agile</SectionTitle>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm dark:bg-slate-800">
          {(['board', 'backlog', 'reports'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 capitalize transition ${view === v ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}`}>{v}</button>
          ))}
        </div>
      </div>

      {view === 'reports' ? (
        <AgileReports sprints={sprints} items={items} snapshots={data?.snapshots ?? []} />
      ) : view === 'board' ? (
        <BoardView
          sprints={sprints}
          items={items}
          activeSprintId={activeSprintId}
          setBoardSprint={setBoardSprint}
          canEdit={canEdit}
          onMove={(id, status) => patchItem.mutate({ id, body: { status } })}
        />
      ) : (
        <BacklogView
          sprints={sprints}
          backlog={backlog}
          items={items}
          users={users}
          canEdit={canEdit}
          onCreateItem={(body) => createItem.mutate(body)}
          onPatchItem={(id, body) => patchItem.mutate({ id, body })}
          onDeleteItem={async (it) => { if (await confirm({ title: 'Delete item?', message: <>Delete <strong>{it.title}</strong>?</>, confirmLabel: 'Delete', danger: true })) delItem.mutate(it.id); }}
          onCreateSprint={(body) => createSprint.mutate(body)}
          onPatchSprint={(id, body) => patchSprint.mutate({ id, body })}
          onDeleteSprint={async (s) => { if (await confirm({ title: 'Delete sprint?', message: <>Delete <strong>{s.name}</strong>? Its items return to the product backlog.</>, confirmLabel: 'Delete', danger: true })) delSprint.mutate(s.id); }}
        />
      )}
    </div>
  );
}

function TypeBadge({ t }: { t: BacklogType }) {
  return <Badge color={BACKLOG_TYPE_BADGE[t]}>{t}</Badge>;
}
function Points({ n }: { n: number | null }) {
  if (n == null) return null;
  return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300" title="Story points">{n} pt</span>;
}

// ---------- Board (Kanban) ----------
function BoardView({ sprints, items, activeSprintId, setBoardSprint, canEdit, onMove }: {
  sprints: Sprint[]; items: BacklogItem[]; activeSprintId: string; setBoardSprint: (id: string) => void; canEdit: boolean;
  onMove: (id: string, status: BacklogStatus) => void;
}) {
  // Drag state: which card is being dragged, and which column is hovered.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<BacklogStatus | null>(null);

  if (!sprints.length) return <Card><EmptyState icon="M3 3h18v18H3z M3 9h18 M9 21V9" title="No sprints yet" hint="Create a sprint in the Backlog view, then assign items into it to plan work." /></Card>;
  const sprintItems = items.filter((i) => i.sprintId === activeSprintId);
  const dragged = dragId ? sprintItems.find((i) => i.id === dragId) : null;

  const move = (it: BacklogItem, dir: -1 | 1) => {
    const next = STATUSES[STATUSES.indexOf(it.status) + dir];
    if (next) onMove(it.id, next);
  };
  // Read the dragged id from dataTransfer (set on dragstart) so the drop never
  // depends on React state having re-rendered between the drag events.
  const drop = (e: ReactDragEvent, st: BacklogStatus) => {
    const id = e.dataTransfer.getData('text/plain') || dragId || '';
    const item = sprintItems.find((i) => i.id === id);
    if (id && item && item.status !== st) onMove(id, st);
    setDragId(null); setOverCol(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Sprint</span>
        <Select value={activeSprintId} onChange={(e) => setBoardSprint(e.target.value)} className="!w-auto">
          {sprints.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.status})</option>)}
        </Select>
        <span className="text-xs text-slate-400 dark:text-slate-500">{sprintItems.length} items · {sumPoints(sprintItems)} pts</span>
        {canEdit && <span className="ml-auto hidden items-center gap-1 text-xs text-slate-400 dark:text-slate-500 sm:flex">✥ Drag cards between columns</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {STATUSES.map((st) => {
          const col = sprintItems.filter((i) => i.status === st);
          const isTarget = overCol === st && !!dragged && dragged.status !== st;
          return (
            <div
              key={st}
              data-col={st}
              onDragOver={canEdit ? (e) => { e.preventDefault(); if (overCol !== st) setOverCol(st); } : undefined}
              onDragLeave={canEdit ? () => setOverCol((c) => (c === st ? null : c)) : undefined}
              onDrop={canEdit ? (e) => { e.preventDefault(); drop(e, st); } : undefined}
              className={`rounded-xl border border-t-2 p-2.5 transition-colors ${STATUS_ACCENT[st]} ${
                isTarget
                  ? 'border-brand-400 bg-brand-50/70 ring-2 ring-brand-300 dark:bg-brand-600/10'
                  : 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40'
              }`}
            >
              <div className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <span>{BACKLOG_STATUS_LABEL[st]}</span>
                <span className="text-xs font-normal text-slate-400 dark:text-slate-500">{col.length} · {sumPoints(col)} pts</span>
              </div>
              <div className="min-h-[3.5rem] space-y-2">
                {col.map((it) => (
                  <div
                    key={it.id}
                    draggable={canEdit}
                    onDragStart={canEdit ? (e) => { setDragId(it.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', it.id); } catch { /* older browsers */ } } : undefined}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    className={`group rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm transition dark:border-slate-700 dark:bg-slate-800 ${
                      canEdit ? 'cursor-grab hover:-translate-y-px hover:shadow-md active:cursor-grabbing' : ''
                    } ${dragId === it.id ? 'opacity-40 ring-2 ring-brand-300' : ''}`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <TypeBadge t={it.type} />
                      <Points n={it.storyPoints} />
                    </div>
                    <div className="text-sm text-slate-700 dark:text-slate-200">{it.title}</div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="truncate text-xs text-slate-400 dark:text-slate-500">{it.assignee ? `👤 ${it.assignee.name}` : 'Unassigned'}</span>
                      {canEdit && (
                        <span className="flex gap-1">
                          <button onClick={() => move(it, -1)} disabled={it.status === 'TODO'} className="rounded px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200" title="Move to previous column">◀</button>
                          <button onClick={() => move(it, 1)} disabled={it.status === 'DONE'} className="rounded px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200" title="Move to next column">▶</button>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {!col.length && (
                  <p className={`rounded-lg border border-dashed px-1 py-4 text-center text-xs transition-colors ${
                    isTarget ? 'border-brand-400 text-brand-600 dark:text-brand-300' : 'border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500'
                  }`}>
                    {isTarget ? 'Drop here' : 'No items'}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Backlog ----------
function BacklogView({ sprints, backlog, items, users, canEdit, onCreateItem, onPatchItem, onDeleteItem, onCreateSprint, onPatchSprint, onDeleteSprint }: {
  sprints: Sprint[]; backlog: BacklogItem[]; items: BacklogItem[]; users: User[]; canEdit: boolean;
  onCreateItem: (b: Record<string, unknown>) => void;
  onPatchItem: (id: string, b: Record<string, unknown>) => void;
  onDeleteItem: (it: BacklogItem) => void;
  onCreateSprint: (b: Record<string, unknown>) => void;
  onPatchSprint: (id: string, b: Record<string, unknown>) => void;
  onDeleteSprint: (s: Sprint) => void;
}) {
  const [type, setType] = useState<BacklogType>('STORY');
  const [title, setTitle] = useState('');
  const [points, setPoints] = useState('');
  const [assignee, setAssignee] = useState('');
  const [sprintName, setSprintName] = useState('');

  const add = () => {
    if (!title.trim()) return;
    onCreateItem({ type, title: title.trim(), storyPoints: points ? Number(points) : undefined, assigneeUserId: assignee || undefined });
    setTitle(''); setPoints(''); setAssignee('');
  };

  const addSprint = () => { if (sprintName.trim()) { onCreateSprint({ name: sprintName.trim() }); setSprintName(''); } };

  const ItemRow = ({ it }: { it: BacklogItem }) => (
    <div className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <TypeBadge t={it.type} />
      <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{it.title}</span>
      <Points n={it.storyPoints} />
      {canEdit ? (
        <select value={it.sprintId ?? ''} onChange={(e) => onPatchItem(it.id, { sprintId: e.target.value || null })} title="Assign to sprint" className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900">
          <option value="">📋 Backlog</option>
          {sprints.map((s) => <option key={s.id} value={s.id}>🏃 {s.name}</option>)}
        </select>
      ) : it.sprintId ? <span className="text-xs text-slate-400">in sprint</span> : null}
      <span className="w-24 truncate text-xs text-slate-400 dark:text-slate-500">{it.assignee ? it.assignee.name : '—'}</span>
      {canEdit && <button onClick={() => onDeleteItem(it)} className="text-xs text-red-500 hover:underline">delete</button>}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Product backlog first — capturing an item is the most common action, so the
          composer sits right at the top (no scrolling past the sprints list). */}
      <Card>
        <SectionTitle sub="Add stories, tasks and bugs here, then assign them to a sprint (or drag them across the Board).">Product Backlog</SectionTitle>
        {canEdit && (
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Add backlog item</div>
            <div className="grid gap-2 sm:grid-cols-[7rem_1fr_5.5rem_9rem_auto]">
              <Select value={type} onChange={(e) => setType(e.target.value as BacklogType)} aria-label="Type">{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
              <Input placeholder="What needs doing?" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" onKeyDown={(e) => e.key === 'Enter' && add()} />
              <Input type="number" min={0} placeholder="Points" value={points} onChange={(e) => setPoints(e.target.value)} aria-label="Story points" title="Story points (effort estimate)" />
              <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assignee"><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
              <Button onClick={add} disabled={!title.trim()}>+ Add</Button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">Tip: press <kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">Enter</kbd> in the title to add quickly.</p>
          </div>
        )}
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {backlog.length ? backlog.map((it) => <ItemRow key={it.id} it={it} />) : <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">Backlog is empty — add your first item above.</p>}
        </div>
      </Card>

      {/* Sprints */}
      <Card>
        <SectionTitle sub="Time-boxed iterations. Leave a project without sprints to run pure Kanban.">Sprints</SectionTitle>
        <div className="space-y-1">
          {sprints.map((s) => {
            const its = items.filter((i) => i.sprintId === s.id);
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2 dark:border-slate-800">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">{s.name}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{its.length} items · {sumPoints(its)} pts</span>
                {canEdit ? (
                  <select value={s.status} onChange={(e) => onPatchSprint(s.id, { status: e.target.value })} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900">
                    {SPRINT_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                ) : <Badge color={s.status === 'ACTIVE' ? 'green' : s.status === 'CLOSED' ? 'slate' : 'sky'}>{s.status}</Badge>}
                {canEdit && <button onClick={() => onDeleteSprint(s)} className="text-xs text-red-500 hover:underline">delete</button>}
              </div>
            );
          })}
          {!sprints.length && <p className="py-2 text-sm text-slate-400 dark:text-slate-500">No sprints yet.</p>}
        </div>
        {canEdit && (
          <div className="mt-3 flex gap-2">
            <Input placeholder="New sprint name (e.g. Sprint 1)" value={sprintName} onChange={(e) => setSprintName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSprint()} />
            <Button variant="secondary" disabled={!sprintName.trim()} onClick={addSprint}>+ Sprint</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
