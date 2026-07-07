import { describe, it, expect } from 'vitest';
import { assessActivationReadiness, assessPlanningStatus, type ActivationInputs, type PlanningInputs } from '../activation.helpers.js';

const base: ActivationInputs = {
  baselineLocked: true,
  scheduleBaselined: true,
  hasWbs: true,
  deliveryApproach: 'PREDICTIVE',
};

describe('assessActivationReadiness', () => {
  it('can activate when the baseline is locked and the schedule is baselined', () => {
    const r = assessActivationReadiness(base);
    expect(r.canActivate).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });

  it('blocks when the cost baseline is not locked', () => {
    const r = assessActivationReadiness({ ...base, baselineLocked: false });
    expect(r.canActivate).toBe(false);
    expect(r.blockers.map((b) => b.key)).toContain('baselineLock');
  });

  it('blocks when a WBS exists but the schedule is not baselined', () => {
    const r = assessActivationReadiness({ ...base, scheduleBaselined: false });
    expect(r.canActivate).toBe(false);
    expect(r.blockers.map((b) => b.key)).toContain('scheduleBaseline');
  });

  it('treats a missing schedule baseline as a WARNING (not a blocker) when there is no WBS', () => {
    const r = assessActivationReadiness({ ...base, hasWbs: false, scheduleBaselined: false });
    // Baseline lock is still satisfied here, so it can activate; the schedule item is advisory.
    expect(r.canActivate).toBe(true);
    expect(r.warnings.map((w) => w.key)).toContain('scheduleBaseline');
    expect(r.blockers).toHaveLength(0);
  });

  it('reports every failing blocker at once', () => {
    const r = assessActivationReadiness({ baselineLocked: false, scheduleBaselined: false, hasWbs: true, deliveryApproach: 'PREDICTIVE' });
    expect(r.canActivate).toBe(false);
    expect(r.blockers.map((b) => b.key).sort()).toEqual(['baselineLock', 'scheduleBaseline']);
  });
});

const planBase: PlanningInputs = { status: 'CHARTERED', baselineLocked: true, scheduleBaselined: true, hasWbs: true };

describe('assessPlanningStatus', () => {
  it('a DRAFT project has the charter still outstanding', () => {
    const s = assessPlanningStatus({ ...planBase, status: 'DRAFT', baselineLocked: false, scheduleBaselined: false });
    expect(s.charter).toBe(false);
    expect(s.inPlanning).toBe(true);
    expect(s.complete).toBe(false);
  });

  it('flags cost and schedule as outstanding on a freshly-chartered project', () => {
    const s = assessPlanningStatus({ ...planBase, baselineLocked: false, scheduleBaselined: false });
    expect(s.charter).toBe(true);
    expect(s.cost).toBe(false);
    expect(s.schedule).toBe(false);
    expect(s.scheduleNa).toBe(false);
    expect(s.complete).toBe(false);
  });

  it('treats the schedule step as N/A (and satisfied) when there is no WBS', () => {
    const s = assessPlanningStatus({ ...planBase, hasWbs: false, scheduleBaselined: false });
    expect(s.scheduleNa).toBe(true);
    expect(s.schedule).toBe(true);
  });

  it('is complete once charter + cost are done and the schedule is baselined', () => {
    const s = assessPlanningStatus(planBase);
    expect(s.complete).toBe(true);
    expect(s.inPlanning).toBe(true);
  });

  it('is complete when charter + cost are done and there is no WBS to baseline', () => {
    const s = assessPlanningStatus({ ...planBase, hasWbs: false, scheduleBaselined: false });
    expect(s.complete).toBe(true);
  });

  it('is not in planning once the project is executing', () => {
    const s = assessPlanningStatus({ ...planBase, status: 'IN_PROGRESS' });
    expect(s.inPlanning).toBe(false);
  });
});
