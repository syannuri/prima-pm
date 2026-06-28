import { describe, it, expect } from 'vitest';
import {
  checkCharterCompleteness,
  canEditCharter,
  buildCharterSnapshot,
  generateProjectCode,
  isScheduleValid,
} from '../charter.helpers.js';

const fullCharter = {
  description: 'Build a SOC monitoring platform',
  goals: 'Reduce MTTR by 40%',
  category: 'CYBERSECURITY_INFRA',
  hiScope: 'SIEM + SOAR rollout',
  hiCostIdr: 500_000_000,
  hiScheduleStart: new Date('2026-07-01'),
  hiScheduleEnd: new Date('2026-12-31'),
  hiDeliverables: 'Operational SOC',
  pmUserId: 'user-1',
  version: 1,
};

describe('charter — completeness', () => {
  it('passes when all mandatory fields are filled', () => {
    expect(checkCharterCompleteness(fullCharter)).toEqual({ ok: true, missing: [] });
  });

  it('reports each missing field', () => {
    const r = checkCharterCompleteness({ ...fullCharter, hiScope: '   ', pmUserId: '' });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('hiScope');
    expect(r.missing).toContain('pmUserId');
  });

  it('treats zero/negative high-level cost as missing', () => {
    const r = checkCharterCompleteness({ ...fullCharter, hiCostIdr: 0 });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('hiCostIdr');
  });
});

describe('charter — edit/commit guard', () => {
  it('allows creating when no charter exists', () => {
    expect(canEditCharter(null).allowed).toBe(true);
  });

  it('allows editing an unlocked (draft) charter', () => {
    expect(canEditCharter({ locked: false }).allowed).toBe(true);
  });

  it('blocks editing a committed/locked charter', () => {
    const g = canEditCharter({ locked: true });
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/Change Request/i);
  });
});

describe('charter — snapshot', () => {
  it('captures all required fields plus version', () => {
    const snap = buildCharterSnapshot(fullCharter);
    expect(snap.category).toBe('CYBERSECURITY_INFRA');
    expect(snap.hiCostIdr).toBe(500_000_000);
    expect(snap.version).toBe(1);
    expect(Object.keys(snap)).toContain('hiDeliverables');
  });
});

describe('charter — misc', () => {
  it('generates zero-padded project codes', () => {
    expect(generateProjectCode(2026, 1)).toBe('PRJ-2026-0001');
    expect(generateProjectCode(2026, 42)).toBe('PRJ-2026-0042');
    expect(generateProjectCode(2026, 12345)).toBe('PRJ-2026-12345');
  });

  it('validates schedule window order', () => {
    expect(isScheduleValid(new Date('2026-01-01'), new Date('2026-02-01'))).toBe(true);
    expect(isScheduleValid(new Date('2026-02-01'), new Date('2026-01-01'))).toBe(false);
  });
});
