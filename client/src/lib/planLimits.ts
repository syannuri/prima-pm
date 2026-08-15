import type { Plan } from './tenantStats';
import type { PlatformTenant } from '../api/types';

// Client mirror of the server's per-plan quotas (server/src/lib/tenant/plans.ts — the single source
// of truth). `null` = unlimited; storage in MB. Kept here so the platform console can render usage
// vs cap without an extra round-trip. If the server limits change, update both.
export interface PlanLimits { maxProjects: number | null; maxMembers: number | null; storageMb: number | null }
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: { maxProjects: 3, maxMembers: 5, storageMb: 1024 },
  PRO: { maxProjects: 50, maxMembers: 50, storageMb: 20480 },
  ENTERPRISE: { maxProjects: null, maxMembers: null, storageMb: null },
};

export type QuotaDim = 'members' | 'projects' | 'storage';

// Current usage vs the tenant's plan cap for one dimension. `cap === null` ⇒ unlimited.
export function quotaUsage(t: PlatformTenant, dim: QuotaDim): { used: number; cap: number | null; ratio: number } {
  const lim = PLAN_LIMITS[t.plan];
  if (dim === 'members') return usage(t.memberCount, lim.maxMembers);
  if (dim === 'projects') return usage(t.projectCount, lim.maxProjects);
  return usage(t.storageBytes, lim.storageMb == null ? null : lim.storageMb * 1024 * 1024);
}
function usage(used: number, cap: number | null) {
  return { used, cap, ratio: cap == null || cap === 0 ? 0 : used / cap };
}

// Is the tenant at/over ANY plan cap? (unlimited dims never count.) Drives the "At capacity" KPI.
export function atCapacity(t: PlatformTenant): boolean {
  return (['members', 'projects', 'storage'] as QuotaDim[]).some((d) => {
    const { cap, used } = quotaUsage(t, d);
    return cap != null && used >= cap;
  });
}
