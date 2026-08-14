import type { PlatformTenant } from '../api/types';

export type Plan = PlatformTenant['plan'];

// Roll the platform tenant list into the console's headline metrics. Personal guest sandboxes are
// excluded from the corporate counts (they aren't managed here) but surfaced separately. Pure — so
// it's unit-tested and the page just renders the result.
export interface TenantStats {
  total: number;      // corporate tenants
  active: number;
  suspended: number;
  pending: number;
  rejected: number;
  members: number;    // summed across corporate tenants
  personal: number;   // guest sandboxes (not counted in `total`)
  planSplit: Record<Plan, number>;
}

export function tenantStats(tenants: PlatformTenant[]): TenantStats {
  const corporate = tenants.filter((t) => !t.isPersonal);
  const s: TenantStats = {
    total: corporate.length,
    active: 0, suspended: 0, pending: 0, rejected: 0,
    members: 0,
    personal: tenants.length - corporate.length,
    planSplit: { FREE: 0, PRO: 0, ENTERPRISE: 0 },
  };
  for (const t of corporate) {
    if (t.status === 'ACTIVE') s.active++;
    else if (t.status === 'SUSPENDED') s.suspended++;
    else if (t.status === 'PENDING') s.pending++;
    else if (t.status === 'REJECTED') s.rejected++;
    s.members += t.memberCount;
    s.planSplit[t.plan] = (s.planSplit[t.plan] ?? 0) + 1;
  }
  return s;
}
