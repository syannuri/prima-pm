// =====================================================================
// Schedule Management — pure helpers (no DB). Tested.
// Gantt tree assembly, duration math, dependency cycle detection,
// manpower<->schedule reconciliation, progress roll-up.
// =====================================================================

const MS_PER_DAY = 86_400_000;

/** Whole-day duration between two dates (>= 0). */
export function durationDays(start: Date, end: Date): number {
  const d = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
  return d < 0 ? 0 : d;
}

/** Generate a per-project task code: T-001, T-002, ... */
export function generateTaskCode(seq: number): string {
  return `T-${String(seq).padStart(3, '0')}`;
}

/**
 * Should EVM weight leaves by their linked direct COST (classic cost-weighted EVM) or fall
 * back to DURATION? Cost weighting is used ONLY when the WBS is FULLY cost-loaded — every
 * leaf that has real duration carries a linked cost. A *partially* costed WBS must NOT switch
 * to cost weighting: the uncosted leaves would collapse to weight 0 and vanish from EV /
 * %complete, so an incomplete-but-uncosted task reads as 0 work and progress is overstated
 * (a 1-of-9-costed WBS could show 100% complete). Zero-duration milestones are exempt — they
 * legitimately carry no cost. With no cost anywhere we return false so duration weighting (or
 * the all-milestone equal-weight fallback) applies. Units never mix: all-cost or all-duration.
 */
export function isCostLoaded(leaves: { cost: number; durationDays: number }[]): boolean {
  return leaves.some((l) => l.cost > 0) && leaves.every((l) => l.cost > 0 || l.durationDays === 0);
}

// --- Gantt tree ---

export interface FlatNode {
  id: string;
  parentTaskId: string | null;
  sortOrder: number;
}

export type TreeNode<T> = T & { children: TreeNode<T>[] };

