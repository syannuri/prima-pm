import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant, runAsSystem } from '../../lib/tenant/context.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Proves the Phase-3 safety net: with MULTITENANCY_ENFORCE on, the Prisma tenant extension
// isolates every scoped operation by the active tenant (from AsyncLocalStorage), stamps tenantId
// on create (incl. nested), fail-closes with no context, and leaves global models untouched.
// The flag is toggled for THIS file only (serial run) and restored in afterAll.

let prevFlag: string | undefined;
let tenantA = '';
let tenantB = '';
let projectA = '';
let projectB = '';
let uA = '';
let uB = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb(); // raw TRUNCATE bypasses the extension

  // Global models (Tenant/User) are never scoped — created without a tenant context.
  const [ta, tb] = await Promise.all([
    prisma.tenant.create({ data: { slug: 'ext-a', name: 'Org A' } }),
    prisma.tenant.create({ data: { slug: 'ext-b', name: 'Org B' } }),
  ]);
  tenantA = ta.id; tenantB = tb.id;
  const [ua, ub] = await Promise.all([
    prisma.user.create({ data: { name: 'UA', email: 'ua@ext.test', role: 'PROJECT_MANAGER', isActive: true } }),
    prisma.user.create({ data: { name: 'UB', email: 'ub@ext.test', role: 'PROJECT_MANAGER', isActive: true } }),
  ]);
  uA = ua.id; uB = ub.id;

  // Scoped rows seeded INSIDE each tenant's context — tenantId is stamped by the extension,
  // not passed explicitly (this also exercises create-stamping).
  const pa = await runWithTenant(tenantA, () =>
    prisma.project.create({ data: { code: 'PRJ-EXT-A', name: 'A proj', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: uA } }),
  );
  const pb = await runWithTenant(tenantB, () =>
    prisma.project.create({ data: { code: 'PRJ-EXT-B', name: 'B proj', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: uB } }),
  );
  projectA = pa.id; projectB = pb.id;
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE;
  else process.env.MULTITENANCY_ENFORCE = prevFlag;
  await prisma.$disconnect();
});

describe('tenant extension — read isolation', () => {
  it('findMany returns only the active tenant’s rows', async () => {
    const inA = await runWithTenant(tenantA, () => prisma.project.findMany({ select: { id: true } }));
    expect(inA.map((p) => p.id)).toEqual([projectA]);
    const inB = await runWithTenant(tenantB, () => prisma.project.findMany({ select: { id: true } }));
    expect(inB.map((p) => p.id)).toEqual([projectB]);
  });

  it('findUnique across tenants returns null (by-id op is scoped too)', async () => {
    const leaked = await runWithTenant(tenantA, () => prisma.project.findUnique({ where: { id: projectB }, select: { id: true } }));
    expect(leaked).toBeNull();
    const own = await runWithTenant(tenantA, () => prisma.project.findUnique({ where: { id: projectA }, select: { id: true } }));
    expect(own?.id).toBe(projectA);
  });

  it('count/aggregate are scoped', async () => {
    expect(await runWithTenant(tenantA, () => prisma.project.count())).toBe(1);
    expect(await runWithTenant(tenantB, () => prisma.project.count())).toBe(1);
  });
});

describe('tenant extension — write isolation', () => {
  it('cannot update or delete another tenant’s row', async () => {
    const upd = await runWithTenant(tenantA, () => prisma.project.updateMany({ where: { id: projectB }, data: { name: 'hacked' } }));
    expect(upd.count).toBe(0);
    const del = await runWithTenant(tenantA, () => prisma.project.deleteMany({ where: { id: projectB } }));
    expect(del.count).toBe(0);
    // victim intact
    const still = await runWithTenant(tenantB, () => prisma.project.findUnique({ where: { id: projectB }, select: { name: true } }));
    expect(still?.name).toBe('B proj');
  });

  it('stamps tenantId on create — including nested writes', async () => {
    const conv = await runWithTenant(tenantA, () =>
      prisma.conversation.create({
        data: { type: 'GROUP', title: 'A team', members: { create: [{ userId: uA }, { userId: uB }] } },
        include: { members: true },
      }),
    );
    // read back raw (system scope) to inspect the actual stored tenantId
    const [convRow, memberRows] = await runAsSystem(() => Promise.all([
      prisma.conversation.findUnique({ where: { id: conv.id }, select: { tenantId: true } }),
      prisma.conversationMember.findMany({ where: { conversationId: conv.id }, select: { tenantId: true } }),
    ]));
    expect(convRow?.tenantId).toBe(tenantA);
    expect(memberRows).toHaveLength(2);
    expect(memberRows.every((m) => m.tenantId === tenantA)).toBe(true);
  });
});

describe('tenant extension — fail-closed & escape hatches', () => {
  it('throws when a scoped model is queried with no tenant context', async () => {
    await expect(prisma.project.findMany()).rejects.toThrow(/Tenant context required/);
  });

  it('runAsSystem bypasses scoping (sees all tenants)', async () => {
    const all = await runAsSystem(() => prisma.project.findMany({ select: { id: true } }));
    expect(all.map((p) => p.id).sort()).toEqual([projectA, projectB].sort());
  });

  it('global models are never scoped (no context needed)', async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: '@ext.test' } }, select: { id: true } });
    expect(users.map((u) => u.id).sort()).toEqual([uA, uB].sort());
  });
});
