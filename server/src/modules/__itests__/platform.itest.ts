import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runAsSystem, runWithTenant } from '../../lib/tenant/context.js';
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

describe('impersonation', () => {
  it('a platform admin gets a token to act as ADMIN inside a tenant they do not belong to', async () => {
    const acme = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } }));
    const platform = await runAsSystem(() => prisma.user.findUniqueOrThrow({ where: { email: 'platform@plat.test' } }));
    // The platform admin is NOT a member of acme.
    expect(await runAsSystem(() => prisma.membership.findUnique({ where: { userId_tenantId: { userId: platform.id, tenantId: acme.id } } }))).toBeNull();

    const res = await request(app).post(api(`/admin/tenants/${acme.id}/impersonate`)).set(bearer(platformToken));
    expect(res.status).toBe(200);
    const impToken = res.body.accessToken as string;

    // With the impersonation token they act as ADMIN scoped to acme: create a project there.
    const proj = await request(app).post(api('/projects')).set(bearer(impToken)).send({ name: 'Impersonated project' });
    expect(proj.status).toBe(201);
    const created = await runAsSystem(() => prisma.project.findUniqueOrThrow({ where: { id: proj.body.project.id }, select: { tenantId: true } }));
    expect(created.tenantId).toBe(acme.id); // stamped into acme, not the admin's own tenant

    // The start was audited against the real platform admin.
    const audit = await runAsSystem(() => prisma.auditLog.findFirst({ where: { entity: 'Tenant', entityId: acme.id, action: 'IMPERSONATE', userId: platform.id } }));
    expect(audit).not.toBeNull();
  });

  it('a plain (non-platform) admin cannot impersonate, and a personal tenant is refused', async () => {
    const acme = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } }));
    expect((await request(app).post(api(`/admin/tenants/${acme.id}/impersonate`)).set(bearer(plainAdminToken))).status).toBe(403);
    const personal = await runAsSystem(() => prisma.tenant.create({ data: { slug: 'imp-personal', name: 'Guest', isPersonal: true } }));
    expect((await request(app).post(api(`/admin/tenants/${personal.id}/impersonate`)).set(bearer(platformToken))).status).toBe(400);
  });

  it('an impersonation token stops working the moment the platform flag is revoked', async () => {
    const acme = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } }));
    const platform = await runAsSystem(() => prisma.user.findUniqueOrThrow({ where: { email: 'platform@plat.test' } }));
    const impToken = (await request(app).post(api(`/admin/tenants/${acme.id}/impersonate`)).set(bearer(platformToken))).body.accessToken;
    expect((await request(app).get(api('/projects')).set(bearer(impToken))).status).toBe(200);
    await runAsSystem(() => prisma.user.update({ where: { id: platform.id }, data: { isPlatformAdmin: false } }));
    expect((await request(app).get(api('/projects')).set(bearer(impToken))).status).toBe(403);
    await runAsSystem(() => prisma.user.update({ where: { id: platform.id }, data: { isPlatformAdmin: true } }));
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

  it('a member of ONLY a suspended tenant cannot LOG IN (403), and can again once reactivated', async () => {
    // Provision a fresh corporate tenant + a brand-new admin (its only membership).
    expect((await request(app).post(api('/admin/tenants')).set(bearer(platformToken))
      .send({ name: 'Susp Co', slug: 'suspco', adminEmail: 'boss@suspco.test', adminName: 'Susp Boss', adminPassword: 'Susp-Boss-1' })).status).toBe(201);
    // Baseline: they can log in while active.
    expect((await request(app).post(api('/auth/login')).send({ email: 'boss@suspco.test', password: 'Susp-Boss-1' })).status).toBe(200);

    const suspco = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'suspco' } }));
    expect((await request(app).patch(api(`/admin/tenants/${suspco.id}`)).set(bearer(platformToken)).send({ status: 'SUSPENDED' })).status).toBe(200);

    // Suspended: login must be refused outright — not a 200 that only 403s on later requests.
    const blocked = await request(app).post(api('/auth/login')).send({ email: 'boss@suspco.test', password: 'Susp-Boss-1' });
    expect(blocked.status).toBe(403);

    // Reactivate → login works again.
    expect((await request(app).patch(api(`/admin/tenants/${suspco.id}`)).set(bearer(platformToken)).send({ status: 'ACTIVE' })).status).toBe(200);
    expect((await request(app).post(api('/auth/login')).send({ email: 'boss@suspco.test', password: 'Susp-Boss-1' })).status).toBe(200);
  });

  it('a member of an active tenant AND a suspended one logs in to the ACTIVE tenant (not locked out)', async () => {
    // plainAdmin belongs to default (active) + beta. Suspend beta → they still log in (to default).
    const beta = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'beta' } }));
    await runAsSystem(() => prisma.tenant.update({ where: { id: beta.id }, data: { status: 'SUSPENDED' } }));
    const res = await request(app).post(api('/auth/login')).send({ email: plainAdminEmail, password: 'x' });
    expect(res.status).toBe(200);
    await runAsSystem(() => prisma.tenant.update({ where: { id: beta.id }, data: { status: 'ACTIVE' } }));
  });
});

