import type { PlatformTenant } from '../api/types';

export type Plan = PlatformTenant['plan'];

// Indicative monthly list price per plan, in IDR. EDIT to match the real Lemon Squeezy variant
// pricing — the console's MRR / ARPA figures are ESTIMATES derived from these (labelled "est.").
export const PLAN_PRICE: Record<Plan, number> = { FREE: 0, PRO: 490_000, ENTERPRISE: 1_990_000 };

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
  mrr: number;        // estimated monthly recurring revenue (ACTIVE paid tenants × PLAN_PRICE)
  paying: number;     // ACTIVE tenants on a paid (non-FREE) plan
  arpa: number;       // average revenue per paying account (mrr / paying)
}

export function tenantStats(tenants: PlatformTenant[]): TenantStats {
  const corporate = tenants.filter((t) => !t.isPersonal);
  const s: TenantStats = {
    total: corporate.length,
    active: 0, suspended: 0, pending: 0, rejected: 0,
    members: 0,
    personal: tenants.length - corporate.length,
    planSplit: { FREE: 0, PRO: 0, ENTERPRISE: 0 },
    mrr: 0, paying: 0, arpa: 0,
  };
  for (const t of corporate) {
    if (t.status === 'ACTIVE') s.active++;
    else if (t.status === 'SUSPENDED') s.suspended++;
    else if (t.status === 'PENDING') s.pending++;
    else if (t.status === 'REJECTED') s.rejected++;
    s.members += t.memberCount;
    s.planSplit[t.plan] = (s.planSplit[t.plan] ?? 0) + 1;
    // Only ACTIVE tenants bill; FREE contributes nothing.
    if (t.status === 'ACTIVE') {
      const price = PLAN_PRICE[t.plan] ?? 0;
      s.mrr += price;
      if (price > 0) s.paying++;
    }
  }
  s.arpa = s.paying > 0 ? Math.round(s.mrr / s.paying) : 0;
  return s;
}
