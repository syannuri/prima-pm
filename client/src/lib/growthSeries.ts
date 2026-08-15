import type { PlatformTenant } from '../api/types';
import { PLAN_PRICE } from './tenantStats';

// Monthly growth series for the console trend charts, derived client-side from tenant createdAt +
// current plan. Cumulative tenants is exact; cumulative MRR is an ESTIMATE — we only know each
// tenant's CURRENT plan/status, not its history, so we assume the current paid plan applied from
// signup (labelled "est." in the UI). Pure → unit-tested.
export interface GrowthPoint {
  t: number;       // end-of-month timestamp
  label: string;   // e.g. "Aug 26"
  tenants: number; // cumulative corporate tenants at month end
  newCount: number;// tenants created within that month
  mrr: number;     // cumulative est. MRR (ACTIVE paid tenants created by month end)
}

export function growthSeries(tenants: PlatformTenant[], months = 6, now: Date = new Date()): GrowthPoint[] {
  const corp = tenants.filter((t) => !t.isPersonal);
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const out: GrowthPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const end = new Date(Date.UTC(y, m - i + 1, 0, 23, 59, 59, 999)); // last day of month (m - i)
    const monthStart = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1);
    const bucketEnd = end.getTime();
    let tenantsCum = 0, mrr = 0, newCount = 0;
    for (const c of corp) {
      const created = +new Date(c.createdAt);
      if (created <= bucketEnd) {
        tenantsCum++;
        if (c.status === 'ACTIVE') mrr += PLAN_PRICE[c.plan] ?? 0;
      }
      if (created >= monthStart && created <= bucketEnd) newCount++;
    }
    out.push({ t: bucketEnd, label: end.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }), tenants: tenantsCum, newCount, mrr });
  }
  return out;
}
