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
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let platformToken = '';
let planco = ''; // a FREE corporate tenant
let ownerToken = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  const { tenantId: defaultTid } = await backfillDefaultTenant(prisma);

  const platform = await prisma.user.create({ data: { name: 'plat', email: 'plat@plan.test', role: 'ADMIN', isPlatformAdmin: true, passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: platform.id, tenantId: defaultTid, role: 'ADMIN' } });
  platformToken = signAccessToken({ sub: platform.id, role: 'ADMIN', email: platform.email, tv: 0, tid: defaultTid });

  const t = await prisma.tenant.create({ data: { slug: 'planco', name: 'Plan Co' } }); // defaults to FREE
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
  it('FREE caps active projects at 3; upgrading to PRO lifts the cap', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await request(app).post(api('/projects')).set(bearer(ownerToken)).send({ name: `P${i}` })).status).toBe(201);
    }
    // 4th project on FREE is refused.
    const blocked = await request(app).post(api('/projects')).set(bearer(ownerToken)).send({ name: 'P4' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/FREE plan allows up to 3/);

    // Platform admin upgrades the plan → the 4th project now succeeds.
    expect((await request(app).patch(api(`/admin/tenants/${planco}`)).set(bearer(platformToken)).send({ plan: 'PRO' })).status).toBe(200);
    expect((await request(app).post(api('/projects')).set(bearer(ownerToken)).send({ name: 'P4' })).status).toBe(201);

    // GET reflects the plan.
    const list = await request(app).get(api('/admin/tenants')).set(bearer(platformToken));
    expect(list.body.tenants.find((x: { id: string }) => x.id === planco).plan).toBe('PRO');
  });

  it('a PERSONAL (guest) tenant is ungated — more than the FREE cap is allowed', async () => {
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
  it('FREE caps members at 5; the 6th add is refused', async () => {
    const t = await runAsSystem(() => prisma.tenant.create({ data: { slug: 'memco', name: 'Mem Co' } })); // FREE
    const admin = await prisma.user.create({ data: { name: 'a', email: 'a@memco.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
    await runAsSystem(() => prisma.membership.create({ data: { userId: admin.id, tenantId: t.id, role: 'ADMIN' } }));
    const tok = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email, tv: 0, tid: t.id });

    // Seed staff accounts to invite. Fill to the cap (admin + 4 = 5), then the 6th is refused.
    const emails: string[] = [];
    for (let i = 0; i < 5; i++) {
      const u = await prisma.user.create({ data: { name: `m${i}`, email: `m${i}@memco.test`, role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
      emails.push(u.email);
    }
    for (let i = 0; i < 4; i++) {
      expect((await request(app).post(api('/members')).set(bearer(tok)).send({ email: emails[i], role: 'PROJECT_MANAGER' })).status).toBe(201);
    }
    const blocked = await request(app).post(api('/members')).set(bearer(tok)).send({ email: emails[4], role: 'PROJECT_MANAGER' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/allows up to 5 members/);
  });
});
