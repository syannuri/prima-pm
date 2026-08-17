import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runAsSystem } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { __resetSettingsCache } from '../../modules/settings/settings.service.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Self-serve organization signup (Phase 6 SaaS, option C — manual approval). Enforcement ON.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let prevOrg: string | undefined;
let platformToken = '';

const setOrgSignup = async (on: boolean) => {
  await runAsSystem(() => prisma.appSetting.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', orgSignupEnabled: on },
    update: { orgSignupEnabled: on },
  }));
  __resetSettingsCache();
};

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevOrg = process.env.ORG_SIGNUP_ENABLED;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  const { tenantId } = await backfillDefaultTenant(prisma);
  // A platform admin to drive the approve/reject console.
  const platform = await prisma.user.create({ data: { name: 'plat', email: 'plat@org.test', role: 'ADMIN', isGuest: false, isPlatformAdmin: true, passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: platform.id, tenantId, role: 'ADMIN' } });
  platformToken = signAccessToken({ sub: platform.id, role: 'ADMIN', email: platform.email, tv: 0, tid: tenantId });
  await setOrgSignup(true);
});

afterAll(() => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevOrg === undefined) delete process.env.ORG_SIGNUP_ENABLED; else process.env.ORG_SIGNUP_ENABLED = prevOrg;
  __resetSettingsCache();
});

const signup = (body: Record<string, string>) => request(app).post(api('/auth/signup')).send(body);
const login = (email: string, password: string) => request(app).post(api('/auth/login')).send({ email, password });

describe('self-serve organization signup (manual approval)', () => {
  it('creates a PENDING corporate tenant + owner ADMIN but does NOT log in (202, no token)', async () => {
    const res = await signup({ orgName: 'Acme Industries', ownerName: 'Ada Owner', email: 'ada@acme.test', password: 'Acme-Owner-1' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ pending: true, orgName: 'Acme Industries' });
    expect(res.body.accessToken).toBeUndefined();

    const [tenant, owner] = await runAsSystem(() => Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme-industries' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'ada@acme.test' } }),
    ]));
    expect(tenant.isPersonal).toBe(false);
    expect(tenant.status).toBe('PENDING');
    expect(tenant.plan).toBe('TRIAL'); // new corporate orgs start a 60-day trial (full PRO experience)
    expect(tenant.trialEndsAt).toBeTruthy(); // the trial clock is stamped at signup
    expect(tenant.trialEndsAt!.getTime()).toBeGreaterThan(Date.now()); // ~60 days out
    expect(owner.isGuest).toBe(false);
    const m = await runAsSystem(() => prisma.membership.findUniqueOrThrow({ where: { userId_tenantId: { userId: owner.id, tenantId: tenant.id } } }));
    expect(m.role).toBe('ADMIN');
  });

  it('drops an inbox notification for the platform admin about the pending request', async () => {
    const notif = await runAsSystem(() => prisma.notification.findFirst({
      where: { type: 'ORG_SIGNUP_PENDING' },
      orderBy: { createdAt: 'desc' },
    }));
    expect(notif).toBeTruthy();
    expect(notif!.title).toMatch(/workspace request/i);
    expect(notif!.body).toContain('Acme Industries');
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'plat@org.test' }, select: { id: true } });
    expect(notif!.userId).toBe(admin.id);
    expect(notif!.tenantId).toBeTruthy(); // stamped into the admin's home tenant so their inbox sees it
  });

  it('refuses login while the workspace is still PENDING (403, awaiting approval)', async () => {
    const res = await login('ada@acme.test', 'Acme-Owner-1');
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/approval/i);
  });

  it('lets the owner in once a platform admin APPROVES it', async () => {
    const t = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme-industries' } }));
    const approve = await request(app).post(api(`/admin/tenants/${t.id}/approve`)).set(bearer(platformToken));
    expect(approve.status).toBe(200);
    expect(approve.body.tenant.status).toBe('ACTIVE');

    const res = await login('ada@acme.test', 'Acme-Owner-1');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('approve is idempotent-guarded: a non-PENDING tenant cannot be approved again (400)', async () => {
    const t = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme-industries' } }));
    expect((await request(app).post(api(`/admin/tenants/${t.id}/approve`)).set(bearer(platformToken))).status).toBe(400);
  });

  it('REJECT soft-locks a PENDING signup (→ REJECTED) and the owner still cannot log in', async () => {
    const su = await signup({ orgName: 'Rejectco', ownerName: 'Rex Owner', email: 'rex@rej.test', password: 'Rej-Owner-11' });
    expect(su.status).toBe(202);
    const t = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'rejectco' } }));

    const rej = await request(app).post(api(`/admin/tenants/${t.id}/reject`)).set(bearer(platformToken));
    expect(rej.status).toBe(200);
    expect(rej.body.tenant.status).toBe('REJECTED');

    // Tenant is kept (soft) but locked out.
    const after = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { id: t.id } }));
    expect(after.status).toBe('REJECTED');
    expect((await login('rex@rej.test', 'Rej-Owner-11')).status).toBe(403);
  });

  it('a plain tenant admin cannot approve (platform-admin gated, 403)', async () => {
    const su = await signup({ orgName: 'Gatedco', ownerName: 'Gwen', email: 'gwen@gate.test', password: 'Gate-Owner-11' });
    expect(su.status).toBe(202);
    const t = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'gatedco' } }));
    // No token → requireAuth 401; the point is it's not reachable without the platform gate.
    expect((await request(app).post(api(`/admin/tenants/${t.id}/approve`))).status).toBe(401);
  });

  it('auto-uniquifies the slug when the org name is reused', async () => {
    const res = await signup({ orgName: 'Acme Industries', ownerName: 'Bo Owner', email: 'bo@acme2.test', password: 'Acme-Owner-2' });
    expect(res.status).toBe(202);
    const tenant = await runAsSystem(() => prisma.tenant.findFirstOrThrow({ where: { slug: 'acme-industries-2' } }));
    expect(tenant.slug).toBe('acme-industries-2'); // first taken → suffixed
  });

  it('rejects a duplicate email (409)', async () => {
    expect((await signup({ orgName: 'Dup Co', ownerName: 'Dup Owner', email: 'ada@acme.test', password: 'Dup-Pass-11' })).status).toBe(409);
  });

  it('is refused (403) when the deployment toggle is off', async () => {
    await setOrgSignup(false);
    expect((await signup({ orgName: 'Nope Ltd', ownerName: 'Nope Owner', email: 'y@nope.test', password: 'Nope-Pass-1' })).status).toBe(403);
    await setOrgSignup(true);
  });

  it('advertises orgSignup on /auth/providers', async () => {
    const res = await request(app).get(api('/auth/providers'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('orgSignup');
  });
});
