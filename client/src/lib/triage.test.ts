import { describe, it, expect } from 'vitest';
import { triage } from './triage';
import type { PlatformTenant } from '../api/types';

const t = (over: Partial<PlatformTenant>): PlatformTenant => ({
  id: Math.random().toString(36).slice(2),
  name: 'X', slug: 'x', status: 'ACTIVE', plan: 'TRIAL',
  customDomain: null, isPersonal: false, trialEndsAt: null, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  memberCount: 1, projectCount: 1, storageBytes: 0, ...over,
});

describe('triage', () => {
  it('flags over-cap as the top priority', () => {
    const [item] = triage([t({ plan: 'TRIAL', memberCount: 51 })]); // TRIAL cap = 50
    expect(item.kind).toBe('over-cap');
    expect(item.dim).toBe('members');
    expect(item.used).toBe(51);
    expect(item.cap).toBe(50);
  });
  it('flags suspended-with-data, pending, and empty', () => {
    expect(triage([t({ status: 'SUSPENDED', projectCount: 2 })])[0].kind).toBe('suspended-data'); // 2/3, under cap
    expect(triage([t({ status: 'PENDING' })])[0].kind).toBe('pending');
    expect(triage([t({ status: 'ACTIVE', projectCount: 0 })])[0].kind).toBe('empty');
  });
  it('ignores healthy tenants and personal sandboxes', () => {
    expect(triage([t({ memberCount: 2, projectCount: 2 })])).toHaveLength(0);
    expect(triage([t({ isPersonal: true, status: 'PENDING' })])).toHaveLength(0);
  });
  it('sorts by severity (high before medium before low)', () => {
    const items = triage([
      t({ status: 'ACTIVE', projectCount: 0 }),        // low
      t({ status: 'PENDING' }),                          // medium
      t({ plan: 'TRIAL', memberCount: 51 }),             // high (over-cap)
    ]);
    expect(items.map((i) => i.severity)).toEqual(['high', 'medium', 'low']);
  });
});
