import { describe, it, expect } from 'vitest';
import {
  durationDays,
  generateTaskCode,
  buildGanttTree,
  hasDependencyCycle,
  reconcileManpower,
  weightedProgress,
} from '../schedule.helpers.js';

const d = (s: string) => new Date(s);

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

describe('schedule — weighted progress', () => {
  it('weights by budget', () => {
    // 90M @ 100% + 10M @ 0% = 90% overall
    expect(weightedProgress([
      { budgetCost: 90_000_000, progressPct: 100 },
      { budgetCost: 10_000_000, progressPct: 0 },
    ])).toBe(90);
  });
  it('falls back to simple average when no budget', () => {
    expect(weightedProgress([
      { budgetCost: 0, progressPct: 40 },
      { budgetCost: 0, progressPct: 60 },
    ])).toBe(50);
  });
  it('returns 0 for empty', () => {
    expect(weightedProgress([])).toBe(0);
  });
});
