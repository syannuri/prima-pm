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

// --- Progress roll-up ---

export interface LeafProgress {
  budgetCost: number;
  progressPct: number; // 0..100
}

/** Budget-weighted overall progress (0..100). Falls back to simple average. */
export function weightedProgress(leaves: LeafProgress[]): number {
  if (leaves.length === 0) return 0;
  const totalBudget = leaves.reduce((s, l) => s + (l.budgetCost || 0), 0);
  if (totalBudget <= 0) {
    const avg = leaves.reduce((s, l) => s + clampPct(l.progressPct), 0) / leaves.length;
    return Math.round(avg * 100) / 100;
  }
  const earned = leaves.reduce((s, l) => s + (l.budgetCost || 0) * (clampPct(l.progressPct) / 100), 0);
  return Math.round((earned / totalBudget) * 100 * 100) / 100;
}

function clampPct(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return p < 0 ? 0 : p > 100 ? 100 : p;
}

// --- WBS duration-weighted progress (matches the Schedule view's roll-up) ---

export interface WbsProgressNode {
  id: string;
  parentTaskId: string | null;
  planStart: Date;
  planEnd: Date;
  progressPct: number; // leaf value, 0..100
}

interface WbsRoll { start: number; end: number; dur: number; pct: number }

/**
 * Project % complete via the WBS 100%-rule roll-up, identical to the Schedule
 * tab: a summary task's % is the duration-weighted average of its children
 * (leaves use their own duration & stored %), recursively up to a virtual root.
 * Returns { progress: 0..100, weight } where weight is the project span in days
 * (for rolling several projects up into one portfolio figure).
 */
export function wbsProgress(tasks: WbsProgressNode[]): { progress: number; weight: number } {
  if (tasks.length === 0) return { progress: 0, weight: 0 };

  const childrenOf = new Map<string, WbsProgressNode[]>();
  for (const t of tasks) {
    if (!t.parentTaskId) continue;
    const list = childrenOf.get(t.parentTaskId) ?? [];
    list.push(t);
    childrenOf.set(t.parentTaskId, list);
  }

  const roll = (n: WbsProgressNode): WbsRoll => {
    const kids = childrenOf.get(n.id);
    if (!kids?.length) {
      return { start: +n.planStart, end: +n.planEnd, dur: durationDays(n.planStart, n.planEnd), pct: clampPct(n.progressPct) };
    }
    const rs = kids.map(roll);
    const start = Math.min(...rs.map((r) => r.start));
    const end = Math.max(...rs.map((r) => r.end));
    const totalDur = rs.reduce((s, r) => s + r.dur, 0) || 1;
    const pct = Math.round(rs.reduce((s, r) => s + r.pct * r.dur, 0) / totalDur);
    return { start, end, dur: Math.round((end - start) / MS_PER_DAY) + 1, pct };
  };

  // Roots = tasks whose parent is absent from the set (mirrors buildGanttTree).
  const ids = new Set(tasks.map((t) => t.id));
  const roots = tasks.filter((t) => !t.parentTaskId || !ids.has(t.parentTaskId));
  const rs = roots.map(roll);
  const weight = rs.reduce((s, r) => s + r.dur, 0) || 1;
  const progress = Math.round(rs.reduce((s, r) => s + r.pct * r.dur, 0) / weight);
  return { progress, weight };
}
