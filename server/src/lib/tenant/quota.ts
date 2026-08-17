import type { TenantPlan } from '@prisma/client';
import { prisma } from '../prisma.js';
import { getTenantStore, multitenancyEnforced } from './context.js';
import { planLimits, planAllows, type PlanFeature } from './plans.js';
import { Forbidden } from '../errors.js';

// Plan/quota gating (Phase 6 SaaS). Enforced at the creation points below; a no-op when enforcement
// is off (single-tenant) or for PERSONAL (guest) sandboxes — plans gate CORPORATE workspaces.
async function activePlanTenant(): Promise<{ id: string; plan: TenantPlan; isPersonal: boolean } | null> {
  const store = getTenantStore();
  if (!store?.tenantId) return null;
  return prisma.tenant.findUnique({ where: { id: store.tenantId }, select: { id: true, plan: true, isPersonal: true } });
}

// Reject a new project once the tenant is at its plan's active-project cap.
export async function assertCanCreateProject(): Promise<void> {
  if (!multitenancyEnforced()) return;
  const t = await activePlanTenant();
  if (!t || t.isPersonal) return;
  const max = planLimits(t.plan).maxProjects;
  if (max == null) return;
  // Project is tenant-scoped by the Prisma extension, so this counts only the active tenant's rows.
  const count = await prisma.project.count({ where: { deletedAt: null } });
  if (count >= max) throw Forbidden(`Your ${t.plan} plan allows up to ${max} active projects. Upgrade the plan to add more.`);
}

// Reject a new membership once the tenant is at its plan's member cap.
export async function assertCanAddMember(): Promise<void> {
  if (!multitenancyEnforced()) return;
  const t = await activePlanTenant();
  if (!t || t.isPersonal) return;
  const max = planLimits(t.plan).maxMembers;
  if (max == null) return;
  // Membership is a GLOBAL model (not auto-scoped) → filter by the active tenant explicitly.
  const count = await prisma.membership.count({ where: { tenantId: t.id } });
  if (count >= max) throw Forbidden(`Your ${t.plan} plan allows up to ${max} members. Upgrade the plan to add more.`);
}

// Plan-aware storage limit (bytes). The tenant's PLAN sets the base limit (ENTERPRISE = unlimited);
// personal tenants + the enforcement-off path use a 1 GB base. TENANT_STORAGE_QUOTA_MB, when set, is
// a deployment-wide HARD CAP applied on top (min) — an ops escape hatch below any plan.
const DEFAULT_BASE_BYTES = 1024 * 1024 * 1024; // 1 GB
function envHardCapBytes(): number | null {
  const mb = Number(process.env.TENANT_STORAGE_QUOTA_MB);
  return process.env.TENANT_STORAGE_QUOTA_MB && mb > 0 ? mb * 1024 * 1024 : null;
}
export async function tenantStorageLimitBytes(): Promise<number> {
  let base = DEFAULT_BASE_BYTES;
  if (multitenancyEnforced()) {
    const t = await activePlanTenant();
    if (t && !t.isPersonal) {
      const mb = planLimits(t.plan).storageMb;
      base = mb == null ? Number.POSITIVE_INFINITY : mb * 1024 * 1024;
    }
  }
  const cap = envHardCapBytes();
  return cap != null ? Math.min(cap, base) : base;
}

// Reject access to a plan-gated feature (Phase 6 feature-tiering). Enforcement-gated + personal-tenant
// exempt, mirroring the quota asserts. Dormant until wired into the gated module routes (Phase 3).
export async function assertFeature(feature: PlanFeature): Promise<void> {
  if (!multitenancyEnforced()) return;
  const t = await activePlanTenant();
  if (!t || t.isPersonal) return;
  if (!planAllows(t.plan, feature)) {
    throw Forbidden(`Your ${t.plan} plan does not include this feature. Upgrade to unlock it.`);
  }
}
