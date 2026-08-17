import { describe, it, expect, afterEach } from 'vitest';
import { trialDays, newTrialExpiry, isTrialExpired, trialDaysLeft } from './trial.js';

const DAY = 24 * 60 * 60 * 1000;

afterEach(() => { delete process.env.TRIAL_DAYS; });

describe('trial lifecycle helpers', () => {
  it('trialDays defaults to 60, honours a valid env, ignores junk', () => {
    expect(trialDays()).toBe(60);
    process.env.TRIAL_DAYS = '14';
    expect(trialDays()).toBe(14);
    process.env.TRIAL_DAYS = '-3';
    expect(trialDays()).toBe(60);
    process.env.TRIAL_DAYS = 'abc';
    expect(trialDays()).toBe(60);
  });

  it('newTrialExpiry is trialDays() out from the given instant', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(newTrialExpiry(from).getTime()).toBe(from.getTime() + 60 * DAY);
  });

  it('isTrialExpired: only a TRIAL plan with a PAST non-null deadline is expired', () => {
    const past = new Date(Date.now() - DAY);
    const future = new Date(Date.now() + DAY);
    expect(isTrialExpired('TRIAL', past)).toBe(true);
    expect(isTrialExpired('TRIAL', future)).toBe(false);
    expect(isTrialExpired('TRIAL', null)).toBe(false); // bare/grace — not walled
    expect(isTrialExpired('PRO', past)).toBe(false); // paid never expires
    expect(isTrialExpired('ENTERPRISE', past)).toBe(false);
  });

  it('trialDaysLeft rounds up, floors at 0, null with no deadline', () => {
    expect(trialDaysLeft(null)).toBeNull();
    expect(trialDaysLeft(new Date(Date.now() - DAY))).toBe(0);
    expect(trialDaysLeft(new Date(Date.now() + 5 * DAY - 1000))).toBe(5);
  });
});
