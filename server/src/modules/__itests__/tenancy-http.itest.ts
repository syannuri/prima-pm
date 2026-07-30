import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken, verifyAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// End-to-end proof of the pooled-multitenancy stack WITH enforcement on: token `tid` →
// requireAuth opens the tenant context → the Prisma extension isolates every query. Two corporate
// tenants (ADMIN users, so ONLY the tenant extension — not ownership — can be what isolates them),
// plus the /auth/switch-tenant flow. Flag toggled for this file only (serial run) and restored.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const PW = 'Tenancy-Http-1';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let tenantA = '', tenantB = '';
let projectA = '', projectB = '';
let tokenA = '', tokenB = '';

async function mkUser(email: string) {
  return prisma.user.create({ data: { name: email, email, role: 'ADMIN', passwordHash: await hashPassword(PW), isActive: true } });
}

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();

  const [ta, tb] = await Promise.all([
    prisma.tenant.create({ data: { slug: 'http-a', name: 'Org A' } }),
    prisma.tenant.create({ data: { slug: 'http-b', name: 'Org B' } }),
  ]);
  tenantA = ta.id; tenantB = tb.id;

  const [ua, ub, uc] = await Promise.all([mkUser('a@http.test'), mkUser('b@http.test'), mkUser('c@http.test')]);
  // uA in A, uB in B, uC in BOTH (for switch-tenant).
  await prisma.membership.createMany({ data: [
    { userId: ua.id, tenantId: tenantA, role: 'ADMIN' },
    { userId: ub.id, tenantId: tenantB, role: 'ADMIN' },
    { userId: uc.id, tenantId: tenantA, role: 'ADMIN' },
    { userId: uc.id, tenantId: tenantB, role: 'ADMIN' },
  ] });

  const pa = await runWithTenant(tenantA, () => prisma.project.create({ data: { code: 'PRJ-HTTP-A', name: 'A proj', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: ua.id } }));
  const pb = await runWithTenant(tenantB, () => prisma.project.create({ data: { code: 'PRJ-HTTP-B', name: 'B proj', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: ub.id } }));
  projectA = pa.id; projectB = pb.id;

  tokenA = signAccessToken({ sub: ua.id, role: 'ADMIN', email: ua.email, tv: 0, tid: tenantA });
  tokenB = signAccessToken({ sub: ub.id, role: 'ADMIN', email: ub.email, tv: 0, tid: tenantB });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE;
  else process.env.MULTITENANCY_ENFORCE = prevFlag;
  await prisma.$disconnect();
});

describe('auth mints tokens pinned to the active tenant', () => {
  it('login embeds tid for a single-membership user', async () => {
    const res = await request(app).post(api('/auth/login')).send({ email: 'a@http.test', password: PW });
    expect(res.status).toBe(200);
    expect(verifyAccessToken(res.body.accessToken).tid).toBe(tenantA);
  });
});

describe('HTTP isolation between corporate tenants (ADMIN — only the extension isolates)', () => {
  it('project list shows only the active tenant’s projects', async () => {
    const a = await request(app).get(api('/projects')).set(bearer(tokenA));
    expect(a.status).toBe(200);
    expect(a.body.projects.map((p: { id: string }) => p.id)).toEqual([projectA]);
    const b = await request(app).get(api('/projects')).set(bearer(tokenB));
    expect(b.body.projects.map((p: { id: string }) => p.id)).toEqual([projectB]);
  });

  it('cannot read another tenant’s project by id', async () => {
    const res = await request(app).get(api(`/projects/${projectB}`)).set(bearer(tokenA));
    expect([403, 404]).toContain(res.status);
  });

  it('cannot mutate another tenant’s project', async () => {
    const res = await request(app).post(api(`/projects/${projectB}/risk`)).set(bearer(tokenA))
      .send({ title: 'x', probabilityScore: 1, impactScore: 1, probabilityPct: 0.1, impactCostIdr: 1 });
    expect([403, 404]).toContain(res.status);
  });
});

describe('switch-tenant re-scopes a multi-tenant member', () => {
  it('changes which tenant’s data is visible', async () => {
    const login = await request(app).post(api('/auth/login')).send({ email: 'c@http.test', password: PW });
    const first = login.body.accessToken;
    expect(verifyAccessToken(first).tid).toBe(tenantA); // first membership by createdAt
    const seesA = await request(app).get(api('/projects')).set(bearer(first));
    expect(seesA.body.projects.map((p: { id: string }) => p.id)).toEqual([projectA]);

    const sw = await request(app).post(api('/auth/switch-tenant')).set(bearer(first)).send({ tenantId: tenantB });
    expect(sw.status).toBe(200);
    const second = sw.body.accessToken;
    expect(verifyAccessToken(second).tid).toBe(tenantB);
    const seesB = await request(app).get(api('/projects')).set(bearer(second));
    expect(seesB.body.projects.map((p: { id: string }) => p.id)).toEqual([projectB]);
  });

  it('rejects switching to a tenant you are not a member of', async () => {
    const res = await request(app).post(api('/auth/switch-tenant')).set(bearer(tokenA)).send({ tenantId: tenantB });
    expect(res.status).toBe(403);
  });
});
