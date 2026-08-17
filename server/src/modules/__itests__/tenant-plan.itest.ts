import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runAsSystem, runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Phase 6 — per-tenant plan quota gating. Runs enforcement-ON (plan limits are a no-op off-mode).
// TRIAL mirrors PRO (50 projects / 50 members); ENTERPRISE is unlimited. The boundary is exercised by
// bulk-seeding to one below the cap so the test stays cheap.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let platformToken = '';
let planco = ''; // a corporate tenant on the default TRIAL plan (50-project cap)
let ownerToken = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  const { tenantId: defaultTid } = await backfillDefaultTenant(prisma);

  const platform = await prisma.user.create({ data: { name: 'plat', email: 'plat@plan.test', role: 'ADMIN', isPlatformAdmin: true, passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: platform.id, tenantId: defaultTid, role: 'ADMIN' } });
  platformToken = signAccessToken({ sub: platform.id, role: 'ADMIN', email: platform.email, tv: 0, tid: defaultTid });

  const t = await prisma.tenant.create({ data: { slug: 'planco', name: 'Plan Co' } }); // defaults to TRIAL
  planco = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@planco.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId: planco, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: planco });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE;
  else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('plan project quota', () => {
  it('TRIAL caps active projects at 50; upgrading to ENTERPRISE lifts the cap', async () => {
    // Seed to one below the cap (49) so the boundary is cheap to exercise.
    await runAsSystem(() =>
      prisma.project.createMany({
        data: Array.from({ length: 49 }, (_, i) => ({
          code: `PC-${i}`,
          name: `Seed ${i}`,
          status: 'IN_PROGRESS' as const,
          deliveryApproach: 'PREDICTIVE' as const,
          tenantId: planco,
        })),
      }),
    );
    // The 50th project (hitting the cap) is allowed...
    expect((await request(app).post(api('/projects')).set(bearer(ownerToken)).send({ name: 'P50' })).status).toBe(201);
    // ...the 51st is refused.
    const blocked = await request(app).post(api('/projects')).set(bearer(ownerToken)).send({ name: 'P51' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/allows up to 50 active projects/);

    // Platform admin upgrades to ENTERPRISE (unlimited) → the 51st now succeeds.
    expect((await request(app).patch(api(`/admin/tenants/${planco}`)).set(bearer(platformToken)).send({ plan: 'ENTERPRISE' })).status).toBe(200);
    expect((await request(app).post(api('/projects')).set(bearer(ownerToken)).send({ name: 'P51' })).status).toBe(201);

    // GET reflects the plan.
    const list = await request(app).get(api('/admin/tenants')).set(bearer(platformToken));
    expect(list.body.tenants.find((x: { id: string }) => x.id === planco).plan).toBe('ENTERPRISE');
  });

  it('a PERSONAL (guest) tenant is ungated — well over the corporate cap is allowed', async () => {
    const guest = await runAsSystem(() => prisma.tenant.create({ data: { slug: 'plan-personal', name: 'g', isPersonal: true } }));
    const created = await runWithTenant(guest.id, async () => {
      for (let i = 0; i < 5; i++) {
        await prisma.project.create({ data: { code: `PG-${i}`, name: `g${i}`, status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' } });
      }
      return prisma.project.count();
    });
    expect(created).toBe(5); // no cap applied to a personal sandbox
  });
});

describe('plan member quota', () => {
  it('TRIAL caps members at 50; the 51st add is refused', async () => {
    const hash = await hashPassword('x');
    const t = await runAsSystem(() => prisma.tenant.create({ data: { slug: 'memco', name: 'Mem Co' } })); // TRIAL
    const admin = await prisma.user.create({ data: { name: 'a', email: 'a@memco.test', role: 'ADMIN', passwordHash: hash, isActive: true } });
    await runAsSystem(() => prisma.membership.create({ data: { userId: admin.id, tenantId: t.id, role: 'ADMIN' } }));
    const tok = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email, tv: 0, tid: t.id });

    // Bulk-seed filler members up to one below the cap (admin + 48 = 49).
    await prisma.user.createMany({
      data: Array.from({ length: 48 }, (_, i) => ({ name: `f${i}`, email: `f${i}@memco.test`, role: 'PROJECT_MANAGER' as const, passwordHash: hash, isActive: true })),
    });
    const fillers = await prisma.user.findMany({ where: { email: { endsWith: '@memco.test' }, name: { startsWith: 'f' } }, select: { id: true } });
    await runAsSystem(() => prisma.membership.createMany({ data: fillers.map((f) => ({ userId: f.id, tenantId: t.id, role: 'PROJECT_MANAGER' as const })) }));

    // Two spare staff accounts to invite: the 50th add lands on the cap, the 51st is refused.
    const invitees: string[] = [];
    for (let i = 0; i < 2; i++) {
      const u = await prisma.user.create({ data: { name: `inv${i}`, email: `inv${i}@memco.test`, role: 'PROJECT_MANAGER', passwordHash: hash, isActive: true } });
      invitees.push(u.email);
    }
    expect((await request(app).post(api('/members')).set(bearer(tok)).send({ email: invitees[0], role: 'PROJECT_MANAGER' })).status).toBe(201);
    const blocked = await request(app).post(api('/members')).set(bearer(tok)).send({ email: invitees[1], role: 'PROJECT_MANAGER' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/allows up to 50 members/);
  });
});
