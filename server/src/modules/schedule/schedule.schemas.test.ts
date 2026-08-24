import { describe, it, expect } from 'vitest';
import { dependencySchema, dependencyEditSchema, upsertTaskSchema } from './schedule.schemas.js';

// Security M1: the working-day scheduler walks calendar days one at a time, so the API must reject
// out-of-range lag / plan dates before they reach the engine (defense-in-depth caps live in the
// helpers too). These guard against a low-privilege authenticated DoS on the pooled server.
describe('schedule schema DoS bounds', () => {
  it('rejects an out-of-range dependency lag', () => {
    expect(dependencyEditSchema.safeParse({ type: 'FS', lagDays: 1_000_000_000 }).success).toBe(false);
    expect(dependencyEditSchema.safeParse({ type: 'FS', lagDays: -1_000_000_000 }).success).toBe(false);
    expect(dependencyEditSchema.safeParse({ type: 'FS', lagDays: 30 }).success).toBe(true);
    expect(dependencySchema.safeParse({ predecessorId: '00000000-0000-0000-0000-000000000000', lagDays: 9_999_999 }).success).toBe(false);
  });

  it('rejects plan dates outside the supported range', () => {
    const base = { name: 'Task', progressPct: 0, isMilestone: false, sortOrder: 0 };
    expect(upsertTaskSchema.safeParse({ ...base, planStart: '2026-06-01', planEnd: '5000-01-01' }).success).toBe(false);
    expect(upsertTaskSchema.safeParse({ ...base, planStart: '1900-01-01', planEnd: '2026-06-10' }).success).toBe(false);
    expect(upsertTaskSchema.safeParse({ ...base, planStart: '2026-06-01', planEnd: '2026-06-10' }).success).toBe(true);
  });
});