describe('export a tenant (GDPR data portability)', () => {
  it('returns a JSON bundle (tenant + members + projects incl. children + resources) as an attachment', async () => {
    const exp = await runAsSystem(() => prisma.tenant.create({ data: { slug: 'exportme', name: 'Export Me' } }));
    const owner = await runAsSystem(() => prisma.user.create({ data: { name: 'E', email: 'e@exportme.test', role: 'ADMIN', isActive: true } }));
    await runAsSystem(() => prisma.membership.create({ data: { userId: owner.id, tenantId: exp.id, role: 'ADMIN' } }));
    await runWithTenant(exp.id, async () => {
      const p = await prisma.project.create({ data: { code: 'PRJ-EXP-1', name: 'Portable', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: owner.id } });
      await prisma.risk.create({ data: { projectId: p.id, code: 'R-E-1', title: 'x', probabilityScore: 3, impactScore: 3, riskScore: 9, severity: 'MEDIUM', probabilityPct: '0.5', impactCostIdr: '1', emv: '1' } });
      await prisma.resource.create({ data: { name: 'Exp Res', capacityPerDay: 1 } });
    });

    const res = await request(app).get(api(`/admin/tenants/${exp.id}/export`)).set(bearer(platformToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('tenant-exportme-export.json');
    expect(res.body.tenant.slug).toBe('exportme');
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].user.email).toBe('e@exportme.test');
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.projects[0].risks).toHaveLength(1); // deep child include
    expect(res.body.resources).toHaveLength(1);
    expect(typeof res.body.exportedAt).toBe('string');
  });

  it('is platform-admin only (a plain tenant admin is forbidden) and 404s an unknown tenant', async () => {
    const acme = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } }));
    expect((await request(app).get(api(`/admin/tenants/${acme.id}/export`)).set(bearer(plainAdminToken))).status).toBe(403);
    expect((await request(app).get(api('/admin/tenants/does-not-exist/export')).set(bearer(platformToken))).status).toBe(404);
  });
});

describe('hard-delete a tenant (GDPR)', () => {
  it('removes the tenant and ALL its data, leaving other tenants intact', async () => {
    const delme = await runAsSystem(() => prisma.tenant.create({ data: { slug: 'delme', name: 'Delete Me' } }));
    const owner = await runAsSystem(() => prisma.user.create({ data: { name: 'D', email: 'd@delme.test', role: 'ADMIN', isActive: true } }));
    await runAsSystem(() => prisma.membership.create({ data: { userId: owner.id, tenantId: delme.id, role: 'ADMIN' } }));
    // Seed data across the tenant: a project + a child risk + a resource + a notification.
    const { projectId, riskId } = await runWithTenant(delme.id, async () => {
      const p = await prisma.project.create({ data: { code: 'PRJ-DEL-1', name: 'Doomed', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: owner.id } });
      const r = await prisma.risk.create({ data: { projectId: p.id, code: 'R-D-1', title: 'x', probabilityScore: 3, impactScore: 3, riskScore: 9, severity: 'MEDIUM', probabilityPct: '0.5', impactCostIdr: '1', emv: '1' } });
      await prisma.resource.create({ data: { name: 'Res', capacityPerDay: 1 } });
      await prisma.notification.create({ data: { userId: owner.id, type: 'ACTIVATION_READY', title: 't' } });
      return { projectId: p.id, riskId: r.id };
    });

    // A corporate baseline tenant that must SURVIVE (default already exists with data from earlier tests).
    const survivorProjectsBefore = await runAsSystem(() => prisma.project.count({ where: { tenantId: defaultTid } }));

    const res = await request(app).delete(api(`/admin/tenants/${delme.id}`)).set(bearer(platformToken)).send({ confirmSlug: 'delme' });
    expect(res.status).toBe(204);

    // Tenant + all its rows are gone.
    expect(await runAsSystem(() => prisma.tenant.findUnique({ where: { id: delme.id } }))).toBeNull();
    expect(await runAsSystem(() => prisma.project.findUnique({ where: { id: projectId } }))).toBeNull();
    expect(await runAsSystem(() => prisma.risk.findUnique({ where: { id: riskId } }))).toBeNull(); // cascaded via project
    expect(await runAsSystem(() => prisma.resource.count({ where: { tenantId: delme.id } }))).toBe(0);
    expect(await runAsSystem(() => prisma.notification.count({ where: { tenantId: delme.id } }))).toBe(0);
    expect(await runAsSystem(() => prisma.membership.count({ where: { tenantId: delme.id } }))).toBe(0);
    // The owner's global account remains (identity is global).
    expect(await runAsSystem(() => prisma.user.findUnique({ where: { id: owner.id } }))).not.toBeNull();
    // The default tenant's data is untouched.
    expect(await runAsSystem(() => prisma.project.count({ where: { tenantId: defaultTid } }))).toBe(survivorProjectsBefore);
  });

  it('is guarded: wrong slug (400), the default tenant (400), and a personal tenant (400)', async () => {
    const acme = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } }));
    expect((await request(app).delete(api(`/admin/tenants/${acme.id}`)).set(bearer(platformToken)).send({ confirmSlug: 'wrong' })).status).toBe(400);
    expect((await request(app).delete(api(`/admin/tenants/${defaultTid}`)).set(bearer(platformToken)).send({ confirmSlug: 'default' })).status).toBe(400);
    const personal = await runAsSystem(() => prisma.tenant.create({ data: { slug: 'del-personal', name: 'g', isPersonal: true } }));
    expect((await request(app).delete(api(`/admin/tenants/${personal.id}`)).set(bearer(platformToken)).send({ confirmSlug: 'del-personal' })).status).toBe(400);
    // acme still there (not deleted by the wrong-slug attempt).
    expect(await runAsSystem(() => prisma.tenant.findUnique({ where: { id: acme.id } }))).not.toBeNull();
  });
});
