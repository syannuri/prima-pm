import type { PlatformTenant } from '../api/types';
import { quotaUsage, type QuotaDim } from './planLimits';

// "Needs attention" triage: the single most-pressing issue per tenant, ranked by severity, for the
// console's ops panel. Pure → unit-tested. Priority: over-cap > suspended-with-data > pending > empty.
export type TriageKind = 'over-cap' | 'suspended-data' | 'pending' | 'empty';
export type TriageSeverity = 'high' | 'medium' | 'low';
export interface TriageItem {
  tenant: PlatformTenant;
  kind: TriageKind;
  severity: TriageSeverity;
  dim?: QuotaDim;   // over-cap only
  used?: number;    // over-cap only
  cap?: number;     // over-cap only
}

export function triage(tenants: PlatformTenant[]): TriageItem[] {
  const items: TriageItem[] = [];
  for (const t of tenants.filter((x) => !x.isPersonal)) {
    // 1. at/over any plan cap (most pressing)
    let capIssue: TriageItem | null = null;
    for (const dim of ['members', 'projects', 'storage'] as QuotaDim[]) {
      const { used, cap } = quotaUsage(t, dim);
      if (cap != null && used >= cap) { capIssue = { tenant: t, kind: 'over-cap', severity: 'high', dim, used, cap }; break; }
    }
    if (capIssue) { items.push(capIssue); continue; }
    // 2. suspended but still holding data
    if (t.status === 'SUSPENDED' && (t.projectCount > 0 || t.memberCount > 0)) { items.push({ tenant: t, kind: 'suspended-data', severity: 'high' }); continue; }
    // 3. a signup awaiting approval
    if (t.status === 'PENDING') { items.push({ tenant: t, kind: 'pending', severity: 'medium' }); continue; }
    // 4. active but empty (no projects) — stale / never got going
    if (t.status === 'ACTIVE' && t.projectCount === 0) { items.push({ tenant: t, kind: 'empty', severity: 'low' }); continue; }
  }
  const rank: Record<TriageSeverity, number> = { high: 0, medium: 1, low: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
