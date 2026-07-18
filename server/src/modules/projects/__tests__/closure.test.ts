import { describe, it, expect } from 'vitest';
import { assessClosureReadiness, type ClosureInputs } from '../closure.helpers.js';

const predictive: ClosureInputs = {
  deliveryApproach: 'PREDICTIVE',
  wbsLeafCount: 5,
  wbsProgress: 1,
  backlogTotal: 0,
  backlogOpen: 0,
  backlogDone: 0,
  backlogDeferred: 0,
  openChangeRequests: 0,
  openHighRisks: 0,
  openIssues: 0,
  actualCost: 1000,
  lessonsCount: 1,
  hasAcceptance: true,
};

const agile: ClosureInputs = {
  ...predictive,
  deliveryApproach: 'AGILE',
  wbsLeafCount: 0,
  wbsProgress: 0,
  backlogTotal: 5,
  backlogOpen: 0,
  backlogDone: 5,
  backlogDeferred: 0,
};

describe('assessClosureReadiness — predictive', () => {
  it('closeable when WBS is 100% and nothing is outstanding', () => {
    const r = assessClosureReadiness(predictive);
    expect(r.canClose).toBe(true);
    expect(r.blockers).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('BLOCKS when a WBS exists but schedule is < 100%', () => {
    const r = assessClosureReadiness({ ...predictive, wbsProgress: 0.4 });
    expect(r.canClose).toBe(false);
    expect(r.blockers.map((b) => b.key)).toEqual(['schedule']);
    expect(r.blockers[0].detail).toBe('40% complete');
  });

  it('acceptance is only a WARNING for predictive', () => {
    const r = assessClosureReadiness({ ...predictive, hasAcceptance: false });
    expect(r.canClose).toBe(true);
    expect(r.warnings.some((w) => w.key === 'acceptance')).toBe(true);
  });

  it('surfaces open CRs, risks, issues and missing AC as warnings (not blockers)', () => {
    const r = assessClosureReadiness({ ...predictive, openChangeRequests: 2, openHighRisks: 1, openIssues: 3, actualCost: 0 });
    expect(r.canClose).toBe(true);
    expect(r.warnings.map((w) => w.key).sort()).toEqual(['actualCost', 'changeRequests', 'issues', 'risks']);
  });
});

describe('assessClosureReadiness — agile scope is ITEM-based, not story points', () => {
  it('BLOCKS when backlog items are still open (the points-trap: PRJ-2026-0013)', () => {
    // Only 1 of 5 items was estimated (and done) → points said 100%, yet 3 items are open.
    const r = assessClosureReadiness({ ...agile, backlogTotal: 5, backlogDone: 2, backlogOpen: 3 });
    expect(r.canClose).toBe(false);
    expect(r.blockers.map((b) => b.key)).toContain('scope');
    expect(r.blockers.find((b) => b.key === 'scope')!.detail).toContain('3 still open');
  });

  it('closeable when every item is done and acceptance is on record', () => {
    expect(assessClosureReadiness(agile).canClose).toBe(true);
  });

  it('DEFERRED (descoped) items do NOT count as open', () => {
    const r = assessClosureReadiness({ ...agile, backlogTotal: 5, backlogDone: 2, backlogOpen: 0, backlogDeferred: 3 });
    expect(r.canClose).toBe(true);
    const scope = r.items.find((i) => i.key === 'scope')!;
    expect(scope.ok).toBe(true);
    expect(scope.detail).toContain('3 deferred');
  });

  it('formal acceptance is a HARD BLOCK for agile', () => {
    const r = assessClosureReadiness({ ...agile, hasAcceptance: false });
    expect(r.canClose).toBe(false);
    expect(r.blockers.map((b) => b.key)).toContain('acceptance');
  });

  it('a pure-agile project with no backlog warns on scope but is not blocked by it', () => {
    const r = assessClosureReadiness({ ...agile, backlogTotal: 0, backlogDone: 0, backlogOpen: 0 });
    expect(r.canClose).toBe(true); // acceptance present; scope is only a warning here
    expect(r.warnings.some((w) => w.key === 'scope')).toBe(true);
  });
});

describe('assessClosureReadiness — hybrid needs BOTH gates', () => {
  const hybrid: ClosureInputs = { ...agile, deliveryApproach: 'HYBRID', wbsLeafCount: 4, wbsProgress: 1 };

  it('BLOCKS on the WBS schedule even when the backlog scope is complete', () => {
    const r = assessClosureReadiness({ ...hybrid, wbsProgress: 0.5 });
    expect(r.canClose).toBe(false);
    expect(r.blockers.map((b) => b.key)).toContain('schedule');
  });

  it('BLOCKS on backlog scope even when the WBS is complete', () => {
    const r = assessClosureReadiness({ ...hybrid, backlogOpen: 2, backlogDone: 3 });
    expect(r.canClose).toBe(false);
    expect(r.blockers.map((b) => b.key)).toContain('scope');
  });

  it('closeable when WBS is 100%, backlog scope is complete and acceptance is on record', () => {
    expect(assessClosureReadiness(hybrid).canClose).toBe(true);
  });
});
