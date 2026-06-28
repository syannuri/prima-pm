import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { GanttNode, TaskDependency } from '../../api/types';
import { formatDate } from '../../lib/format';

const MS = 86_400_000;
const LABEL_W = 240;
const ROW_H = 32;
const BAR_H = 18;
const BAR_TOP = (ROW_H - BAR_H) / 2;

export interface FlatRow { node: GanttNode; depth: number }

type Drag =
  | { kind: 'move'; id: string; node: GanttNode; startX: number }
  | { kind: 'link'; fromId: string; fromX: number; fromY: number };

export default function GanttChart({
  flat,
  dependencies,
  base,
  onChange,
}: {
  flat: FlatRow[];
  dependencies: TaskDependency[];
  base: string;
  onChange: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [timelineW, setTimelineW] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [err, setErr] = useState('');

  // Measure timeline width (drag math needs pixels-per-day).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setTimelineW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const range = useMemo(() => {
    if (!flat.length) return null;
    let min = Infinity, max = -Infinity;
    for (const { node } of flat) {
      min = Math.min(min, new Date(node.planStart).getTime());
      max = Math.max(max, new Date(node.planEnd).getTime());
    }
    const totalDays = Math.max(1, Math.round((max - min) / MS));
    return { min, max, totalDays };
  }, [flat]);

  const dayW = range && timelineW ? timelineW / range.totalDays : 0;
  const xOf = (d: string | Date) => (range ? ((new Date(d).getTime() - range.min) / MS) * dayW : 0);
  const rows = flat.length;
  const byId = useMemo(() => {
    const m = new Map<string, { idx: number; node: GanttNode }>();
    flat.forEach((f, idx) => m.set(f.node.id, { idx, node: f.node }));
    return m;
  }, [flat]);

  const createDep = useMutation({
    mutationFn: (v: { successorId: string; predecessorId: string }) =>
      api.post(`${base}/tasks/${v.successorId}/dependencies`, { predecessorId: v.predecessorId, type: 'FS', lagDays: 0 }),
    onSuccess: () => { setErr(''); onChange(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to link'),
  });
  const delDep = useMutation({
    mutationFn: (id: string) => api.del(`${base}/dependencies/${id}`),
    onSuccess: onChange,
  });
  const moveTask = useMutation({
    mutationFn: (v: { node: GanttNode; days: number }) => {
      const ns = new Date(new Date(v.node.planStart).getTime() + v.days * MS);
      const ne = new Date(new Date(v.node.planEnd).getTime() + v.days * MS);
      return api.put(`${base}/tasks/${v.node.id}`, {
        name: v.node.name,
        wbsCode: v.node.wbsCode,
        parentTaskId: v.node.parentTaskId ?? undefined,
        planStart: ns.toISOString(),
        planEnd: ne.toISOString(),
        actualStart: v.node.actualStart ?? undefined,
        actualFinish: v.node.actualFinish ?? undefined,
        picUserId: v.node.picUserId ?? undefined,
        progressPct: v.node.progressPct,
        isMilestone: v.node.isMilestone,
        sortOrder: v.node.sortOrder,
      });
    },
    onSuccess: () => { setErr(''); onChange(); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to reschedule'),
  });

  // Window listeners while a drag is active.
  useEffect(() => {
    if (!drag) return;
    const rel = (e: PointerEvent) => {
      const r = wrapRef.current!.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => setCursor(rel(e));
    const onUp = (e: PointerEvent) => {
      const { x, y } = rel(e);
      if (drag.kind === 'link') {
        const targetIdx = Math.floor(y / ROW_H);
        const target = flat[targetIdx]?.node;
        if (target && target.id !== drag.fromId) {
          createDep.mutate({ successorId: target.id, predecessorId: drag.fromId });
        }
      } else if (dayW > 0) {
        const days = Math.round((x - drag.startX) / dayW);
        if (days !== 0) moveTask.mutate({ node: drag.node, days });
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, dayW, flat]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!flat.length) return <p className="py-3 text-center text-slate-400 dark:text-slate-500">No tasks yet.</p>;

  const startDrag = (e: React.PointerEvent, fn: (p: { x: number; y: number }) => Drag) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    setCursor(p);
    setDrag(fn(p));
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span>Drag a bar to reschedule.</span>
        <span>Drag the ● handle onto another task to create a dependency (Finish-to-Start).</span>
        {err && <span className="font-medium text-red-600">{err}</span>}
      </div>

      <div className="flex select-none">
        {/* Labels column */}
        <div style={{ width: LABEL_W }} className="shrink-0">
          {flat.map(({ node, depth }) => (
            <div key={node.id} style={{ height: ROW_H, paddingLeft: depth * 14 }} className="flex items-center truncate text-sm">
              <span className={node.children?.length ? 'font-semibold' : ''}>{node.wbsCode} {node.name}</span>
            </div>
          ))}
        </div>

        {/* Timeline column */}
        <div ref={wrapRef} className="relative flex-1" style={{ height: rows * ROW_H }}>
          {/* row backgrounds */}
          {flat.map(({ node }, idx) => (
            <div key={node.id} style={{ top: idx * ROW_H, height: ROW_H }} className="absolute inset-x-0 border-b border-slate-50" />
          ))}

          {/* bars */}
          {dayW > 0 && flat.map(({ node }, idx) => {
            const isParent = (node.children?.length ?? 0) > 0;
            const previewDx = drag?.kind === 'move' && drag.id === node.id ? cursor.x - drag.startX : 0;
            const left = xOf(node.planStart) + previewDx;
            const width = Math.max(6, xOf(node.planEnd) - xOf(node.planStart));
            return (
              <div key={node.id} style={{ top: idx * ROW_H + BAR_TOP, left, width, height: BAR_H }} className="absolute">
                <div
                  onPointerDown={(e) => startDrag(e, (p) => ({ kind: 'move', id: node.id, node, startX: p.x }))}
                  className={`h-full cursor-grab rounded ${isParent ? 'bg-slate-400' : 'bg-brand-500'} active:cursor-grabbing`}
                  title={`${formatDate(node.planStart)} → ${formatDate(node.planEnd)}`}
                >
                  <div className="h-full rounded bg-brand-700/60" style={{ width: `${node.progressPct}%` }} />
                </div>
                {/* link handle */}
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    startDrag(e, () => ({ kind: 'link', fromId: node.id, fromX: xOf(node.planEnd), fromY: idx * ROW_H + ROW_H / 2 }));
                  }}
                  title="Drag to a task to create a dependency"
                  className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white bg-brand-700"
                />
              </div>
            );
          })}

          {/* dependency arrows + ghost link */}
          <svg className="pointer-events-none absolute inset-0" width={timelineW} height={rows * ROW_H}>
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" className="fill-slate-400" />
              </marker>
            </defs>
            {dependencies.map((d) => {
              const p = byId.get(d.predecessorId);
              const s = byId.get(d.successorId);
              if (!p || !s) return null;
              const x1 = xOf(p.node.planEnd);
              const y1 = p.idx * ROW_H + ROW_H / 2;
              const x2 = xOf(s.node.planStart);
              const y2 = s.idx * ROW_H + ROW_H / 2;
              const midX = Math.max(x1 + 8, x2 - 8);
              return (
                <polyline
                  key={d.id}
                  points={`${x1},${y1} ${x1 + 8},${y1} ${x1 + 8},${y2} ${midX},${y2} ${x2},${y2}`}
                  className="fill-none stroke-slate-400"
                  strokeWidth={1.5}
                  markerEnd="url(#arrow)"
                />
              );
            })}
            {drag?.kind === 'link' && (
              <line x1={drag.fromX} y1={drag.fromY} x2={cursor.x} y2={cursor.y} className="stroke-brand-600" strokeWidth={2} strokeDasharray="4 3" />
            )}
          </svg>
        </div>
      </div>

      {/* dependency list */}
      {dependencies.length > 0 && (
        <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-3">
          <div className="mb-1 text-xs font-medium uppercase text-slate-400 dark:text-slate-500">Dependencies</div>
          <div className="flex flex-wrap gap-2">
            {dependencies.map((d) => {
              const p = byId.get(d.predecessorId)?.node;
              const s = byId.get(d.successorId)?.node;
              return (
                <span key={d.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-600 dark:text-slate-300">
                  {p?.wbsCode ?? '?'} → {s?.wbsCode ?? '?'} [{d.type}]
                  <button onClick={() => delDep.mutate(d.id)} className="text-red-500 hover:text-red-700">✕</button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
