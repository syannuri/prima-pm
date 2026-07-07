import { describe, it, expect } from 'vitest';
import {
  durationDays,
  generateTaskCode,
  buildGanttTree,
  hasDependencyCycle,
  reconcileManpower,
  isCostLoaded,
} from '../schedule.helpers.js';

const d = (s: string) => new Date(s);

describe('schedule — cost-loaded weighting decision (isCostLoaded)', () => {
  it('is true only when every real-duration leaf carries a cost (fully costed)', () => {
    expect(isCostLoaded([{ cost: 100, durationDays: 3 }, { cost: 50, durationDays: 2 }])).toBe(true);
  });

  it('is FALSE when the WBS is only partially costed — the SAP HANA bug', () => {
    // 1 of 4 leaves costed, the rest have real duration but no cost → duration weighting,
    // so the uncosted (incomplete) leaves still count instead of collapsing to weight 0.
    expect(
      isCostLoaded([
        { cost: 30_000_000, durationDays: 4 },
        { cost: 0, durationDays: 3 },
        { cost: 0, durationDays: 2 },
        { cost: 0, durationDays: 2 },
      ]),
    ).toBe(false);
  });

  it('is false when no leaf has any cost (pure duration weighting)', () => {
    expect(isCostLoaded([{ cost: 0, durationDays: 4 }, { cost: 0, durationDays: 2 }])).toBe(false);
  });

  it('exempts zero-duration milestones from the fully-costed check', () => {
    // A costed WBS plus a 0-duration, 0-cost milestone is still "cost-loaded".
    expect(isCostLoaded([{ cost: 100, durationDays: 4 }, { cost: 0, durationDays: 0 }])).toBe(true);
  });

  it('is false for an all-milestone (all zero-duration, zero-cost) WBS → equal-weight fallback', () => {
    expect(isCostLoaded([{ cost: 0, durationDays: 0 }, { cost: 0, durationDays: 0 }])).toBe(false);
  });
});

describe('schedule — duration & code', () => {
  it('counts whole days, never negative', () => {
    expect(durationDays(d('2026-01-01'), d('2026-01-11'))).toBe(10);
    expect(durationDays(d('2026-01-11'), d('2026-01-01'))).toBe(0);
  });
  it('zero-pads task codes', () => {
    expect(generateTaskCode(7)).toBe('T-007');
  });
});

describe('schedule — gantt tree', () => {
  it('nests subtasks under parents, sorted by sortOrder', () => {
    const tree = buildGanttTree([
      { id: 'a', parentTaskId: null, sortOrder: 2, name: 'Phase B' },
      { id: 'b', parentTaskId: null, sortOrder: 1, name: 'Phase A' },
      { id: 'a1', parentTaskId: 'a', sortOrder: 2, name: 'A task 2' },
      { id: 'a2', parentTaskId: 'a', sortOrder: 1, name: 'A task 1' },
    ]);
    expect(tree.map((t) => t.id)).toEqual(['b', 'a']); // sorted roots
    const phaseB = tree.find((t) => t.id === 'a')!;
    expect(phaseB.children.map((c) => c.id)).toEqual(['a2', 'a1']); // sorted children
  });

  it('treats orphaned parent refs as roots', () => {
    const tree = buildGanttTree([{ id: 'x', parentTaskId: 'missing', sortOrder: 1, name: 'X' }]);
    expect(tree).toHaveLength(1);
  });
});

describe('schedule — dependency cycle detection', () => {
  it('passes an acyclic chain', () => {
    expect(hasDependencyCycle([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }])).toBe(false);
  });
  it('detects a direct cycle', () => {
    expect(hasDependencyCycle([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).toBe(true);
  });
  it('detects an indirect cycle', () => {
    expect(
      hasDependencyCycle([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }]),
    ).toBe(true);
  });
});

describe('schedule — manpower reconciliation', () => {
  const rows = reconcileManpower([
    { taskId: '1', taskName: 'Design', planStart: d('2026-01-01'), planEnd: d('2026-01-11'), linkedPlanMandays: 10 },
    { taskId: '2', taskName: 'Build', planStart: d('2026-01-01'), planEnd: d('2026-01-11'), linkedPlanMandays: 15 },
    { taskId: '3', taskName: 'Review', planStart: d('2026-01-01'), planEnd: d('2026-01-11'), linkedPlanMandays: 6 },
    { taskId: '4', taskName: 'Idle', planStart: d('2026-01-01'), planEnd: d('2026-01-11'), linkedPlanMandays: 0 },
  ]);

  it('flags OK / OVER / UNDER / NO_MANPOWER', () => {
    expect(rows[0].status).toBe('OK'); // 10 mandays vs 10 days
    expect(rows[1].status).toBe('OVER_ALLOCATED'); // 15 > 10
    expect(rows[1].variance).toBe(5);
    expect(rows[2].status).toBe('UNDER_ALLOCATED'); // 6 < 10
    expect(rows[3].status).toBe('NO_MANPOWER');
  });
});

// NOTE: the hierarchical weightedProgress/wbsProgress helpers were removed (dead code —
// see schedule.helpers.ts). Project progress is covered by the EVM engine tests
// (calc/__tests__) via the authoritative flat leaf-weighted `weightedProgress`.
