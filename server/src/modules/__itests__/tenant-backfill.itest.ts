import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { DEFAULT_TENANT_SLUG, DEFAULT_TENANT_NAME } from '../../lib/tenant/constants.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Phase-1 invariant (see docs/MULTITENANCY-POOLED-PLAN.md): after the tenant_membership
// migration's backfill, exactly ONE default tenant owns all data and every user has a
// membership in it carrying their current global role. This drives the same logic
// (backfillDefaultTenant) the migration SQL embeds, so the invariant is regression-tested.
const ROLES: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'FINANCE', 'VIEWER', 'GUEST'];

beforeAll(async () => {
  await wipeDb();
  for (const [i, role] of ROLES.entries()) {
    await prisma.user.create({
      data: {
        name: `User ${role}`,
        email: `backfill-${i}@tenant.test`,
        role,
        passwordHash: await hashPassword('Backfill-Test-1'),
        isActive: true,
      },
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Phase-1 default-tenant backfill', () => {
  it('creates one default tenant and a role-matching membership per user', async () => {
    const res = await backfillDefaultTenant(prisma);
    expect(res.memberships).toBe(ROLES.length);

    const tenant = await prisma.tenant.findUnique({ where: { slug: DEFAULT_TENANT_SLUG } });
    expect(tenant?.name).toBe(DEFAULT_TENANT_NAME);
    expect(await prisma.tenant.count()).toBe(1);

    // Every user has exactly one membership, in the default tenant, with their own role.
    const users = await prisma.user.findMany({ select: { id: true, role: true } });
    for (const u of users) {
      const memberships = await prisma.membership.findMany({ where: { userId: u.id } });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].tenantId).toBe(tenant!.id);
      expect(memberships[0].role).toBe(u.role);
    }
  });

  it('is idempotent — re-running adds nothing', async () => {
    const res = await backfillDefaultTenant(prisma);
    expect(res.memberships).toBe(0);
    expect(await prisma.tenant.count()).toBe(1);
    expect(await prisma.membership.count()).toBe(ROLES.length);
  });
});
