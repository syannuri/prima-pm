import { describe, it, expect } from 'vitest';
import {
  matchRoleToPool,
  resolveAssignments,
  computeEarlyStarts,
  planLevelingEdges,
  type PoolEntry,
  type LevelTask,
  type LevelEdge,
} from '../resourceLeveling.js';

const pool: PoolEntry[] = [
  { ref: 'r1', label: 'Andi · Backend Engineer', capacityPerDay: 1, resourceId: 'res-1' },
  { ref: 'r2', label: 'QA Engineer', capacityPerDay: 1 },
  { ref: 'r3', label: 'DevOps', capacityPerDay: 2 },
];

describe('matchRoleToPool', () => {
  it('matches a role that is a substring of a pool label', () => {
    expect(matchRoleToPool('Backend Engineer', pool)).toBe('r1');
  });
  it('matches an exact label', () => {
    expect(matchRoleToPool('QA Engineer', pool)).toBe('r2');
  });
  it('returns null for a blank or unknown role', () => {
    expect(matchRoleToPool('', pool)).toBeNull();
    expect(matchRoleToPool('Astronaut', pool)).toBeNull();
    expect(matchRoleToPool(null, pool)).toBeNull();
  });
});

describe('resolveAssignments', () => {
  it('an explicit valid resourceRef wins over the role', () => {
    const m = resolveAssignments([{ id: 't1', resourceRef: 'r3', resourceRole: 'Backend Engineer' }], pool);
    expect(m.get('t1')).toBe('r3');
  });
  it('falls back to a fuzzy role match when resourceRef is missing/invalid', () => {
    const m = resolveAssignments([
      { id: 't1', resourceRole: 'Backend Engineer' },
      { id: 't2', resourceRef: 'bogus', resourceRole: 'QA Engineer' },
    ], pool);
    expect(m.get('t1')).toBe('r1');
    expect(m.get('t2')).toBe('r2');
  });
  it('unmatched task → null', () => {
    const m = resolveAssignments([{ id: 't1', resourceRole: 'Chef' }], pool);
    expect(m.get('t1')).toBeNull();
  });
});

const task = (id: string, durationDays: number, poolRef: string | null, sortOrder: number, isMilestone = false): LevelTask =>
  ({ id, durationDays, poolRef, sortOrder, isMilestone });

describe('computeEarlyStarts', () => {
  it('longest path over an FS chain', () => {
    const tasks = [task('a', 5, null, 0), task('b', 3, null, 1), task('c', 2, null, 2)];
    const deps: LevelEdge[] = [{ predecessorId: 'a', successorId: 'b' }, { predecessorId: 'b', successorId: 'c' }];
    const es = computeEarlyStarts(tasks, deps);
    expect([es.get('a'), es.get('b'), es.get('c')]).toEqual([0, 5, 8]);
  });
  it('a merge takes the max of its predecessors', () => {
    const tasks = [task('a', 5, null, 0), task('b', 3, null, 1), task('c', 2, null, 2)];
    const deps: LevelEdge[] = [{ predecessorId: 'a', successorId: 'c' }, { predecessorId: 'b', successorId: 'c' }];
    expect(computeEarlyStarts(tasks, deps).get('c')).toBe(5);
  });
});

describe('planLevelingEdges', () => {
  const cap = new Map<string, number>([['r1', 1], ['r2', 1], ['r3', 2]]);

  it('serialises two overlapping same-resource tasks (capacity 1)', () => {
    const tasks = [task('a', 5, 'r1', 0), task('b', 5, 'r1', 1)];
    expect(planLevelingEdges(tasks, [], cap)).toEqual([{ predecessorId: 'a', successorId: 'b' }]);
  });

  it('leaves different-resource tasks parallel (no edges)', () => {
    const tasks = [task('a', 5, 'r1', 0), task('b', 5, 'r2', 1)];
    expect(planLevelingEdges(tasks, [], cap)).toEqual([]);
  });

  it('allows parallelism up to capacity (capacity 2 → no edge for 2 tasks)', () => {
    const tasks = [task('a', 5, 'r3', 0), task('b', 5, 'r3', 1)];
    expect(planLevelingEdges(tasks, [], cap)).toEqual([]);
  });

  it('chains three contending same-resource tasks in order', () => {
    const tasks = [task('a', 4, 'r1', 0), task('b', 4, 'r1', 1), task('c', 4, 'r1', 2)];
    expect(planLevelingEdges(tasks, [], cap)).toEqual([
      { predecessorId: 'a', successorId: 'b' },
      { predecessorId: 'b', successorId: 'c' },
    ]);
  });

  it('excludes milestones and unassigned tasks', () => {
    const tasks = [task('a', 0, 'r1', 0, true), task('b', 5, null, 1), task('c', 5, 'r1', 2)];
    // Only 'c' is eligible → nothing to contend with.
    expect(planLevelingEdges(tasks, [], cap)).toEqual([]);
  });

  it('adds no redundant edge when the logical deps already separate the tasks', () => {
    // a → b already; both on r1. b starts at 5, a frees the lane at 5 → no overlap → no extra edge.
    const tasks = [task('a', 5, 'r1', 0), task('b', 5, 'r1', 1)];
    const deps: LevelEdge[] = [{ predecessorId: 'a', successorId: 'b' }];
    expect(planLevelingEdges(tasks, deps, cap)).toEqual([]);
  });

  it('defaults missing capacity to a single lane', () => {
    const tasks = [task('a', 5, 'rX', 0), task('b', 5, 'rX', 1)];
    expect(planLevelingEdges(tasks, [], new Map())).toEqual([{ predecessorId: 'a', successorId: 'b' }]);
  });
});
