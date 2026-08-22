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

// SECURITY regression — the "ghost admin" broken-access-control chain (see prima-pm-ghost-admin-incident):
// a self-serve org-signup owner is created with a global role, its PENDING tenant is later
// rejected/hard-deleted (cascading away the membership), leaving an orphaned User row that could still
// authenticate on its stale global role=ADMIN. Enforcement ON throughout.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const PW = 'Ghost-Pass-11';

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
  const platform = await prisma.user.create({ data: { name: 'plat', email: 'plat@ghost.test', role: 'ADMIN', isGuest: false, isPlatformAdmin: true, passwordHash: await hashPassword('x'), isActive: true } });
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
const login = (email: string, password = PW) => request(app).post(api('/auth/login')).send({ email, password });

describe('ghost-admin: orphaned accounts cannot authenticate (Layer 1)', () => {
  it('refuses login for a staff user with role=ADMIN but NO membership (403, not attached)', async () => {
    await runAsSystem(async () => {
      await prisma.user.create({
        data: { name: 'Ghost', email: 'ghost@x.test', role: 'ADMIN', isGuest: false, isActive: true, passwordHash: await hashPassword(PW) },
      });
    });
    const res = await login('ghost@x.test');
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/not attached to any workspace/i);
    expect(res.body.accessToken).toBeUndefined();
  });

  it('still lets a GUEST in — a guest holds an ACTIVE personal membership (200)', async () => {
    await runAsSystem(async () => {
      const g = await prisma.user.create({ data: { name: 'Gina Guest', email: 'gina@guest.test', role: 'GUEST', isGuest: true, isActive: true, passwordHash: await hashPassword(PW) } });
      const t = await prisma.tenant.create({ data: { name: 'Gina (personal)', slug: `guest-${g.id}`, isPersonal: true, status: 'ACTIVE' } });
      await prisma.membership.create({ data: { userId: g.id, tenantId: t.id, role: 'GUEST' } });
    });
    const res = await login('gina@guest.test');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('exempts a PLATFORM ADMIN with no membership (may operate tenant-less, 200)', async () => {
    await runAsSystem(async () => {
      await prisma.user.create({ data: { name: 'Super', email: 'super@x.test', role: 'ADMIN', isGuest: false, isPlatformAdmin: true, isActive: true, passwordHash: await hashPassword(PW) } });
    });
    const res = await login('super@x.test');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });
});

describe('ghost-admin: org signup withholds the global privileged role (Layer 3)', () => {
  it('creates the owner with a NON-privileged global role while PENDING; membership stays ADMIN', async () => {
    const res = await signup({ orgName: 'Ghostorg', ownerName: 'Owen', email: 'owen@ghostorg.test', password: PW });
    expect(res.status).toBe(202);
    const owner = await runAsSystem(() => prisma.user.findUniqueOrThrow({ where: { email: 'owen@ghostorg.test' } }));
    expect(owner.role).not.toBe('ADMIN'); // global role withheld until approval
    const t = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'ghostorg' } }));
    const m = await runAsSystem(() => prisma.membership.findUniqueOrThrow({ where: { userId_tenantId: { userId: owner.id, tenantId: t.id } } }));
    expect(m.role).toBe('ADMIN'); // per-tenant owner role is correct
  });

  it('promotes the owner global role to ADMIN on approval, and login then works (200)', async () => {
    const t = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'ghostorg' } }));
    const approve = await request(app).post(api(`/admin/tenants/${t.id}/approve`)).set(bearer(platformToken));
    expect(approve.status).toBe(200);
    const owner = await runAsSystem(() => prisma.user.findUniqueOrThrow({ where: { email: 'owen@ghostorg.test' } }));
    expect(owner.role).toBe('ADMIN');
    expect((await login('owen@ghostorg.test')).status).toBe(200);
  });
});

describe('ghost-admin: deleting a tenant deactivates orphaned owners (Layer 2)', () => {
  it('an approved owner is DEACTIVATED (and cannot log in) after their only tenant is hard-deleted', async () => {
    // Fresh org, approve it, confirm login works.
    expect((await signup({ orgName: 'Deleteme Ltd', ownerName: 'Della', email: 'della@del.test', password: PW })).status).toBe(202);
    const t = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: 'deleteme-ltd' } }));
    expect((await request(app).post(api(`/admin/tenants/${t.id}/approve`)).set(bearer(platformToken))).status).toBe(200);
    expect((await login('della@del.test')).status).toBe(200);

    // Hard-delete the tenant.
    const del = await request(app).delete(api(`/admin/tenants/${t.id}`)).set(bearer(platformToken)).send({ confirmSlug: 'deleteme-ltd' });
    expect(del.status).toBe(204);

    // Owner is now orphaned → deactivated, membership gone, and login is refused.
    const owner = await runAsSystem(() => prisma.user.findUniqueOrThrow({ where: { email: 'della@del.test' } }));
    expect(owner.isActive).toBe(false);
    expect(owner.tokenVersion).toBeGreaterThan(0); // sessions killed
    const memCount = await runAsSystem(() => prisma.membership.count({ where: { userId: owner.id } }));
    expect(memCount).toBe(0);
    expect((await login('della@del.test')).status).toBe(401); // isActive=false → Invalid credentials
  });

  it('does NOT deactivate the platform admin when a tenant is deleted (exempt)', async () => {
    // Platform admin remains active + able to drive the console.
    const plat = await runAsSystem(() => prisma.user.findUniqueOrThrow({ where: { email: 'plat@ghost.test' } }));
    expect(plat.isActive).toBe(true);
  });
});
