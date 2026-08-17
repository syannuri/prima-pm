import type { Db } from '../prisma.js';
import { DEFAULT_TENANT_SLUG, DEFAULT_TENANT_NAME } from './constants.js';

// Programmatic mirror of the Phase-1 seed embedded in the tenant_membership migration:
// ensure the single default tenant exists and every user has a membership in it carrying
// their current global role. Idempotent (upsert on slug + skipDuplicates on the
// (userId, tenantId) unique), so it is safe to run repeatedly — used by tests to assert the
// invariant, and available to ops if a re-backfill is ever needed. Phase 2 extends this to
// stamp tenantId onto the denormalized rows.
export async function backfillDefaultTenant(prisma: Db): Promise<{ tenantId: string; memberships: number }> {
  // The default tenant owns ALL pre-existing (single-tenant) data, so it is never quota-capped —
  // it's ENTERPRISE (unlimited). New corporate tenants default to TRIAL (60-day trial).
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEFAULT_TENANT_SLUG },
    update: {},
    create: { slug: DEFAULT_TENANT_SLUG, name: DEFAULT_TENANT_NAME, plan: 'ENTERPRISE' },
  });

  const users = await prisma.user.findMany({ select: { id: true, role: true } });
  const { count } = await prisma.membership.createMany({
    data: users.map((u) => ({ userId: u.id, tenantId: tenant.id, role: u.role })),
    skipDuplicates: true,
  });

  return { tenantId: tenant.id, memberships: count };
}

// NOTE: the one-time `backfillGuestTenants` helper (which moved existing guests into personal tenants
// by reading `Project.personalOwnerId`) was removed when the `personalOwnerId` column was dropped —
// its migration (20260731120000_guest_personal_tenants) has already run on every environment.
