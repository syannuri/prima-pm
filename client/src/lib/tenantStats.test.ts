import { describe, it, expect } from 'vitest';
import { tenantStats } from './tenantStats';
import type { PlatformTenant } from '../api/types';

const t = (over: Partial<PlatformTenant>): PlatformTenant => ({
  id: Math.random().toString(36).slice(2),
  name: 'X', slug: 'x', status: 'ACTIVE', plan: 'FREE',
  customDomain: null, isPersonal: false, createdAt: '2026-01-01', updatedAt: '2026-01-01', memberCount: 0,
  projectCount: 0, storageBytes: 0,
  ...over,
});

describe('tenantStats', () => {
  it('returns an empty shape for no tenants', () => {
    expect(tenantStats([])).toEqual({
      total: 0, active: 0, suspended: 0, pending: 0, rejected: 0,
      members: 0, personal: 0, planSplit: { FREE: 0, PRO: 0, ENTERPRISE: 0 },
      mrr: 0, paying: 0, arpa: 0,
    });
  });

  it('estimates MRR/ARPA from ACTIVE paid tenants only', () => {
    const s = tenantStats([
      t({ status: 'ACTIVE', plan: 'PRO' }),        // 490k
      t({ status: 'ACTIVE', plan: 'ENTERPRISE' }), // 1.99m
      t({ status: 'ACTIVE', plan: 'FREE' }),        // 0, not paying
      t({ status: 'SUSPENDED', plan: 'ENTERPRISE' }), // suspended → no revenue
      t({ status: 'PENDING', plan: 'PRO' }),          // pending → no revenue
    ]);
    expect(s.mrr).toBe(490_000 + 1_990_000);
    expect(s.paying).toBe(2);
    expect(s.arpa).toBe(Math.round((490_000 + 1_990_000) / 2));
  });

  it('counts statuses, plans and members over corporate tenants only', () => {
    const s = tenantStats([
      t({ status: 'ACTIVE', plan: 'PRO', memberCount: 5 }),
      t({ status: 'ACTIVE', plan: 'ENTERPRISE', memberCount: 10 }),
      t({ status: 'PENDING', plan: 'FREE', memberCount: 1 }),
      t({ status: 'SUSPENDED', plan: 'PRO', memberCount: 3 }),
      t({ status: 'REJECTED', plan: 'FREE', memberCount: 0 }),
      t({ isPersonal: true, plan: 'FREE', memberCount: 1 }), // guest sandbox — excluded from corp
    ]);
    expect(s.total).toBe(5);
    expect(s.active).toBe(2);
    expect(s.pending).toBe(1);
    expect(s.suspended).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.members).toBe(19); // 5+10+1+3+0, sandbox's 1 excluded
    expect(s.personal).toBe(1);
    expect(s.planSplit).toEqual({ FREE: 2, PRO: 2, ENTERPRISE: 1 });
  });
});