/** Assemble a flat task list into a nested tree (children sorted by sortOrder). */
export function buildGanttTree<T extends FlatNode>(tasks: T[]): TreeNode<T>[] {
  const byId = new Map<string, TreeNode<T>>();
  for (const t of tasks) byId.set(t.id, { ...t, children: [] });

  const roots: TreeNode<T>[] = [];
  for (const node of byId.values()) {
    if (node.parentTaskId && byId.has(node.parentTaskId)) {
      byId.get(node.parentTaskId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (nodes: TreeNode<T>[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder);
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

// --- Dependency cycle detection ---

export interface DependencyEdge {
  from: string; // predecessor
  to: string; // successor
}

/**
 * Returns true if the directed dependency graph contains a cycle.
 * Pass the existing edges plus the candidate edge to validate before insert.
 */
export function hasDependencyCycle(edges: DependencyEdge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const e of edges) {
    color.set(e.from, WHITE);
    color.set(e.to, WHITE);
  }

  const dfs = (node: string): boolean => {
    color.set(node, GRAY);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true; // back-edge -> cycle
      if (c === WHITE && dfs(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  };

  for (const node of color.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE && dfs(node)) return true;
  }
  return false;
}

// --- Critical Path Method (CPM) ---
// Forward/backward pass over the task network to derive early/late start & finish,
// total float, and the critical path (float = 0). Pure & unit-testable; works in
// integer day-offsets from t=0 (durations + dependency logic only, calendar-independent).

export type CpmDepType = 'FS' | 'SS' | 'FF' | 'SF';
export interface CpmTaskInput { id: string; duration: number }
export interface CpmEdgeInput { predecessorId: string; successorId: string; type: CpmDepType; lagDays: number }
export interface CpmTaskResult { es: number; ef: number; ls: number; lf: number; totalFloat: number; critical: boolean }
export interface CpmResult {
  hasNetwork: boolean; // any dependency edge among the given tasks
  cyclic: boolean;
  projectDuration: number; // longest path length in days
  tasks: Record<string, CpmTaskResult>;
  criticalTaskIds: string[]; // float-0 tasks, in topological order
}

export function computeCpm(tasks: CpmTaskInput[], edges: CpmEdgeInput[]): CpmResult {
  const ids = new Set(tasks.map((t) => t.id));
  // Only edges whose BOTH ends are in the task set (e.g. leaf-to-leaf) drive CPM.
  const es_edges = edges.filter((e) => ids.has(e.predecessorId) && ids.has(e.successorId));
  const dur = new Map(tasks.map((t) => [t.id, Math.max(0, t.duration)]));
  const empty = (): CpmResult => ({ hasNetwork: false, cyclic: false, projectDuration: 0, tasks: {}, criticalTaskIds: [] });
  if (tasks.length === 0) return empty();
  if (es_edges.length === 0) return { ...empty(), hasNetwork: false };
  if (hasDependencyCycle(es_edges.map((e) => ({ from: e.predecessorId, to: e.successorId })))) {
    return { hasNetwork: true, cyclic: true, projectDuration: 0, tasks: {}, criticalTaskIds: [] };
  }

  // Adjacency + topological order (Kahn) over the task set.
  const outAdj = new Map<string, CpmEdgeInput[]>();
  const inAdj = new Map<string, CpmEdgeInput[]>();
  const indeg = new Map<string, number>();
  for (const t of tasks) { outAdj.set(t.id, []); inAdj.set(t.id, []); indeg.set(t.id, 0); }
  for (const e of es_edges) {
    outAdj.get(e.predecessorId)!.push(e);
    inAdj.get(e.successorId)!.push(e);
    indeg.set(e.successorId, (indeg.get(e.successorId) ?? 0) + 1);
  }
  const topo: string[] = [];
  const queue = tasks.filter((t) => (indeg.get(t.id) ?? 0) === 0).map((t) => t.id);
  while (queue.length) {
    const n = queue.shift()!;
    topo.push(n);
    for (const e of outAdj.get(n) ?? []) {
      indeg.set(e.successorId, (indeg.get(e.successorId) ?? 0) - 1);
      if ((indeg.get(e.successorId) ?? 0) === 0) queue.push(e.successorId);
    }
  }

  const es = new Map<string, number>(tasks.map((t) => [t.id, 0]));
  const D = (id: string) => dur.get(id) ?? 0;
  // Forward pass — earliest start/finish.
  for (const id of topo) {
    let start = 0;
    for (const e of inAdj.get(id) ?? []) {
      const pES = es.get(e.predecessorId)!, pEF = pES + D(e.predecessorId);
      const cand =
        e.type === 'FS' ? pEF + e.lagDays :
        e.type === 'SS' ? pES + e.lagDays :
        e.type === 'FF' ? pEF + e.lagDays - D(id) :
        /* SF */ pES + e.lagDays - D(id);
      if (cand > start) start = cand;
    }
    es.set(id, Math.max(0, start));
  }
  const ef = new Map<string, number>(topo.map((id) => [id, es.get(id)! + D(id)]));
  const projectDuration = Math.max(0, ...tasks.map((t) => ef.get(t.id) ?? 0));

  // Backward pass — latest finish/start.
  const lf = new Map<string, number>(tasks.map((t) => [t.id, projectDuration]));
  for (const id of [...topo].reverse()) {
    let finish = projectDuration;
    for (const e of outAdj.get(id) ?? []) {
      const sLF = lf.get(e.successorId)!, sLS = sLF - D(e.successorId);
      const cand =
        e.type === 'FS' ? sLS - e.lagDays :
        e.type === 'SS' ? sLS - e.lagDays + D(id) :
        e.type === 'FF' ? sLF - e.lagDays :
        /* SF */ sLF - e.lagDays + D(id);
      if (cand < finish) finish = cand;
    }
    lf.set(id, finish);
  }

  const result: Record<string, CpmTaskResult> = {};
  const criticalTaskIds: string[] = [];
  for (const id of topo) {
    const _es = es.get(id)!, _ef = ef.get(id)!, _lf = lf.get(id)!, _ls = _lf - D(id);
    const totalFloat = _ls - _es;
    const critical = totalFloat <= 0;
    result[id] = { es: _es, ef: _ef, ls: _ls, lf: _lf, totalFloat, critical };
    if (critical) criticalTaskIds.push(id);
  }
  return { hasNetwork: true, cyclic: false, projectDuration, tasks: result, criticalTaskIds };
}

// --- Manpower <-> Schedule reconciliation ---

export interface ManpowerSyncInput {
  taskId: string;
  taskName: string;
  planStart: Date;
  planEnd: Date;
  /** Σ planMandays of manpower cost lines linked to this task. */
  linkedPlanMandays: number;
}

export interface ManpowerSyncRow {
  taskId: string;
  taskName: string;
  scheduleWorkingDays: number; // calendar duration (proxy for capacity)
  linkedPlanMandays: number;
  variance: number; // linkedPlanMandays - scheduleWorkingDays
  status: 'OK' | 'OVER_ALLOCATED' | 'UNDER_ALLOCATED' | 'NO_MANPOWER';
}

/**
 * Compare manpower mandays budgeted (Cost module) against scheduled duration.
 * Surfaces over/under-allocation so Cost and Schedule stay consistent.
 */
export function reconcileManpower(rows: ManpowerSyncInput[]): ManpowerSyncRow[] {
  return rows.map((r) => {
    const days = durationDays(r.planStart, r.planEnd);
    const variance = Math.round((r.linkedPlanMandays - days) * 100) / 100;
    let status: ManpowerSyncRow['status'];
    if (r.linkedPlanMandays === 0) status = 'NO_MANPOWER';
    else if (variance > 0) status = 'OVER_ALLOCATED';
    else if (variance < 0) status = 'UNDER_ALLOCATED';
    else status = 'OK';
    return {
      taskId: r.taskId,
      taskName: r.taskName,
      scheduleWorkingDays: days,
      linkedPlanMandays: r.linkedPlanMandays,
      variance,
      status,
    };
  });
}

// NOTE: the authoritative project progress is the flat leaf-weighted `weightedProgress`
// computed inside the EVM engine (server/src/calc/evm.ts) and consumed by
// schedule.service (`evm.weightedProgress`). A previous hierarchical, duration-weighted
// roll-up (`weightedProgress`/`wbsProgress`) lived here but was only ever referenced by
// its own tests — it was removed to avoid two divergent, dead "progress" helpers. The
// Gantt view computes its own per-node display roll-up in the client.
