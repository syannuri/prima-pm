import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runAsSystem } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Platform (super-admin) console — tenant provisioning + lifecycle (Phase 5). Runs enforcement-ON.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let defaultTid = '';
let platformToken = '', plainAdminToken = '', plainAdminEmail = 'plain-admin@plat.test';

async function mkStaff(email: string, opts: { platform?: boolean } = {}) {
  return prisma.user.create({ data: { name: email, email, role: 'ADMIN', isGuest: false, isPlatformAdmin: !!opts.platform, passwordHash: await hashPassword('x'), isActive: true } });
}

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  const { tenantId } = await backfillDefaultTenant(prisma);
  defaultTid = tenantId;

  const platform = await mkStaff('platform@plat.test', { platform: true });
  const plain = await mkStaff(plainAdminEmail);
  const guest = await prisma.user.create({ data: { name: 'g', email: 'guest@plat.test', isGuest: true, passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.createMany({ data: [
    { userId: platform.id, tenantId: defaultTid, role: 'ADMIN' },
    { userId: plain.id, tenantId: defaultTid, role: 'ADMIN' },
    { userId: guest.id, tenantId: defaultTid, role: 'GUEST' },
  ] });
  platformToken = signAccessToken({ sub: platform.id, role: 'ADMIN', email: platform.email, tv: 0, tid: defaultTid });
  plainAdminToken = signAccessToken({ sub: plain.id, role: 'ADMIN', email: plain.email, tv: 0, tid: defaultTid });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE;
  else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('platform-admin gate', () => {
  it('a plain tenant ADMIN (not platform) is forbidden', async () => {
    expect((await request(app).get(api('/admin/tenants')).set(bearer(plainAdminToken))).status).toBe(403);
    expect((await request(app).post(api('/admin/tenants')).set(bearer(plainAdminToken)).send({ name: 'X', slug: 'x', adminEmail: 'a@b.test' })).status).toBe(403);
  });

  it('a platform admin can list all tenants', async () => {
    const res = await request(app).get(api('/admin/tenants')).set(bearer(platformToken));
    expect(res.status).toBe(200);
    expect(res.body.tenants.some((t: { slug: string }) => t.slug === 'default')).toBe(true);
  });
});

describe('provisioning a corporate tenant', () => {
  it('creates the tenant + a NEW first admin (staff, ADMIN membership)', async () => {
    const res = await request(app).post(api('/admin/tenants')).set(bearer(platformToken))
      .send({ name: 'Acme Corp', slug: 'acme', adminEmail: 'owner@acme.test', adminName: 'Acme Owner', adminPassword: 'Acme-Owner-1' });
    expect(res.status).toBe(201);
    expect(res.body.tenant.slug).toBe('acme');

    const [tenant, owner] = await runAsSystem(() => Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'owner@acme.test' } }),
    ]));
    expect(tenant.isPersonal).toBe(false);
    expect(tenant.status).toBe('ACTIVE');
    expect(owner.isGuest).toBe(false);
    const m = await runAsSystem(() => prisma.membership.findUniqueOrThrow({ where: { userId_tenantId: { userId: owner.id, tenantId: tenant.id } } }));
    expect(m.role).toBe('ADMIN');
  });

  it('attaches an EXISTING staff user by email (no new account)', async () => {
    const before = await runAsSystem(() => prisma.user.count());
    const res = await request(app).post(api('/admin/tenants')).set(bearer(platformToken))
      .send({ name: 'Beta Ltd', slug: 'beta', adminEmail: plainAdminEmail });
    expect(res.status).toBe(201);
    expect(await runAsSystem(() => prisma.user.count())).toBe(before); // attached, not created
    const plain = await runAsSystem(() => prisma.user.findUniqueOrThrow({ where: { email: plainAdminEmail } }));
    const memberships = await runAsSystem(() => prisma.membership.findMany({ where: { userId: plain.id } }));
    expect(memberships.length).toBe(2); // default + beta
  });

  it('rejects a guest email, a duplicate slug, and a bad slug', async () => {
    expect((await request(app).post(api('/admin/tenants')).set(bearer(platformToken)).send({ name: 'G', slug: 'gorg', adminEmail: 'guest@plat.test' })).status).toBe(400);
    expect((await request(app).post(api('/admin/tenants')).set(bearer(platformToken)).send({ name: 'Dup', slug: 'acme', adminEmail: 'x@y.test', adminName: 'X', adminPassword: 'Dup-Pass-11' })).status).toBe(409);
    expect((await request(app).post(api('/admin/tenants')).set(bearer(platformToken)).send({ name: 'Bad', slug: 'Bad Slug!', adminEmail: 'x@y.test' })).status).toBe(400);
  });
});

describe('suspend / reactivate locks out members', () => {
  it('a suspended tenant blocks its members (403), the default tenant cannot be suspended, and reactivation restores access', async () => {
    const acme = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } }));
    const owner = await runAsSystem(() => prisma.user.findUniqueOrThrow({ where: { email: 'owner@acme.test' } }));
    const ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: acme.id });

    // Active: the owner can reach scoped routes.
    expect((await request(app).get(api('/projects')).set(bearer(ownerToken))).status).toBe(200);

    // Suspend acme → the owner is locked out (403).
    expect((await request(app).patch(api(`/admin/tenants/${acme.id}`)).set(bearer(platformToken)).send({ status: 'SUSPENDED' })).status).toBe(200);
    expect((await request(app).get(api('/projects')).set(bearer(ownerToken))).status).toBe(403);

    // The default tenant may never be suspended.
    expect((await request(app).patch(api(`/admin/tenants/${defaultTid}`)).set(bearer(platformToken)).send({ status: 'SUSPENDED' })).status).toBe(400);

    // Reactivate → access restored.
    expect((await request(app).patch(api(`/admin/tenants/${acme.id}`)).set(bearer(platformToken)).send({ status: 'ACTIVE' })).status).toBe(200);
    expect((await request(app).get(api('/projects')).set(bearer(ownerToken))).status).toBe(200);
  });
});
