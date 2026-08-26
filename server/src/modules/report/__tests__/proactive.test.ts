import { describe, it, expect } from 'vitest';
import { isProactiveDue } from '../proactive.service.js';

// Pure send-window gate: due only at the configured hour on the configured weekday.
describe('isProactiveDue', () => {
  const sched = { hour: 6, weekday: 1 }; // 06:00 Monday

  it('is due at the exact hour on the exact weekday', () => {
    const mondayAt6 = new Date(2026, 7, 24, 6, 30); // 2026-08-24 is a Monday
    expect(mondayAt6.getDay()).toBe(1);
    expect(isProactiveDue(mondayAt6, sched)).toBe(true);
  });

  it('is not due at the wrong hour', () => {
    expect(isProactiveDue(new Date(2026, 7, 24, 7, 0), sched)).toBe(false); // Monday 07:00
  });

  it('is not due on the wrong weekday', () => {
    const tuesdayAt6 = new Date(2026, 7, 25, 6, 0); // Tuesday 06:00
    expect(tuesdayAt6.getDay()).toBe(2);
    expect(isProactiveDue(tuesdayAt6, sched)).toBe(false);
  });
});
