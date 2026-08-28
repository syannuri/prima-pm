import { describe, it, expect } from 'vitest';
import { applyScenario, type Leaf } from '../whatif.service.js';
import type { CpmEdgeInput } from '../../schedule/schedule.helpers.js';

// Pure scenario math (schedule propagation + EAC/VAC). The DB wiring is covered by whatif.itest.
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
// A (Mon Mar 2 – Fri Mar 6) → B (Mon Mar 9 – Fri Mar 13), finish-to-start.
const leaves: Leaf[] = [
  { id: 'a', name: 'Task A', planStart: d('2026-03-02'), planEnd: d('2026-03-06') },
  { id: 'b', name: 'Task B', planStart: d('2026-03-09'), planEnd: d('2026-03-13') },
];
const edges: CpmEdgeInput[] = [{ predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0 }];
const metrics = { bac: 1000, ev: 500, ac: 500, spi: 1, cpi: 1 }; // EAC(likely)=bac/cpi=1000, VAC=0

describe('applyScenario', () => {
  it('no changes → zero deltas', () => {
    const r = applyScenario(leaves, edges, metrics, {});
    expect(r.deltas.finishDays).toBe(0);
    expect(r.deltas.eacIdr).toBe(0);
    expect(r.deltas.vacIdr).toBe(0);
  });

  it('shifting the predecessor pushes the project finish (dependency propagation)', () => {
    const r = applyScenario(leaves, edges, metrics, { taskChanges: [{ taskId: 'a', shiftDays: 7 }] });
    expect(r.deltas.finishDays).toBeGreaterThanOrEqual(5); // ~7; B is pushed after A
    expect(r.scenario.movedTaskCount).toBeGreaterThanOrEqual(1);
  });

  it('a worse go-forward CPI raises EAC and lowers VAC (exact arithmetic)', () => {
    const r = applyScenario(leaves, edges, metrics, { assumeCpi: 0.5 });
    expect(r.scenario.eac).toBe(2000);   // 1000 / 0.5
    expect(r.deltas.eacIdr).toBe(1000);
    expect(r.deltas.vacIdr).toBe(-1000);
  });

  it('a budget delta moves BAC and EAC', () => {
    const r = applyScenario(leaves, edges, metrics, { bacDeltaIdr: 500 });
    expect(r.scenario.bac).toBe(1500);
    expect(r.scenario.eac).toBe(1500);   // 1500 / 1
    expect(r.deltas.eacIdr).toBe(500);
    expect(r.deltas.vacIdr).toBe(0);
  });

  it('a worse go-forward SPI pushes the forecast finish out', () => {
    const r = applyScenario(leaves, edges, metrics, { assumeSpi: 0.5 });
    expect(r.deltas.forecastFinishDays).toBeGreaterThan(0);
    expect(r.deltas.finishDays).toBe(0); // the planned schedule itself is unchanged
  });

  it('drops an unknown taskId and flags the effort-driven caveat on a duration change', () => {
    const r = applyScenario(leaves, edges, metrics, { taskChanges: [
      { taskId: 'nope', shiftDays: 5 },
      { taskId: 'b', durationScale: 0.5 },
    ] });
    expect(r.applied.taskChanges.map((t) => t.taskId)).toEqual(['b']); // unknown dropped
    expect(r.notes.some((n) => n.toLowerCase().includes('date-driven'))).toBe(true);
  });
});
