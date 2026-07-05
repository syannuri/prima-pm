import { describe, it, expect } from 'vitest';
import { assessActivationReadiness, type ActivationInputs } from '../activation.helpers.js';

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
