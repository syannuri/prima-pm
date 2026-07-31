import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __resetSettingsCache } from '../../modules/settings/settings.service.js';

// Guest workspace under ENFORCEMENT (Phase 3d contract): a guest is their own PERSONAL tenant, and
// governs their own projects with no approval matrix — now driven by the tenant's isPersonal flag
// (req.user.tenantIsPersonal in rbac), the tenant-native replacement for the project's
// personalOwnerId. Cross-tenant isolation (a corporate ADMIN cannot reach a guest project, and
// vice-versa) is the tenant extension's job → a cross-tenant project simply 404s. (Broad list/read/
// mutate isolation lives in tenancy-leakage / guest-tenant / tenancy-http; this file focuses on the
// guest's OWN self-service + self-governance.) Flag toggled for this file only.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let adminToken = '', corpTenantId = '', corpProjectId = '', corpPmId = '';
let guestToken = '', guestId = '', personalProjectId = '';
let guest2Token = '';

async function registerGuest(email: string): Promise<{ token: string; id: string }> {
  const res = await request(app).post(api('/auth/guest/register')).send({ name: email, email, password: 'GuestPass123' });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  __resetSettingsCache();
  await wipeDb();

  // A corporate tenant with an ADMIN + a PM (for the guest-PM-rejection test).
  const corp = await prisma.tenant.create({ data: { slug: 'corp', name: 'Corp Org' } });
  corpTenantId = corp.id;
  const admin = await prisma.user.create({ data: { name: 'Corp Admin', email: 'admin@gw.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  const pm = await prisma.user.create({ data: { name: 'Corp PM', email: 'pm@gw.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  corpPmId = pm.id;
  await prisma.membership.createMany({ data: [
    { userId: admin.id, tenantId: corpTenantId, role: 'ADMIN' },
    { userId: pm.id, tenantId: corpTenantId, role: 'PROJECT_MANAGER' },
  ] });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email, tv: 0, tid: corpTenantId });
  const corp1 = await runWithTenant(corpTenantId, () => prisma.project.create({ data: { code: 'PRJ-GW-CORP', name: 'Corp project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id } }));
  corpProjectId = corp1.id;

  const g = await registerGuest('gina@gw.test');
  guestToken = g.token; guestId = g.id;
  guest2Token = (await registerGuest('hank@gw.test')).token;
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE;
  else process.env.MULTITENANCY_ENFORCE = prevFlag;
  __resetSettingsCache();
});

describe('a guest owns + self-governs a personal project', () => {
  it('creates a personal project, self-owned (pmUserId forced to self even if another is passed)', async () => {
    const res = await request(app).post(api('/projects')).set(auth(guestToken)).send({ name: 'My Personal Project', pmUserId: corpPmId });
    expect(res.status).toBe(201);
    personalProjectId = res.body.project.id;
    expect(res.body.project.pmUserId).toBe(guestId);
  });

  it('self-governs it: charter → build a WBS task → capture the schedule baseline (no approver)', async () => {
    // requireProjectGovernance now allows this because the active tenant is personal (isPersonal).
    expect((await request(app).patch(api(`/projects/${personalProjectId}`)).set(auth(guestToken)).send({ status: 'CHARTERED' })).status).toBe(200);
    const task = await request(app).post(api(`/projects/${personalProjectId}/schedule/tasks`)).set(auth(guestToken)).send({ name: 'Guest WBS task', planStart: '2026-08-01', planEnd: '2026-08-10' });
    expect(task.status).toBe(201);
    expect((await request(app).post(api(`/projects/${personalProjectId}/schedule/baseline`)).set(auth(guestToken))).status).toBe(200);
  });

  it('adds a direct cost line, and curates + uses a private rate card + resource', async () => {
    const rc = await request(app).post(api('/ratecards')).set(auth(guestToken)).send({ roleName: 'Freelance Dev', unitCostPerManday: 1_500_000 });
    expect(rc.status).toBe(201);
    const res = await request(app).post(api('/resources')).set(auth(guestToken)).send({ name: 'Me (guest)', rateCardId: rc.body.rateCard.id, capacityPerDay: 1 });
    expect(res.status).toBe(201);
    const line = await request(app).post(api(`/projects/${personalProjectId}/cost/direct`)).set(auth(guestToken)).send({ type: 'MANPOWER', resourceId: res.body.resource.id, planMandays: 5 });
    expect(line.status).toBe(201);
  });

  it('cannot attach a corporate login identity to a manpower line (resourceUserId nulled in a personal tenant)', async () => {
    // activeTenantIsPersonal() → the corporate identity is stripped so a guest line never surfaces in
    // a corporate user's timesheet / directory.
    const line = await request(app).post(api(`/projects/${personalProjectId}/cost/direct`)).set(auth(guestToken))
      .send({ type: 'MANPOWER', resourceUserId: corpPmId, planMandays: 3, personnelRole: 'PROJECT_PERSONNEL', unitCostPerManday: 1_000_000, label: 'Freelance work' });
    expect(line.status).toBe(201);
    expect(line.body.line.resourceUserId).toBeNull();
  });
});

describe('tenant scoping isolates the guest sandbox (no personalOwnerId filter needed)', () => {
  it('a corporate ADMIN cannot reach a guest project (404 — different tenant)', async () => {
    expect((await request(app).get(api(`/projects/${personalProjectId}`)).set(auth(adminToken))).status).toBe(404);
    expect((await request(app).patch(api(`/projects/${personalProjectId}`)).set(auth(adminToken)).send({ name: 'x' })).status).toBe(404);
  });

  it('a guest cannot reach the corporate project (404)', async () => {
    expect((await request(app).get(api(`/projects/${corpProjectId}`)).set(auth(guestToken))).status).toBe(404);
  });

  it("another guest cannot reach the first guest's project (404)", async () => {
    expect((await request(app).get(api(`/projects/${personalProjectId}`)).set(auth(guest2Token))).status).toBe(404);
  });
});

describe('corporate rules are unchanged', () => {
  it('a guest cannot be assigned as PM of a corporate project (create → 400, global-role rule)', async () => {
    expect((await request(app).post(api('/projects')).set(auth(adminToken)).send({ name: 'GuestPM-Attempt', pmUserId: guestId })).status).toBe(400);
  });
});
