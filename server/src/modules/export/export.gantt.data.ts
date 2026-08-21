// Assemble a flat, render-ready snapshot of a project's schedule for the visual Gantt exports
// (PDF + Excel). Reuses getGantt (WBS tree, plan/baseline/actual dates, progress) and getCpm
// (critical path). Granularity is AUTO: weekly buckets for spans ≤ ~6 months, monthly beyond —
// so wide timelines stay readable. Buckets drive the Excel columns and the PDF time axis.
import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { getGantt, getCpm } from '../schedule/schedule.service.js';

const DAY = 86_400_000;

export type GanttGranularity = 'week' | 'month';

export interface GanttRow {
  id: string;
  depth: number;
  wbsCode: string;
  name: string;
  isMilestone: boolean;
  isCritical: boolean;
  isSummary: boolean;
  planStart: Date;
  planEnd: Date;
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  progressPct: number;
  pic: string;
}

export interface GanttBucket {
  start: Date;   // inclusive
  end: Date;     // exclusive
  label: string;
  major: boolean; // month boundary (week mode) / January or first (month mode) — drawn stronger
}

export interface GanttExport {
  project: { code: string; name: string };
  rows: GanttRow[];
  domainStart: Date;
  domainEnd: Date;
  granularity: GanttGranularity;
  buckets: GanttBucket[];
  today: Date;
  baselinedAt: Date | null;
  generatedAt: Date;
}

export type TreeNode = Awaited<ReturnType<typeof getGantt>>['tree'][number];

// Assigned owners, lead (picResource) first; falls back to legacy pic/User.
function ownerNames(n: TreeNode): string {
  const names = (n.owners ?? []).map((o) => o.name).filter(Boolean);
  if (names.length) return names.join(', ');
  return n.picResource?.name ?? n.pic?.name ?? '—';
}

// Work-package weight a node contributes: its effective project share, falling back to duration
// (mirrors the client roll-up so the exported summary % matches what the PM sees on screen).
function nodeWeight(n: TreeNode): number {
  return (n.effectiveWeightPct || n.durationDays || 0);
}

// Flatten the tree (pre-order) AND roll a WEIGHT-weighted progress % up onto every summary
// (Main Task) row — a parent's stored progressPct is 0, so without this the PDF/Excel showed
// only leaf progress. Matches WbsPanel's rollup(): leaf weight = effectiveWeightPct||duration,
// parent % = Σ(child% · childWeight) / ΣchildWeight. Returns each node's {pct, wt} for its parent.
function flattenNode(n: TreeNode, critical: Set<string>, depth: number, acc: GanttRow[]): { pct: number; wt: number } {
  const isSummary = !!n.children?.length;
  const row: GanttRow = {
    id: n.id,
    depth,
    wbsCode: n.wbsCode,
    name: n.name,
    isMilestone: !!n.isMilestone,
    isCritical: critical.has(n.id),
    isSummary,
    planStart: new Date(n.planStart),
    planEnd: new Date(n.planEnd),
    baselineStart: n.baselineStart ? new Date(n.baselineStart) : null,
    baselineFinish: n.baselineFinish ? new Date(n.baselineFinish) : null,
    actualStart: n.actualStart ? new Date(n.actualStart) : null,
    actualFinish: n.actualFinish ? new Date(n.actualFinish) : null,
    progressPct: n.progressPct ?? 0,
    pic: ownerNames(n),
  };
  acc.push(row);
  if (!isSummary) return { pct: row.progressPct, wt: nodeWeight(n) };

  const kids = n.children.map((c) => flattenNode(c, critical, depth + 1, acc));
  const totalWt = kids.reduce((s, k) => s + k.wt, 0);
  row.progressPct = totalWt > 0 ? Math.round(kids.reduce((s, k) => s + k.pct * k.wt, 0) / totalWt) : 0;
  return { pct: row.progressPct, wt: totalWt };
}

export function flatten(nodes: TreeNode[], critical: Set<string>): GanttRow[] {
  const acc: GanttRow[] = [];
  for (const n of nodes) flattenNode(n, critical, 0, acc);
  return acc;
}

function buildBuckets(t0: Date, t1: Date, g: GanttGranularity): GanttBucket[] {
  const out: GanttBucket[] = [];
  if (g === 'week') {
    const s = new Date(t0);
    const dow = (s.getUTCDay() + 6) % 7; // Monday = 0
    let cur = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() - dow);
    let lastMonth = -1;
    while (cur < +t1) {
      const d = new Date(cur);
      const mon = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
      const major = d.getUTCMonth() !== lastMonth;
      out.push({ start: new Date(cur), end: new Date(cur + 7 * DAY), label: `${d.getUTCDate()} ${mon}`, major });
      lastMonth = d.getUTCMonth();
      cur += 7 * DAY;
    }
    return out;
  }
  let cur = Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), 1);
  let first = true;
  while (cur < +t1) {
    const d = new Date(cur);
    const mon = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
    const jan = d.getUTCMonth() === 0;
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    out.push({ start: new Date(cur), end: new Date(next), label: first || jan ? `${mon} ${d.getUTCFullYear()}` : mon, major: first || jan });
    first = false;
    cur = next;
  }
  return out;
}

export async function gatherGanttExport(projectId: string): Promise<GanttExport> {
  const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { code: true, name: true } });
  if (!project) throw NotFound('Project not found');

  const [gantt, cpm] = await Promise.all([getGantt(projectId), getCpm(projectId)]);
  const critical = new Set(cpm.tasks.filter((t) => t.critical).map((t) => t.id));
  const rows = flatten(gantt.tree, critical);

  // Time domain across every drawn date (plan / baseline / actual), padded to whole days.
  const times: number[] = [];
  for (const r of rows) {
    times.push(+r.planStart, +r.planEnd);
    if (r.baselineStart) times.push(+r.baselineStart);
    if (r.baselineFinish) times.push(+r.baselineFinish);
    if (r.actualStart) times.push(+r.actualStart);
    if (r.actualFinish) times.push(+r.actualFinish);
  }
  const now = Date.now();
  const domainStart = new Date(times.length ? Math.min(...times) : now);
  const domainEnd = new Date(times.length ? Math.max(...times, now) : now + 30 * DAY);
  const spanDays = (+domainEnd - +domainStart) / DAY;
  const granularity: GanttGranularity = spanDays <= 183 ? 'week' : 'month';
  const buckets = buildBuckets(domainStart, domainEnd, granularity);

  return {
    project,
    rows,
    domainStart,
    domainEnd,
    granularity,
    buckets,
    today: new Date(now),
    baselinedAt: gantt.baselinedAt ? new Date(gantt.baselinedAt) : null,
    generatedAt: new Date(),
  };
}
