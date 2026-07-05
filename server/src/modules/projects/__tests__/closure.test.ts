import { describe, it, expect } from 'vitest';
import { assessClosureReadiness, type ClosureInputs } from '../closure.helpers.js';

const base: ClosureInputs = {
  leafTaskCount: 5,
  scheduleProgress: 1,
  openChangeRequests: 0,
  openHighRisks: 0,
  openIssues: 0,
  actualCost: 1000,
  deliveryApproach: 'PREDICTIVE',
  openBacklogItems: 0,
  lessonsCount: 1,
  hasAcceptance: true,
};

describe('assessClosureReadiness', () => {
  it('is closeable when schedule is 100% and nothing is outstanding', () => {
    const r = assessClosureReadiness(base);
    expect(r.canClose).toBe(true);
    expect(r.blockers).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('BLOCKS when a WBS exists but schedule is < 100%', () => {
    const r = assessClosureReadiness({ ...base, scheduleProgress: 0.4 });
    expect(r.canClose).toBe(false);
    expect(r.blockers.map((b) => b.key)).toEqual(['schedule']);
    expect(r.blockers[0].detail).toBe('40% complete');
  });

  it('does NOT block a pure-Agile project without a WBS (warns instead)', () => {
    const r = assessClosureReadiness({ ...base, leafTaskCount: 0, deliveryApproach: 'AGILE', scheduleProgress: 0 });
    expect(r.canClose).toBe(true); // no hard blocker
    expect(r.warnings.some((w) => w.key === 'schedule')).toBe(true);
  });

  it('surfaces open CRs, risks, issues and missing AC as warnings (not blockers)', () => {
    const r = assessClosureReadiness({
      ...base,
      openChangeRequests: 2,
      openHighRisks: 1,
      openIssues: 3,
      actualCost: 0,
    });
    expect(r.canClose).toBe(true); // schedule still 100% → closeable
    const warnKeys = r.warnings.map((w) => w.key).sort();
    expect(warnKeys).toEqual(['actualCost', 'changeRequests', 'issues', 'risks']);
  });

  it('warns (does not block) when closing artifacts are missing', () => {
    const r = assessClosureReadiness({ ...base, lessonsCount: 0, hasAcceptance: false });
    expect(r.canClose).toBe(true); // artifacts are advisory
    const warnKeys = r.warnings.map((w) => w.key).sort();
    expect(warnKeys).toEqual(['acceptance', 'lessons']);
  });

  it('adds a backlog check only for AGILE/HYBRID', () => {
    const predictive = assessClosureReadiness({ ...base, openBacklogItems: 4 });
    expect(predictive.items.some((i) => i.key === 'backlog')).toBe(false);

    const hybrid = assessClosureReadiness({ ...base, deliveryApproach: 'HYBRID', openBacklogItems: 4 });
    const backlog = hybrid.items.find((i) => i.key === 'backlog');
    expect(backlog).toBeTruthy();
    expect(backlog!.ok).toBe(false);
    expect(hybrid.canClose).toBe(true); // backlog is a warning, not a blocker
  });
});
