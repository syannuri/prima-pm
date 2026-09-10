import { describe, it, expect } from 'vitest';
import { simulateSchedule, type SimActivity } from '../scheduleSimulation.js';
import type { CpmEdgeInput } from '../schedule.helpers.js';

const act = (id: string, duration: number, startOffset = 0): SimActivity => ({ id, duration, startOffset });
const fs = (predecessorId: string, successorId: string): CpmEdgeInput => ({ predecessorId, successorId, type: 'FS', lagDays: 0 });

// A → B → C, each 10d → deterministic finish 30d, single critical chain.
const chain = () => ({
  activities: [act('A', 10), act('B', 10), act('C', 10)],
  edges: [fs('A', 'B'), fs('B', 'C')],
});

describe('scheduleSimulation — PERT Monte-Carlo over the CPM network', () => {
  it('is deterministic for a fixed seed + inputs', () => {
    const { activities, edges } = chain();
    const a = simulateSchedule(activities, edges, { iterations: 3_000, seed: 9 });
    const b = simulateSchedule(activities, edges, { iterations: 3_000, seed: 9 });
    expect(b).toEqual(a);
  });

  it('reports the deterministic finish = CPM project duration at planned durations', () => {
    const { activities, edges } = chain();
    const r = simulateSchedule(activities, edges, { iterations: 2_000, seed: 1 });
    expect(r.hasNetwork).toBe(true);
    expect(r.deterministicDays).toBe(30);
  });

  it('skews the finish later than plan (pessimistic band wider than optimistic)', () => {
    const { activities, edges } = chain();
    const r = simulateSchedule(activities, edges, { iterations: 8_000, seed: 2, optimisticPct: 0.15, pessimisticPct: 0.4 });
    expect(r.mean).toBeGreaterThan(r.deterministicDays); // right-skewed → expected finish beyond plan
    expect(r.probabilityOnOrBeforePlan).toBeLessThan(0.5); // less than even chance of hitting the plan
  });

  it('produces a monotonic percentile ladder with the reserve at the confidence level', () => {
    const { activities, edges } = chain();
    const r = simulateSchedule(activities, edges, { iterations: 6_000, seed: 3, confidence: 0.8 });
    const { p10, p50, p80, p90, p95 } = r.percentiles;
    expect(p10).toBeLessThanOrEqual(p50);
    expect(p50).toBeLessThanOrEqual(p80);
    expect(p80).toBeLessThanOrEqual(p90);
    expect(p90).toBeLessThanOrEqual(p95);
    expect(r.recommendedDays).toBe(p80);
    expect(r.recommendedDays).toBeGreaterThanOrEqual(p50);
  });

  it('gives every task on a single chain a criticality index of 1', () => {
    const { activities, edges } = chain();
    const r = simulateSchedule(activities, edges, { iterations: 2_000, seed: 4 });
    const map = new Map(r.criticality.map((c) => [c.id, c.index]));
    expect(map.get('A')).toBe(1);
    expect(map.get('B')).toBe(1);
    expect(map.get('C')).toBe(1);
  });

  it('ranks the longer parallel path as more often critical', () => {
    // Start S → (long L=20) and (short H=5) → both feed End E. Long path dominates.
    const activities = [act('S', 5), act('L', 20), act('H', 5), act('E', 5)];
    const edges = [fs('S', 'L'), fs('S', 'H'), fs('L', 'E'), fs('H', 'E')];
    const r = simulateSchedule(activities, edges, { iterations: 6_000, seed: 5 });
    const idx = new Map(r.criticality.map((c) => [c.id, c.index]));
    expect((idx.get('L') ?? 0)).toBeGreaterThan(idx.get('H') ?? 0);
    expect((idx.get('L') ?? 0)).toBeGreaterThan(0.8);
  });

  it('falls back to the date-anchored model when there is no dependency network', () => {
    // No edges. Two independent activities with start offsets; finish = max(offset+dur).
    const activities = [act('X', 10, 0), act('Y', 8, 20)]; // Y starts day 20 → finishes ~28 > X's ~10
    const r = simulateSchedule(activities, [], { iterations: 3_000, seed: 6 });
    expect(r.hasNetwork).toBe(false);
    expect(r.criticality).toEqual([]);
    expect(r.deterministicDays).toBe(28); // 20 + 8
    expect(r.mean).toBeGreaterThan(20);
  });

  it('handles an empty schedule and clamps options', () => {
    const empty = simulateSchedule([], [], { iterations: 10, confidence: 2, seed: 1 });
    expect(empty.activityCount).toBe(0);
    expect(empty.recommendedDays).toBe(0);
    expect(empty.iterations).toBe(1_000); // floored to minimum
    expect(empty.confidence).toBe(0.99); // capped
  });

  it('triangular distribution also runs and stays ordered', () => {
    const { activities, edges } = chain();
    const r = simulateSchedule(activities, edges, { iterations: 3_000, seed: 7, distribution: 'triangular' });
    expect(r.distribution).toBe('triangular');
    expect(r.percentiles.p50).toBeLessThanOrEqual(r.percentiles.p90);
  });
});
