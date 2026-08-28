import { describe, it, expect } from 'vitest';
import { classifyDelta, aggregate, EFFECTIVENESS_MIN_SAMPLE, type OutcomeRow } from '../aiActionOutcomes.service.js';

// Pure verdict/aggregation math — the integration test proves the DB wiring + tenant scope.
describe('classifyDelta', () => {
  it('IMPROVED at/above +threshold, WORSENED at/below -threshold, UNCHANGED inside', () => {
    expect(classifyDelta(0.05)).toBe('IMPROVED');
    expect(classifyDelta(0.03)).toBe('IMPROVED'); // boundary is inclusive
    expect(classifyDelta(0.029)).toBe('UNCHANGED');
    expect(classifyDelta(0)).toBe('UNCHANGED');
    expect(classifyDelta(-0.029)).toBe('UNCHANGED');
    expect(classifyDelta(-0.03)).toBe('WORSENED');
    expect(classifyDelta(-0.2)).toBe('WORSENED');
  });

  it('INCONCLUSIVE when the delta is missing/non-finite', () => {
    expect(classifyDelta(null)).toBe('INCONCLUSIVE');
    expect(classifyDelta(NaN)).toBe('INCONCLUSIVE');
    expect(classifyDelta(Infinity)).toBe('INCONCLUSIVE'); // Number.isFinite guards NaN and ±Infinity
  });

  it('honours a custom threshold', () => {
    expect(classifyDelta(0.05, 0.1)).toBe('UNCHANGED');
    expect(classifyDelta(0.12, 0.1)).toBe('IMPROVED');
  });
});

describe('aggregate', () => {
  const rows = (verdicts: string[], actionType = 'TIDY_SCHEDULE', delta = 0.05): OutcomeRow[] =>
    verdicts.map((v) => ({ actionType, verdict: v, spiDelta: v === 'IMPROVED' ? delta : v === 'WORSENED' ? -delta : 0 }));

  it('counts verdicts and computes improvedRate once the sample floor is met', () => {
    const [stat] = aggregate(rows(['IMPROVED', 'IMPROVED', 'IMPROVED', 'WORSENED']));
    expect(stat.actionType).toBe('TIDY_SCHEDULE');
    expect(stat.measured).toBe(4);
    expect(stat.improved).toBe(3);
    expect(stat.worsened).toBe(1);
    expect(stat.improvedRate).toBeCloseTo(0.75);
    expect(stat.sampleSize).toBe(4);
  });

  it('returns a null improvedRate below the sample floor (still reports sampleSize)', () => {
    const [stat] = aggregate(rows(Array(EFFECTIVENESS_MIN_SAMPLE - 1).fill('IMPROVED')));
    expect(stat.measured).toBe(EFFECTIVENESS_MIN_SAMPLE - 1);
    expect(stat.improvedRate).toBeNull();
  });

  it('ignores non-measured verdicts (PENDING/ADVISORY/INCONCLUSIVE)', () => {
    const stats = aggregate([
      ...rows(['IMPROVED', 'UNCHANGED', 'WORSENED']),
      { actionType: 'TIDY_SCHEDULE', verdict: 'PENDING', spiDelta: null },
      { actionType: 'CREATE_RISK', verdict: 'ADVISORY', spiDelta: null },
      { actionType: 'TIDY_SCHEDULE', verdict: 'INCONCLUSIVE', spiDelta: null },
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0].measured).toBe(3);
  });

  it('groups per action type and sorts by measured count desc', () => {
    const stats = aggregate([
      ...rows(['IMPROVED', 'UNCHANGED'], 'UPDATE_TASK_PROGRESS'),
      ...rows(['IMPROVED', 'IMPROVED', 'WORSENED'], 'TIDY_SCHEDULE'),
    ]);
    expect(stats.map((s) => s.actionType)).toEqual(['TIDY_SCHEDULE', 'UPDATE_TASK_PROGRESS']);
    expect(stats[0].avgSpiDelta).toBeCloseTo((0.05 + 0.05 - 0.05) / 3);
  });
});
