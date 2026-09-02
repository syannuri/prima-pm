// =====================================================================
// Resource-aware leveling — PURE engine (no DB, no LLM).
//
// The AI timeline proposes a logical FS network + a resource role per task. This module turns that
// into a *feasible* plan two ways, deterministically:
//   1) resolveAssignments() — map each task onto a pool resource (by explicit ref, else fuzzy role).
//   2) planLevelingEdges()  — add the MINIMUM extra finish-to-start edges so no resource is booked
//      beyond its capacity: same-resource tasks that would otherwise overlap get serialised, while
//      tasks on different resources (or with spare capacity) stay parallel.
//
// Leveling emits EDGES, not dates: the existing weekend-aware auto-scheduler then computes the
// calendar from the combined (logical + leveling) network. Bounded (<= MAX_TOTAL_TASKS) so the
// O(n·C) list-scheduling is trivially cheap. Unit-tested without a DB.
// =====================================================================

import { normalizeLabel } from './scheduleResource.helpers.js';

export interface PoolEntry {
  ref: string;
  label: string;
  capacityPerDay: number;
  resourceId?: string;
}

// A task carrying just what assignment needs. `id` is the stable key used in the returned map and in
// leveling edges (the planned-row id downstream; a ref in tests).
export interface AssignTask {
  id: string;
  resourceRole?: string | null;
  resourceRef?: string | null;
}

export interface LevelTask {
  id: string;
  durationDays: number;
  sortOrder: number; // deterministic tie-break (creation order)
  poolRef: string | null; // resolved resource; null → excluded from leveling
  isMilestone?: boolean;
}

export interface LevelEdge {
  predecessorId: string;
  successorId: string;
}

// --- Assignment ------------------------------------------------------------------------------

/**
 * Fuzzy-match a role string to a pool ref. Scoring (higher wins, first pool entry breaks ties):
 * exact normalised label = 3, role ⊆ label = 2, label ⊆ role = 1, else no match. Returns the pool
 * ref or null. Empty/blank role → null.
 */
export function matchRoleToPool(role: string | null | undefined, pool: PoolEntry[]): string | null {
  const r = normalizeLabel(role ?? '');
  if (!r) return null;
  let bestRef: string | null = null;
  let bestScore = 0;
  for (const p of pool) {
    const l = normalizeLabel(p.label);
    if (!l) continue;
    const score = l === r ? 3 : l.includes(r) ? 2 : r.includes(l) ? 1 : 0;
    if (score > bestScore) { bestScore = score; bestRef = p.ref; }
  }
  return bestScore > 0 ? bestRef : null;
}

/**
 * Resolve each task to a pool ref: an explicit valid `resourceRef` wins, else a fuzzy `resourceRole`
 * match, else null (unassigned → never leveled, never auto-owned). Returns id → poolRef | null.
 */
export function resolveAssignments(tasks: AssignTask[], pool: PoolEntry[]): Map<string, string | null> {
  const validRef = new Set(pool.map((p) => p.ref));
  const out = new Map<string, string | null>();
  for (const t of tasks) {
    if (t.resourceRef && validRef.has(t.resourceRef)) out.set(t.id, t.resourceRef);
    else out.set(t.id, matchRoleToPool(t.resourceRole, pool));
  }
  return out;
}

// --- Leveling --------------------------------------------------------------------------------

const dur = (t: LevelTask): number => (t.isMilestone || t.durationDays <= 0 ? 0 : t.durationDays);

/**
 * Longest-path early start (in days) over an acyclic FS network: earlyStart(t) = max over
 * predecessors of earlyStart(pred) + dur(pred); sources start at 0. Robust to (unexpected) cycles —
 * any node not resolved by the topological pass falls back to 0 so leveling still runs.
 */
export function computeEarlyStarts(tasks: LevelTask[], deps: LevelEdge[]): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const succ = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const t of tasks) indeg.set(t.id, 0);
  for (const e of deps) {
    if (!byId.has(e.predecessorId) || !byId.has(e.successorId)) continue;
    (succ.get(e.predecessorId) ?? succ.set(e.predecessorId, []).get(e.predecessorId)!).push(e.successorId);
    indeg.set(e.successorId, (indeg.get(e.successorId) ?? 0) + 1);
  }
  const early = new Map<string, number>(tasks.map((t) => [t.id, 0]));
  // Kahn topological order; process sources first (deterministic by input order).
  const queue = tasks.filter((t) => (indeg.get(t.id) ?? 0) === 0).map((t) => t.id);
  const idle = new Map(indeg);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const finish = (early.get(id) ?? 0) + dur(byId.get(id)!);
    for (const s of succ.get(id) ?? []) {
      if (finish > (early.get(s) ?? 0)) early.set(s, finish);
      idle.set(s, (idle.get(s) ?? 0) - 1);
      if ((idle.get(s) ?? 0) === 0) queue.push(s);
    }
  }
  return early;
}

/**
 * Add the minimal FS edges to respect per-resource capacity. For each resource, run list-scheduling
 * on C = max(1, floor(capacity)) lanes ordered by (earlyStart, sortOrder, id): a task takes the
 * earliest-free lane; if that lane's previous occupant still holds it past the task's dependency-
 * driven early start (a real overlap), we serialise them with an edge prev → task. Tasks on other
 * resources, or fitting within spare capacity, get no edge and stay parallel.
 *
 * Milestones (zero work) and unassigned tasks are excluded. `deps` are the already-acyclic logical
 * edges; the returned edges are additive and de-duplicated against `deps`.
 */
export function planLevelingEdges(
  tasks: LevelTask[],
  deps: LevelEdge[],
  capacityByPoolRef: Map<string, number>,
): LevelEdge[] {
  const early = computeEarlyStarts(tasks, deps);
  const existing = new Set(deps.map((e) => `${e.predecessorId}->${e.successorId}`));
  const edges: LevelEdge[] = [];
  const emitted = new Set<string>();

  // Group leveling-eligible tasks by resource.
  const groups = new Map<string, LevelTask[]>();
  for (const t of tasks) {
    if (!t.poolRef || dur(t) === 0) continue;
    (groups.get(t.poolRef) ?? groups.set(t.poolRef, []).get(t.poolRef)!).push(t);
  }

  for (const [poolRef, group] of groups) {
    const capacity = capacityByPoolRef.get(poolRef);
    const lanes = Math.max(1, Math.floor(capacity ?? 1));
    group.sort((a, b) =>
      (early.get(a.id)! - early.get(b.id)!) || (a.sortOrder - b.sortOrder) || (a.id < b.id ? -1 : 1),
    );
    // Each lane tracks when it frees up and who last held it.
    const laneFreeAt = new Array<number>(lanes).fill(0);
    const laneLast = new Array<string | null>(lanes).fill(null);
    for (const t of group) {
      // Pick the earliest-free lane (lowest index breaks ties → deterministic).
      let li = 0;
      for (let i = 1; i < lanes; i++) if (laneFreeAt[i] < laneFreeAt[li]) li = i;
      const es = early.get(t.id)!;
      // Contention: the lane's previous occupant overruns this task's dependency-driven start.
      if (laneLast[li] !== null && laneFreeAt[li] > es) {
        const key = `${laneLast[li]}->${t.id}`;
        if (!existing.has(key) && !emitted.has(key)) { emitted.add(key); edges.push({ predecessorId: laneLast[li]!, successorId: t.id }); }
      }
      const start = Math.max(es, laneFreeAt[li]);
      laneFreeAt[li] = start + dur(t);
      laneLast[li] = t.id;
    }
  }
  return edges;
}
