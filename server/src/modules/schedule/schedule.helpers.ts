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

// =====================================================================
// Auto-scheduling — working-day (weekend-aware) dependency propagation.
// Pure & unit-testable. Given each leaf's current plan dates + the FS/SS/FF/SF
// dependency edges, push any successor that VIOLATES its constraint to the
// earliest legal date (durations preserved) and cascade downstream. Push-only:
// tasks are never pulled earlier than where they sit, so unrelated work stays put
// and only genuinely-blocked tasks move ("minimal moves", MS-Project default).
//
// All math is in working days (Mon–Fri); Saturdays/Sundays are skipped. Lag is
// counted in working days too. Holidays are a future extension point (see
// isWorkingDay). Dates are normalised to UTC midnight so results are stable
// regardless of the stored time-of-day.
// =====================================================================

/** True for Mon–Fri. Holidays could be folded in here later. */
export function isWorkingDay(ms: number): boolean {
  const day = new Date(ms).getUTCDay();
  return day !== 0 && day !== 6; // 0 = Sun, 6 = Sat
}

/** Floor a timestamp to UTC midnight (day granularity). */
function floorDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

/**
 * Advance `n` working days from `ms` (n may be negative). The base day itself is
 * NOT snapped when n === 0. addWorkingDays(Fri, 1) === Mon.
 */
export function addWorkingDays(ms: number, n: number): number {
  let cursor = floorDay(ms);
  if (n === 0) return cursor;
  const step = n > 0 ? MS_PER_DAY : -MS_PER_DAY;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    cursor += step;
    if (isWorkingDay(cursor)) remaining--;
  }
  return cursor;
}

/** Count working days in the half-open span [a, b) (>= 0). A task's "duration". */
export function workingDaysBetween(aMs: number, bMs: number): number {
  let cursor = floorDay(aMs);
  const end = floorDay(bMs);
  if (end <= cursor) return 0;
  let count = 0;
  while (cursor < end) {
    if (isWorkingDay(cursor)) count++;
    cursor += MS_PER_DAY;
  }
  return count;
}

export interface AutoTaskInput { id: string; planStart: Date; planEnd: Date }
export interface AutoScheduledTask { start: number; end: number } // epoch ms, UTC midnight
export interface AutoScheduleResult {
  cyclic: boolean;
  tasks: Record<string, AutoScheduledTask>;
  /** ids whose start OR end moved vs. their input plan dates. */
  moved: string[];
}

/** Scheduling mode:
 *  - 'push' (default): push-only — a task never moves earlier than where it sits;
 *    only successors that VIOLATE a constraint are shifted forward. Minimal moves.
 *  - 'asap': compact — every task WITH predecessors snaps to the earliest legal
 *    working-day date (may pull earlier, closing gaps left by removed/edited links).
 *    Tasks with no predecessors stay anchored where they are. */
export type AutoScheduleMode = 'push' | 'asap';

/**
 * Weekend-aware forward pass. Reuses the CPM constraint formulas but in working-day
 * date space. Only leaf tasks should be passed (parents roll up). See AutoScheduleMode.
 */
