import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { verifyAccessToken } from '../../lib/jwt.js';
import { runAsSystem } from '../../lib/tenant/context.js';
import { __resetSettingsCache } from '../../modules/settings/settings.service.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Self-serve organization signup (Phase 6 SaaS). Enforcement ON.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;

let prevFlag: string | undefined;
let prevOrg: string | undefined;

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
  await setOrgSignup(true);
});

afterAll(() => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevOrg === undefined) delete process.env.ORG_SIGNUP_ENABLED; else process.env.ORG_SIGNUP_ENABLED = prevOrg;
  __resetSettingsCache();
});

const signup = (body: Record<string, string>) => request(app).post(api('/auth/signup')).send(body);

describe('self-serve organization signup', () => {
  it('creates a corporate tenant + owner ADMIN and auto-logs in (token pinned to the new tenant)', async () => {
    const res = await signup({ orgName: 'Acme Industries', ownerName: 'Ada Owner', email: 'ada@acme.test', password: 'Acme-Owner-1' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('ADMIN');
    const tid = verifyAccessToken(res.body.accessToken).tid;
    expect(tid).toBeTruthy();

    const [tenant, owner] = await runAsSystem(() => Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: tid! } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'ada@acme.test' } }),
    ]));
    expect(tenant.isPersonal).toBe(false);
    expect(tenant.status).toBe('ACTIVE');
    expect(tenant.slug).toBe('acme-industries');
    expect(owner.isGuest).toBe(false);
    const m = await runAsSystem(() => prisma.membership.findUniqueOrThrow({ where: { userId_tenantId: { userId: owner.id, tenantId: tenant.id } } }));
    expect(m.role).toBe('ADMIN');
  });

  it('auto-uniquifies the slug when the org name is reused', async () => {
    const res = await signup({ orgName: 'Acme Industries', ownerName: 'Bo Owner', email: 'bo@acme2.test', password: 'Acme-Owner-2' });
    expect(res.status).toBe(201);
    const tid = verifyAccessToken(res.body.accessToken).tid!;
    const tenant = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { id: tid } }));
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
