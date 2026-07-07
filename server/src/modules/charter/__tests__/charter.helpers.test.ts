import { describe, it, expect } from 'vitest';
import { changeRequestSchema } from '../charter.schemas.js';
import {
  checkCharterCompleteness,
  canEditCharter,
  buildCharterSnapshot,
  generateProjectCode,
  nextProjectSeq,
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

  describe('nextProjectSeq — from the max code, not a count', () => {
    it('starts at 1 when there are no codes for the year', () => {
      expect(nextProjectSeq([], 2026)).toBe(1);
    });

    it('is max + 1 for a contiguous run', () => {
      expect(nextProjectSeq(['PRJ-2026-0001', 'PRJ-2026-0002', 'PRJ-2026-0003'], 2026)).toBe(4);
    });

    it('skips past gaps + soft-deleted codes instead of reusing them (the reported bug)', () => {
      // Active 0001-0003 + 0007; soft-deleted 0005/0006; 0004 gone. Count=6 would regenerate
      // 0007 (collision). Max is 7, so the next code must be 8.
      const codes = ['PRJ-2026-0001', 'PRJ-2026-0002', 'PRJ-2026-0003', 'PRJ-2026-0005', 'PRJ-2026-0006', 'PRJ-2026-0007'];
      expect(nextProjectSeq(codes, 2026)).toBe(8);
    });

    it('ignores codes from other years', () => {
      expect(nextProjectSeq(['PRJ-2025-0099', 'PRJ-2026-0002'], 2026)).toBe(3);
    });

    it('ignores malformed codes', () => {
      expect(nextProjectSeq(['PRJ-2026-abc', 'PRJ-2026-0004', 'garbage'], 2026)).toBe(5);
    });
  });

  it('validates schedule window order', () => {
    expect(isScheduleValid(new Date('2026-01-01'), new Date('2026-02-01'))).toBe(true);
    expect(isScheduleValid(new Date('2026-02-01'), new Date('2026-01-01'))).toBe(false);
  });

  describe('changeRequestSchema — a CR must declare at least one affected area', () => {
    const base = { title: 'Rename a task', description: 'WBS edit needed' };

    it('rejects an empty impactAreas (the old silent no-op)', () => {
      expect(changeRequestSchema.safeParse({ ...base, impactAreas: [] }).success).toBe(false);
    });

    it('rejects a missing impactAreas', () => {
      expect(changeRequestSchema.safeParse(base).success).toBe(false);
    });

    it('accepts a declared area (CHARTER / COST / SCHEDULE)', () => {
      expect(changeRequestSchema.safeParse({ ...base, impactAreas: ['SCHEDULE'] }).success).toBe(true);
      expect(changeRequestSchema.safeParse({ ...base, impactAreas: ['CHARTER', 'COST'] }).success).toBe(true);
    });
  });
});
