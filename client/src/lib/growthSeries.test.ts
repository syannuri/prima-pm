import { describe, it, expect } from 'vitest';
import { growthSeries } from './growthSeries';
import type { PlatformTenant } from '../api/types';

const t = (over: Partial<PlatformTenant>): PlatformTenant => ({
  id: Math.random().toString(36).slice(2),
  name: 'X', slug: 'x', status: 'ACTIVE', plan: 'TRIAL',
  customDomain: null, isPersonal: false, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  memberCount: 0, projectCount: 0, storageBytes: 0, ...over,
});

describe('growthSeries', () => {
  const now = new Date('2026-08-15T00:00:00Z');

  it('produces one point per month, cumulative counts rising', () => {
    const s = growthSeries([
      t({ createdAt: '2026-06-10' }),
      t({ createdAt: '2026-07-05' }),
      t({ createdAt: '2026-08-01' }),
    ], 6, now);
    expect(s).toHaveLength(6);
    expect(s.map((p) => p.tenants)).toEqual([0, 0, 0, 1, 2, 3]); // Mar..Aug: cumulative
    expect(s[s.length - 1].newCount).toBe(1); // one created in Aug
    expect(s[s.length - 1].label).toMatch(/Aug/);
  });

  it('accumulates est. MRR from ACTIVE paid tenants only', () => {
    const s = growthSeries([
      t({ createdAt: '2026-07-01', status: 'ACTIVE', plan: 'PRO' }),        // 490k
      t({ createdAt: '2026-07-01', status: 'ACTIVE', plan: 'ENTERPRISE' }), // 1.99m
      t({ createdAt: '2026-07-01', status: 'SUSPENDED', plan: 'PRO' }),      // excluded
      t({ createdAt: '2026-08-01', status: 'ACTIVE', plan: 'TRIAL' }),        // 0
    ], 3, now);
    const last = s[s.length - 1];
    expect(last.mrr).toBe(490_000 + 1_990_000);
  });

  it('excludes personal sandboxes', () => {
    const s = growthSeries([t({ createdAt: '2026-08-01', isPersonal: true })], 2, now);
    expect(s[s.length - 1].tenants).toBe(0);
  });
});
