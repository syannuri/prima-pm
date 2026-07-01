import { useMemo, useState } from 'react';
import type { BacklogItem, Sprint, SprintSnapshot } from '../../api/types';
import { Card, EmptyState, SectionTitle, Select } from '../../components/ui';

const pts = (arr: BacklogItem[]) => arr.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
const dayIndex = (from: Date, d: Date) => Math.round((d.getTime() - from.getTime()) / 86400000);

export default function AgileReports({ sprints, items, snapshots }: { sprints: Sprint[]; items: BacklogItem[]; snapshots: SprintSnapshot[] }) {
  const [sel, setSel] = useState('');
  const sprintId = sel || sprints.find((s) => s.status === 'ACTIVE')?.id || sprints[0]?.id || '';
  const sprint = sprints.find((s) => s.id === sprintId);

  const sprintItems = items.filter((i) => i.sprintId === sprintId);
  const committed = pts(sprintItems);
  const done = pts(sprintItems.filter((i) => i.status === 'DONE'));
  const remaining = committed - done;
  const pct = committed > 0 ? Math.round((done / committed) * 100) : 0;
  const counts = {
    TODO: sprintItems.filter((i) => i.status === 'TODO').length,
    IN_PROGRESS: sprintItems.filter((i) => i.status === 'IN_PROGRESS').length,
    DONE: sprintItems.filter((i) => i.status === 'DONE').length,
  };

  if (!sprints.length) {
    return <Card><EmptyState icon="M3 3v18h18 M7 15l3-4 3 3 4-6" title="No sprints yet" hint="Create a sprint and add items to see velocity and burndown." /></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Sprint</span>
        <Select value={sprintId} onChange={(e) => setSel(e.target.value)} className="!w-auto">
          {sprints.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.status})</option>)}
        </Select>
      </div>

      {/* Sprint summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Committed" value={`${committed} pts`} />
        <Stat label="Completed" value={`${done} pts`} sub={`${pct}%`} />
        <Stat label="Remaining" value={`${remaining} pts`} warn={remaining > 0 && sprint?.status === 'CLOSED'} />
        <Stat label="Items" value={`${sprintItems.length}`} sub={`${counts.DONE}✓ · ${counts.IN_PROGRESS}◐ · ${counts.TODO}○`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle sub="Story points completed per sprint (committed vs done).">Velocity</SectionTitle>
          <Velocity sprints={sprints} items={items} />
        </Card>
        <Card>
          <SectionTitle sub="Remaining story points vs the ideal guideline over the sprint.">Burndown</SectionTitle>
          {sprint ? <Burndown sprint={sprint} committed={committed} snapshots={snapshots.filter((s) => s.sprintId === sprintId)} /> : null}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <Card className="!p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${warn ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
    </Card>
  );
}

// Velocity: committed (slate) vs completed (brand) points per sprint.
function Velocity({ sprints, items }: { sprints: Sprint[]; items: BacklogItem[] }) {
  const rows = sprints.map((s) => {
    const its = items.filter((i) => i.sprintId === s.id);
    return { name: s.name, committed: pts(its), done: pts(its.filter((i) => i.status === 'DONE')) };
  });
  const max = Math.max(1, ...rows.map((r) => r.committed));
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-400" />Committed</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500" />Completed</span>
      </div>
      <div className="flex h-32 items-end gap-3">
        {rows.map((r, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end" title={`${r.name}: ${r.done}/${r.committed} pts`}>
            <div className="flex h-full w-full items-end justify-center gap-1">
              <div className="w-full max-w-[1.1rem] rounded-t bg-slate-400 dark:bg-slate-500" style={{ height: `${Math.max((r.committed / max) * 100, 2)}%` }} />
              <div className="w-full max-w-[1.1rem] rounded-t bg-brand-500" style={{ height: `${Math.max((r.done / max) * 100, 2)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-3">
        {rows.map((r, i) => (
          <div key={i} className="min-w-0 flex-1 truncate text-center text-[10px] text-slate-500 dark:text-slate-400" title={r.name}>{r.name}</div>
        ))}
      </div>
    </div>
  );
}

// Burndown: ideal guideline (committed → 0 across sprint days) + actual remaining snapshots.
function Burndown({ sprint, committed, snapshots }: { sprint: Sprint; committed: number; snapshots: SprintSnapshot[] }) {
  const W = 320, H = 130, PL = 28, PB = 18, PT = 8, PR = 8;
  const plotW = W - PL - PR, plotH = H - PB - PT;

  const data = useMemo(() => {
    const start = sprint.startDate ? new Date(sprint.startDate) : snapshots[0] ? new Date(snapshots[0].date) : null;
    const end = sprint.endDate ? new Date(sprint.endDate) : snapshots.length ? new Date(snapshots[snapshots.length - 1].date) : null;
    if (!start || !end || end <= start) return null;
    const totalDays = Math.max(1, dayIndex(start, end));
    const maxY = Math.max(1, committed, ...snapshots.map((s) => s.remainingPoints));
    const x = (d: number) => PL + (Math.min(Math.max(d, 0), totalDays) / totalDays) * plotW;
    const y = (v: number) => PT + (1 - Math.min(v, maxY) / maxY) * plotH;
    const ideal = `M${x(0)},${y(committed)} L${x(totalDays)},${y(0)}`;
    const pts2 = snapshots.map((s) => ({ d: dayIndex(start, new Date(s.date)), v: s.remainingPoints }));
    const actual = pts2.length ? 'M' + pts2.map((p) => `${x(p.d)},${y(p.v)}`).join(' L') : '';
    return { ideal, actual, actualPts: pts2.map((p) => ({ cx: x(p.d), cy: y(p.v) })), maxY };
  }, [sprint, committed, snapshots, plotW, plotH]);

  if (!data) return <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Set the sprint's start &amp; end dates to see the burndown.</p>;

  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-slate-400" />Ideal</span>
        <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-brand-500" />Actual</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* axes */}
        <line x1={PL} y1={PT} x2={PL} y2={H - PB} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="1" />
        <line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="1" />
        <text x={PL - 4} y={PT + 4} textAnchor="end" className="fill-slate-400 dark:fill-slate-500" style={{ fontSize: 9 }}>{data.maxY}</text>
        <text x={PL - 4} y={H - PB} textAnchor="end" className="fill-slate-400 dark:fill-slate-500" style={{ fontSize: 9 }}>0</text>
        {/* ideal (dashed) */}
        <path d={data.ideal} className="stroke-slate-400" strokeWidth="1.5" strokeDasharray="4 3" fill="none" />
        {/* actual */}
        {data.actual && <path d={data.actual} className="stroke-brand-500" strokeWidth="2" fill="none" strokeLinejoin="round" />}
        {data.actualPts.map((p, i) => <circle key={i} cx={p.cx} cy={p.cy} r="2.5" className="fill-brand-500" />)}
      </svg>
    </div>
  );
}
