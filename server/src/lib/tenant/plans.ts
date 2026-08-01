import type { TenantPlan } from '@prisma/client';

// Per-plan quotas (Phase 6 SaaS gating). `null` = unlimited. Storage is in MB. These are the
// product defaults; tune here (a single source of truth for the API + the platform console copy).
// Enforcement lives at the creation points: project create, member add, attachment upload.
export interface PlanLimits {
  maxProjects: number | null; // active (non-deleted, non-archived) projects per tenant
  maxMembers: number | null; // memberships per tenant
  storageMb: number | null; // total attachment bytes per tenant
}

export const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  FREE: { maxProjects: 3, maxMembers: 5, storageMb: 1024 },
  PRO: { maxProjects: 50, maxMembers: 50, storageMb: 20480 },
  ENTERPRISE: { maxProjects: null, maxMembers: null, storageMb: null },
};

export function planLimits(plan: TenantPlan): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE;
}
