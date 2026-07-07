import { describe, it, expect } from 'vitest';
import { computeNextSteps, type NextStepsInput } from '../nextsteps.helpers.js';

const base: NextStepsInput = {
  status: 'IN_PROGRESS',
  baselineLocked: true,
  scheduleBaselined: true,
  hasWbs: true,
  activationReady: true,
  openHighRisks: 0,
  hasAcceptance: true,
  hasLessons: true,
  closureReady: false,
  canGovern: true, // default: viewer is ADMIN/PMO (can run lifecycle actions)
};

const keys = (i: NextStepsInput) => computeNextSteps(i).steps.map((s) => s.key);

describe('computeNextSteps', () => {
  it('DRAFT → commit the charter', () => {
    expect(keys({ ...base, status: 'DRAFT' })).toEqual(['commitCharter']);
  });

  it('CHARTERED with an unlocked baseline → schedule baseline FIRST, then lock (lock is last)', () => {
    // Locking the cost baseline freezes the WBS, so the schedule baseline must be
    // captured before locking — the guide orders them that way.
    const r = keys({ ...base, status: 'CHARTERED', baselineLocked: false, scheduleBaselined: false, activationReady: false });
    expect(r).toEqual(['baselineSchedule', 'lockBaseline']);
  });

  it('CHARTERED locked before the schedule was baselined → cue an unlock (the stuck state)', () => {
    const r = keys({ ...base, status: 'CHARTERED', baselineLocked: true, scheduleBaselined: false, hasWbs: true, activationReady: false });
    expect(r).toEqual(['unlockToBaselineSchedule']);
  });

  it('CHARTERED with no WBS → does not ask to baseline the schedule', () => {
    const r = keys({ ...base, status: 'CHARTERED', baselineLocked: false, hasWbs: false, activationReady: false });
    expect(r).toEqual(['lockBaseline']);
  });

  it('CHARTERED and activation-ready → activate is the cue (ADMIN/PMO)', () => {
    const r = keys({ ...base, status: 'CHARTERED', activationReady: true });
    expect(r).toEqual(['activate']);
  });

  it('CHARTERED stage label adapts once the baseline is set (no longer "set the …baseline")', () => {
    // Both baselines done, awaiting activation: the header should read "ready to activate",
    // not the stale imperative "set the cost & schedule baseline".
    expect(computeNextSteps({ ...base, status: 'CHARTERED', activationReady: true }).stage).toBe('Planning — baseline set, ready to activate');
    // Still incomplete → keeps the "set the …baseline" prompt.
    expect(computeNextSteps({ ...base, status: 'CHARTERED', baselineLocked: false, scheduleBaselined: false, activationReady: false }).stage).toBe('Planning — set the cost & schedule baseline');
  });

  it('IN_PROGRESS stage label flips to "ready to close" once deliverables are complete', () => {
    // Mid-execution keeps the plain descriptor; closure-ready hints at the closing phase.
    expect(computeNextSteps({ ...base, status: 'IN_PROGRESS', closureReady: false }).stage).toBe('In execution');
    expect(computeNextSteps({ ...base, status: 'IN_PROGRESS', closureReady: true }).stage).toBe('In execution — ready to close');
  });

  it('CHARTERED activation-ready but viewer is a PM → informational "awaiting PMO" (no action)', () => {
    const steps = computeNextSteps({ ...base, status: 'CHARTERED', activationReady: true, canGovern: false }).steps;
    expect(steps.map((s) => s.key)).toEqual(['awaitActivation']);
    expect(steps[0].action).toBeUndefined(); // not an action the PM can take
  });

  it('IN_PROGRESS closeable as a PM → informational await-close instead of the close action', () => {
    const steps = computeNextSteps({ ...base, status: 'IN_PROGRESS', closureReady: true, canGovern: false }).steps;
    expect(steps.map((s) => s.key)).toEqual(['awaitClose']);
    expect(steps[0].action).toBeUndefined();
  });

  it('ON_HOLD as a PM → informational await-resume instead of the resume action', () => {
    const steps = computeNextSteps({ ...base, status: 'ON_HOLD', canGovern: false }).steps;
    expect(steps.map((s) => s.key)).toEqual(['awaitResume']);
    expect(steps[0].action).toBeUndefined();
  });

  it('IN_PROGRESS not yet closeable → track execution (Schedule for a WBS project)', () => {
    const steps = computeNextSteps({ ...base, status: 'IN_PROGRESS', closureReady: false }).steps;
    expect(steps.map((s) => s.key)).toEqual(['trackProgress']);
    expect(steps[0].tab).toBe('Schedule');
  });

  it('IN_PROGRESS pure-agile (no WBS) → track cue points at the Agile tab', () => {
    const steps = computeNextSteps({ ...base, status: 'IN_PROGRESS', hasWbs: false, closureReady: false }).steps;
    expect(steps[0].tab).toBe('Agile');
  });

  it('IN_PROGRESS with open high risks → surfaces a risk cue alongside tracking', () => {
    expect(keys({ ...base, status: 'IN_PROGRESS', closureReady: false, openHighRisks: 2 })).toEqual(['trackProgress', 'mitigateRisks']);
  });

  it('IN_PROGRESS closeable but missing artifacts → record acceptance, capture lessons, then close', () => {
    const r = keys({ ...base, status: 'IN_PROGRESS', closureReady: true, hasAcceptance: false, hasLessons: false });
    expect(r).toEqual(['recordAcceptance', 'captureLessons', 'closeProject']);
  });

  it('IN_PROGRESS closeable with artifacts done → just close', () => {
    expect(keys({ ...base, status: 'IN_PROGRESS', closureReady: true })).toEqual(['closeProject']);
  });

  it('ON_HOLD → resume', () => {
    expect(keys({ ...base, status: 'ON_HOLD' })).toEqual(['resume']);
  });

  it('CLOSED → nothing pending', () => {
    const r = computeNextSteps({ ...base, status: 'CLOSED' });
    expect(r.steps).toHaveLength(0);
    expect(r.stage).toBe('Closed');
  });
});
