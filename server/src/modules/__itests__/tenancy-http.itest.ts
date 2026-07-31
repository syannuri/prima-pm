import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken, verifyAccessToken } from '../../lib/jwt.js';
import { runWithTenant, runAsSystem } from '../../lib/tenant/context.js';
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
let tokenD_A = '', tokenD_B = '';
let uBId = '', uAId = '';

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

  const [ua, ub, uc, ud] = await Promise.all([mkUser('a@http.test'), mkUser('b@http.test'), mkUser('c@http.test'), mkUser('d@http.test')]);
  uBId = ub.id; uAId = ua.id;
  // uA in A, uB in B, uC in BOTH (switch-tenant). uD is ADMIN in A but VIEWER in B (per-tenant role).
  await prisma.membership.createMany({ data: [
    { userId: ua.id, tenantId: tenantA, role: 'ADMIN' },
    { userId: ub.id, tenantId: tenantB, role: 'ADMIN' },
    { userId: uc.id, tenantId: tenantA, role: 'ADMIN' },
    { userId: uc.id, tenantId: tenantB, role: 'ADMIN' },
    { userId: ud.id, tenantId: tenantA, role: 'ADMIN' },
    { userId: ud.id, tenantId: tenantB, role: 'VIEWER' },
  ] });

  const pa = await runWithTenant(tenantA, () => prisma.project.create({ data: { code: 'PRJ-HTTP-A', name: 'A proj', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: ua.id } }));
  const pb = await runWithTenant(tenantB, () => prisma.project.create({ data: { code: 'PRJ-HTTP-B', name: 'B proj', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: ub.id } }));
  projectA = pa.id; projectB = pb.id;

  tokenA = signAccessToken({ sub: ua.id, role: 'ADMIN', email: ua.email, tv: 0, tid: tenantA });
  tokenB = signAccessToken({ sub: ub.id, role: 'ADMIN', email: ub.email, tv: 0, tid: tenantB });
  // Deliberately mint BOTH of uD's tokens with role ADMIN — requireAuth must ignore the token role
  // and resolve the per-tenant membership role (ADMIN in A, VIEWER in B), so the token can't escalate.
  tokenD_A = signAccessToken({ sub: ud.id, role: 'ADMIN', email: ud.email, tv: 0, tid: tenantA });
  tokenD_B = signAccessToken({ sub: ud.id, role: 'ADMIN', email: ud.email, tv: 0, tid: tenantB });
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

  it('stamps the login audit with the user’s tenant (visible in the scoped audit view)', async () => {
    await request(app).post(api('/auth/login')).send({ email: 'a@http.test', password: PW });
    const audit = await runAsSystem(() =>
      prisma.auditLog.findFirst({ where: { userId: uAId, action: 'LOGIN' }, orderBy: { createdAt: 'desc' }, select: { tenantId: true } }),
    );
    expect(audit?.tenantId).toBe(tenantA); // not null → shows in tenant A's /admin/audit
  });
});

describe('transition: pre-enforcement tokens (no tid)', () => {
  it('a token with no tid gets 401 on a scoped route (triggers client refresh, not a 500)', async () => {
    const noTid = signAccessToken({ sub: uAId, role: 'ADMIN', email: 'a@http.test', tv: 0 }); // real user, no tid
    const res = await request(app).get(api('/projects')).set(bearer(noTid));
    expect(res.status).toBe(401);
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

describe('role is per-tenant (Phase 4) — the membership role, not the token or global role', () => {
  it('same user is ADMIN in one tenant and VIEWER in another', async () => {
    // /admin/audit requires ADMIN. uD is ADMIN in A, VIEWER in B — despite BOTH tokens claiming ADMIN.
    const asAdmin = await request(app).get(api('/admin/audit')).set(bearer(tokenD_A));
    expect(asAdmin.status).toBe(200);
    const asViewer = await request(app).get(api('/admin/audit')).set(bearer(tokenD_B));
    expect(asViewer.status).toBe(403);
  });

  it('/auth/me reports the effective per-tenant role', async () => {
    const meA = await request(app).get(api('/auth/me')).set(bearer(tokenD_A));
    expect(meA.body.user.role).toBe('ADMIN');
    const meB = await request(app).get(api('/auth/me')).set(bearer(tokenD_B));
    expect(meB.body.user.role).toBe('VIEWER');
  });
});

describe('user administration is tenant-scoped (Phase 4b)', () => {
  it('directory + user list return only the active tenant’s members', async () => {
    const dir = await request(app).get(api('/users/directory')).set(bearer(tokenA));
    const emails: string[] = dir.body.users.map((u: { email: string }) => u.email);
    expect(emails).toContain('a@http.test'); // member of A
    expect(emails).not.toContain('b@http.test'); // member of B only

    const list = await request(app).get(api('/users')).set(bearer(tokenA));
    expect(list.body.users.map((u: { email: string }) => u.email)).not.toContain('b@http.test');
  });

  it('an admin cannot administer a user outside their tenant', async () => {
    // uB is a member of tenant B only; the tenant-A admin must not touch them.
    const res = await request(app).patch(api(`/users/${uBId}/active`)).set(bearer(tokenA)).send({ isActive: false });
    expect(res.status).toBe(404);
  });
});

describe('membership management for the active tenant (/members)', () => {
  const emails = (r: { body: { members: { email: string }[] } }) => r.body.members.map((m) => m.email);

  it('lists the active tenant’s members', async () => {
    const res = await request(app).get(api('/members')).set(bearer(tokenA));
    expect(res.status).toBe(200);
    expect(emails(res)).toEqual(expect.arrayContaining(['a@http.test', 'c@http.test', 'd@http.test']));
    expect(emails(res)).not.toContain('b@http.test'); // member of B only
  });

  it('adds an existing user to the tenant, changes their role, then removes them', async () => {
    const add = await request(app).post(api('/members')).set(bearer(tokenA)).send({ email: 'b@http.test', role: 'VIEWER' });
    expect(add.status).toBe(201);
    expect(emails(await request(app).get(api('/members')).set(bearer(tokenA)))).toContain('b@http.test');

    const patch = await request(app).patch(api(`/members/${uBId}`)).set(bearer(tokenA)).send({ role: 'FINANCE' });
    expect(patch.status).toBe(200);
    expect(patch.body.member.role).toBe('FINANCE');

    const del = await request(app).delete(api(`/members/${uBId}`)).set(bearer(tokenA));
    expect(del.status).toBe(204);
    expect(emails(await request(app).get(api('/members')).set(bearer(tokenA)))).not.toContain('b@http.test');
  });

  it('rejects adding a non-existent user and removing yourself', async () => {
    const missing = await request(app).post(api('/members')).set(bearer(tokenA)).send({ email: 'nobody@http.test', role: 'VIEWER' });
    expect(missing.status).toBe(404);
    const self = await request(app).delete(api(`/members/${uAId}`)).set(bearer(tokenA));
    expect(self.status).toBe(400);
  });
});
