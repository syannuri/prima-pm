import type { TenantPlan } from '@prisma/client';

// Feature capabilities a plan unlocks (Phase 6 SaaS feature-tiering; see docs/SUBSCRIPTION-PLANS-PLAN.md).
// TRIAL and PRO share the full PM product; ENTERPRISE adds sso/customDomain/auditRetention. Gate at
// route entry via assertFeature() and surface the set to the client (/auth/me) so the UI can
// lock / upgrade-prompt features it doesn't have.
export type PlanFeature =
  | 'portfolio'
  | 'forecasting'
  | 'reportingHub'
  | 'resourceMgmt'
  | 'agile'
  | 'approvals'
  | 'messaging'
  | 'integrations'
  | 'ai'
  | 'sso'
  | 'customDomain'
  | 'auditRetention';

// The full PM product — shared by TRIAL and PRO (a trial IS the PRO experience for 60 days).
const CORE_FEATURES: readonly PlanFeature[] = [
  'portfolio',
  'forecasting',
  'reportingHub',
  'resourceMgmt',
  'agile',
  'approvals',
  'messaging',
  'integrations',
  'ai',
];
// ENTERPRISE-only capabilities layered on top of the core product.
const ENTERPRISE_FEATURES: readonly PlanFeature[] = ['sso', 'customDomain', 'auditRetention'];

// Per-plan quotas + feature set — a single source of truth for the API + the platform-console copy.
// `null` quota = unlimited. Storage is in MB. Quota enforcement lives at the creation points
// (project create, member add, attachment upload); feature enforcement in assertFeature().
export interface PlanLimits {
  maxProjects: number | null; // active (non-deleted, non-archived) projects per tenant
  maxMembers: number | null; // memberships per tenant
  storageMb: number | null; // total attachment bytes per tenant
  features: ReadonlySet<PlanFeature>;
}

export const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  // TRIAL mirrors PRO (limits + features) — the 60-day trial hands over the full paid experience;
  // `Tenant.trialEndsAt` (not the feature set) is what walls it off once the trial ends.
  TRIAL: { maxProjects: 50, maxMembers: 50, storageMb: 20480, features: new Set(CORE_FEATURES) },
  PRO: { maxProjects: 50, maxMembers: 50, storageMb: 20480, features: new Set(CORE_FEATURES) },
  ENTERPRISE: {
    maxProjects: null,
    maxMembers: null,
    storageMb: null,
    features: new Set([...CORE_FEATURES, ...ENTERPRISE_FEATURES]),
  },
};

export function planLimits(plan: TenantPlan): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.TRIAL;
}

// Does `plan` unlock `feature`? The central capability check used by assertFeature() and mirrored to
// the client so the UI can hide/lock gated surfaces.
export function planAllows(plan: TenantPlan, feature: PlanFeature): boolean {
  return planLimits(plan).features.has(feature);
}

// The capability list for a plan — sent to the client (via /auth/me) so it can lock/upgrade-prompt.
export function planCapabilities(plan: TenantPlan): PlanFeature[] {
  return [...planLimits(plan).features];
}