export function autoSchedule(tasks: AutoTaskInput[], edges: CpmEdgeInput[], mode: AutoScheduleMode = 'push'): AutoScheduleResult {
  const ids = new Set(tasks.map((t) => t.id));
  const es_edges = edges.filter((e) => ids.has(e.predecessorId) && ids.has(e.successorId));
  const origStart = new Map(tasks.map((t) => [t.id, floorDay(+t.planStart)]));
  const durWd = new Map(tasks.map((t) => [t.id, workingDaysBetween(+t.planStart, +t.planEnd)]));

  const emptyResult = (cyclic: boolean): AutoScheduleResult => ({
    cyclic,
    tasks: Object.fromEntries(tasks.map((t) => [t.id, { start: origStart.get(t.id)!, end: addWorkingDays(origStart.get(t.id)!, durWd.get(t.id)!) }])),
    moved: [],
  });
  if (es_edges.length === 0) return emptyResult(false);
  if (hasDependencyCycle(es_edges.map((e) => ({ from: e.predecessorId, to: e.successorId })))) {
    return emptyResult(true); // leave dates untouched if the network is cyclic
  }

  // Adjacency + Kahn topological order over the task set.
  const inAdj = new Map<string, CpmEdgeInput[]>();
  const outAdj = new Map<string, CpmEdgeInput[]>();
  const indeg = new Map<string, number>();
  for (const t of tasks) { inAdj.set(t.id, []); outAdj.set(t.id, []); indeg.set(t.id, 0); }
  for (const e of es_edges) {
    inAdj.get(e.successorId)!.push(e);
    outAdj.get(e.predecessorId)!.push(e);
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

  const start = new Map(origStart);
  const D = (id: string) => durWd.get(id) ?? 0;
  const endOf = (id: string) => addWorkingDays(start.get(id)!, D(id));
  for (const id of topo) {
    const incoming = inAdj.get(id) ?? [];
    // push: floor at current start (never earlier). asap: a constrained task is pulled
    // to its earliest legal date, so start unbounded-below; a root task stays anchored.
    let required = mode === 'asap' && incoming.length > 0 ? -Infinity : start.get(id)!;
    for (const e of incoming) {
      const pStart = start.get(e.predecessorId)!;
      const pEnd = endOf(e.predecessorId);
      const cand =
        e.type === 'FS' ? addWorkingDays(pEnd, e.lagDays) :
        e.type === 'SS' ? addWorkingDays(pStart, e.lagDays) :
        // FF/SF constrain the successor's FINISH; back off its duration to a start.
        e.type === 'FF' ? addWorkingDays(addWorkingDays(pEnd, e.lagDays), -D(id)) :
        /* SF */ addWorkingDays(addWorkingDays(pStart, e.lagDays), -D(id));
      if (cand > required) required = cand;
    }
    start.set(id, required);
  }

  const result: Record<string, AutoScheduledTask> = {};
  const moved: string[] = [];
  for (const t of tasks) {
    const s = start.get(t.id)!;
    const e = addWorkingDays(s, D(t.id));
    result[t.id] = { start: s, end: e };
    // "moved" = pushed by a constraint (start shifted forward). We deliberately do
    // NOT flag disconnected tasks whose stored span merely straddled a weekend —
    // push-only means unrelated work stays exactly where it is.
    if (s !== origStart.get(t.id)!) moved.push(t.id);
  }
  return { cyclic: false, tasks: result, moved };
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

// --- Weighted work-package roll-up (Model B) ---
// The authoritative project progress is the flat leaf-weighted `weightedProgress`
// computed inside the EVM engine (server/src/calc/evm.ts). To let a PMO steer that
// number top-down, any task may carry a manual relative `weight`. We convert the WBS
// tree + manual weights into EFFECTIVE LEAF WEIGHTS which are fed to the SAME engine as
// `budgetCost`, so `weightedProgress`, EV, PV, CPI and SPI stay one consistent number.
//
// Rule: a node's children split their parent's share by their manual `weight` when set,
// else by the child subtree's fallback `proxy` (linked cost, or duration). A manual
// weight on a Main Task therefore distributes across its leaves pro-rata by proxy.
// When NO manual weight is set anywhere, each leaf's effective weight reproduces its own
// proxy EXACTLY — so EVM is unchanged for every existing project (no drift).

/**
 * Derive a work package's % complete from its weighted progress steps (P6 "weighted steps"):
 * Σ(done step weights) / Σ(step weights), as an integer 0..100. No steps or zero total weight → 0.
 */
export function deriveStepProgress(steps: { weight: number; done: boolean }[]): number {
  const total = steps.reduce((s, st) => s + Math.max(0, st.weight || 0), 0);
  if (total <= 0) return 0;
  const done = steps.reduce((s, st) => s + (st.done ? Math.max(0, st.weight || 0) : 0), 0);
  return Math.round((done / total) * 100);
}

export interface WeightNode {
  id: string;
  parentTaskId: string | null;
  /** Manual relative weight (>= 0). null/undefined = "use the fallback proxy". */
  weight?: number | null;
  /** Fallback weight for a LEAF (cost or duration). Ignored for parents (summed from leaves). */
  proxy: number;
}

/**
 * Distribute the WBS into effective leaf weights honouring manual `weight` overrides.
 * Returns a Map<leafId, weight>. Pure & unit-tested. Callers must ensure leaf proxies are
 * not all zero (e.g. all-milestone uncosted → pass proxy 1 each) so relative weights exist.
 */
export function computeLeafWeights(nodes: WeightNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, WeightNode[]>();
  for (const n of nodes) {
    const parent = n.parentTaskId && byId.has(n.parentTaskId) ? n.parentTaskId : null;
    if (parent) {
      const arr = childrenOf.get(parent) ?? [];
      arr.push(n);
      childrenOf.set(parent, arr);
    }
  }
  const kidsOf = (n: WeightNode) => childrenOf.get(n.id) ?? [];

  // Subtree fallback proxy = Σ leaf proxies beneath the node (leaf = its own proxy).
  const subtreeProxy = new Map<string, number>();
  const subtreeOf = (n: WeightNode): number => {
    const cached = subtreeProxy.get(n.id);
    if (cached !== undefined) return cached;
    const kids = kidsOf(n);
    const v = kids.length ? kids.reduce((s, k) => s + subtreeOf(k), 0) : Math.max(0, n.proxy || 0);
    subtreeProxy.set(n.id, v);
    return v;
  };
  nodes.forEach(subtreeOf);

  // Relative weight among siblings: manual weight when set (>= 0), else subtree proxy.
  const rel = (n: WeightNode) => (n.weight != null && n.weight >= 0 ? n.weight : subtreeProxy.get(n.id)!);

  const out = new Map<string, number>();
  const distribute = (siblings: WeightNode[], incoming: number) => {
    const total = siblings.reduce((s, n) => s + rel(n), 0);
    for (const n of siblings) {
      const share = total > 0 ? (incoming * rel(n)) / total : incoming / siblings.length;
      const kids = kidsOf(n);
      if (kids.length) distribute(kids, share);
      else out.set(n.id, (out.get(n.id) ?? 0) + share);
    }
  };

  const roots = nodes.filter((n) => !(n.parentTaskId && byId.has(n.parentTaskId)));
  // Seed the root incoming with Σ subtree proxy so a weight-free WBS reproduces proxies exactly.
  const rootTotal = roots.reduce((s, n) => s + subtreeOf(n), 0);
  distribute(roots, rootTotal > 0 ? rootTotal : roots.length);
  return out;
}
