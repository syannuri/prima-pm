import { describe, it, expect } from 'vitest';
import { computeCpm, type CpmEdgeInput } from './schedule.helpers.js';

const fs = (predecessorId: string, successorId: string, lagDays = 0): CpmEdgeInput => ({ predecessorId, successorId, type: 'FS', lagDays });

describe('computeCpm', () => {
  // Classic diamond: A→B→D→E and A→C→D→E; path A-B-D-E (13) is critical, C has slack.
  const tasks = [
    { id: 'A', duration: 3 }, { id: 'B', duration: 4 }, { id: 'C', duration: 2 },
    { id: 'D', duration: 5 }, { id: 'E', duration: 1 },
  ];
  const edges = [fs('A', 'B'), fs('A', 'C'), fs('B', 'D'), fs('C', 'D'), fs('D', 'E')];

  it('computes the project duration (longest path)', () => {
    expect(computeCpm(tasks, edges).projectDuration).toBe(13);
  });

  it('identifies the critical path (float-0 activities)', () => {
    const r = computeCpm(tasks, edges);
    expect(r.criticalTaskIds.sort()).toEqual(['A', 'B', 'D', 'E']);
    expect(r.tasks.A.critical).toBe(true);
    expect(r.tasks.C.critical).toBe(false);
  });

  it('gives the non-critical activity its correct total float', () => {
    const r = computeCpm(tasks, edges);
    expect(r.tasks.C.totalFloat).toBe(2); // A-C-D-E is 2 days shorter than A-B-D-E
    expect(r.tasks.B.totalFloat).toBe(0);
  });

  it('computes early/late start & finish for a critical activity', () => {
    const r = computeCpm(tasks, edges);
    expect(r.tasks.D).toMatchObject({ es: 7, ef: 12, ls: 7, lf: 12, totalFloat: 0 });
  });

  it('honours a finish-to-start lag', () => {
    const r = computeCpm([{ id: 'A', duration: 3 }, { id: 'B', duration: 2 }], [fs('A', 'B', 5)]);
    expect(r.tasks.B.es).toBe(8); // A finishes at 3, +5 lag → B starts at 8
    expect(r.projectDuration).toBe(10);
  });

  it('supports SS and FF dependency types', () => {
    // B start-to-start after A with 2d lag; both 4d.
    const ss = computeCpm([{ id: 'A', duration: 4 }, { id: 'B', duration: 4 }], [{ predecessorId: 'A', successorId: 'B', type: 'SS', lagDays: 2 }]);
    expect(ss.tasks.B.es).toBe(2);
    // B finish-to-finish after A with 1d lag.
    const ff = computeCpm([{ id: 'A', duration: 4 }, { id: 'B', duration: 2 }], [{ predecessorId: 'A', successorId: 'B', type: 'FF', lagDays: 1 }]);
    expect(ff.tasks.B.ef).toBe(5); // A finishes at 4, +1 → B finishes at 5, so B starts at 3
  });

  it('flags a cyclic network instead of looping forever', () => {
    const r = computeCpm([{ id: 'A', duration: 1 }, { id: 'B', duration: 1 }], [fs('A', 'B'), fs('B', 'A')]);
    expect(r.cyclic).toBe(true);
    expect(r.hasNetwork).toBe(true);
  });

  it('reports no network when there are no dependencies', () => {
    const r = computeCpm([{ id: 'A', duration: 3 }, { id: 'B', duration: 2 }], []);
    expect(r.hasNetwork).toBe(false);
    expect(r.criticalTaskIds).toHaveLength(0);
  });
});
