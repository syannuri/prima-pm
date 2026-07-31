import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { signAccessToken, verifyAccessToken } from '../../lib/jwt.js';
import { runWithTenant, runAsSystem } from '../../lib/tenant/context.js';
import { backfillDefaultTenant, backfillGuestTenants } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __resetSettingsCache } from '../../modules/settings/settings.service.js';

// Guests become their OWN personal tenant (Phase 5 / de-scatter prerequisite): the tenant extension
// then isolates one guest from another AND from the corporate portfolio, replacing the legacy
// personalOwnerId isolation. Two proofs, both flag ON: (1) the backfill moves an existing guest's
// sandbox out of the default tenant into a personal tenant; (2) a NEW guest registration provisions
// a personal tenant and pins the token to it. Flag toggled for this file only (serial run).
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let defaultTenantId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  __resetSettingsCache();
  await wipeDb();
  const { tenantId } = await backfillDefaultTenant(prisma);
  defaultTenantId = tenantId;
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE;
  else process.env.MULTITENANCY_ENFORCE = prevFlag;
  __resetSettingsCache();
});

describe('backfill: an existing guest sandbox moves into a personal tenant', () => {
  it('moves the guest membership + project + child risk out of the default tenant, leaving corporate untouched', async () => {
    // A guest who registered under the OLD flow: GUEST membership in the DEFAULT tenant, with a
    // personal project (+ child risk) stamped to the default tenant.
    const guest = await runAsSystem(() => prisma.user.create({ data: { name: 'Legacy Guest', email: 'legacy-guest@gt.test', role: 'GUEST', isActive: true } }));
    await runAsSystem(() => prisma.membership.create({ data: { userId: guest.id, tenantId: defaultTenantId, role: 'GUEST' } }));
    const gProject = await runWithTenant(defaultTenantId, () => prisma.project.create({ data: { code: 'PRJ-GT-0001', name: 'Guest sandbox', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', personalOwnerId: guest.id, pmUserId: guest.id } }));
    const gRisk = await runWithTenant(defaultTenantId, () => prisma.risk.create({ data: { projectId: gProject.id, code: 'R-GT-01', title: 'sandbox risk', probabilityScore: 3, impactScore: 3, riskScore: 9, severity: 'MEDIUM', probabilityPct: '0.5000', impactCostIdr: '1000000.00', emv: '500000.00' } }));

    // A corporate project in the default tenant that must NOT move (admin needs a default-tenant
    // membership — under enforcement requireAuth resolves the role from it).
    const cAdmin = await runAsSystem(() => prisma.user.create({ data: { name: 'Corp Admin', email: 'corp-admin@gt.test', role: 'ADMIN', isActive: true } }));
    await runAsSystem(() => prisma.membership.create({ data: { userId: cAdmin.id, tenantId: defaultTenantId, role: 'ADMIN' } }));
    const cProject = await runWithTenant(defaultTenantId, () => prisma.project.create({ data: { code: 'PRJ-GT-CORP', name: 'Corp project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: cAdmin.id } }));

    const res = await backfillGuestTenants(prisma);
    expect(res.guests).toBe(1);
    expect(res.movedProjects).toBe(1);

    // A personal tenant now exists and everything guest-owned points at it.
    const personal = await runAsSystem(() => prisma.tenant.findUnique({ where: { slug: `guest-${guest.id}` } }));
    expect(personal?.isPersonal).toBe(true);
    expect(personal!.id).not.toBe(defaultTenantId);

    const [mem, movedProject, movedRisk, corp] = await runAsSystem(() => Promise.all([
      prisma.membership.findFirst({ where: { userId: guest.id } }),
      prisma.project.findUnique({ where: { id: gProject.id } }),
      prisma.risk.findUnique({ where: { id: gRisk.id } }),
      prisma.project.findUnique({ where: { id: cProject.id } }),
    ]));
    expect(mem?.tenantId).toBe(personal!.id);      // membership moved
    expect(movedProject?.tenantId).toBe(personal!.id); // root moved
    expect(movedRisk?.tenantId).toBe(personal!.id);    // child followed its parent
    expect(corp?.tenantId).toBe(defaultTenantId);      // corporate untouched
  });

  it('is idempotent — a second run moves nothing', async () => {
    const again = await backfillGuestTenants(prisma);
    expect(again.movedProjects).toBe(0);
  });

  it('after backfill the guest (tid=personal) sees their project and the corporate admin (tid=default) does not', async () => {
    const guest = await runAsSystem(() => prisma.user.findUniqueOrThrow({ where: { email: 'legacy-guest@gt.test' } }));
    const admin = await runAsSystem(() => prisma.user.findUniqueOrThrow({ where: { email: 'corp-admin@gt.test' } }));
    const personal = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { slug: `guest-${guest.id}` } }));

    const guestToken = signAccessToken({ sub: guest.id, role: 'GUEST', email: guest.email, tv: 0, tid: personal.id });
    const adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email, tv: 0, tid: defaultTenantId });

    const guestList = await request(app).get(api('/projects')).set(bearer(guestToken));
    expect(guestList.status).toBe(200);
    const guestCodes = (guestList.body.projects ?? guestList.body ?? []).map((p: { code: string }) => p.code);
    expect(guestCodes).toContain('PRJ-GT-0001');

    const adminList = await request(app).get(api('/projects')).set(bearer(adminToken));
    const adminCodes = (adminList.body.projects ?? adminList.body ?? []).map((p: { code: string }) => p.code);
    expect(adminCodes).toContain('PRJ-GT-CORP');
    expect(adminCodes).not.toContain('PRJ-GT-0001'); // the guest sandbox is invisible to corporate
  });
});

describe('new guest registration provisions a personal tenant', () => {
  it('pins the token to a fresh isPersonal tenant (not the default), with a GUEST membership there', async () => {
    const res = await request(app).post(api('/auth/guest/register')).send({ name: 'Fresh Guest', email: 'fresh-guest@gt.test', password: 'Guest-Pass-1' });
    expect(res.status).toBe(201);
    const tid = verifyAccessToken(res.body.accessToken).tid;
    expect(tid).toBeTruthy();
    expect(tid).not.toBe(defaultTenantId);

    const user = await runAsSystem(() => prisma.user.findUniqueOrThrow({ where: { email: 'fresh-guest@gt.test' } }));
    const tenant = await runAsSystem(() => prisma.tenant.findUniqueOrThrow({ where: { id: tid! } }));
    expect(tenant.isPersonal).toBe(true);
    expect(tenant.slug).toBe(`guest-${user.id}`);

    const mem = await runAsSystem(() => prisma.membership.findMany({ where: { userId: user.id } }));
    expect(mem).toHaveLength(1);
    expect(mem[0].tenantId).toBe(tid);
    expect(mem[0].role).toBe('GUEST');
  });

  it('two fresh guests land in different tenants (isolated by the extension)', async () => {
    const a = await request(app).post(api('/auth/guest/register')).send({ name: 'Guest A', email: 'guest-a@gt.test', password: 'Guest-Pass-1' });
    const b = await request(app).post(api('/auth/guest/register')).send({ name: 'Guest B', email: 'guest-b@gt.test', password: 'Guest-Pass-1' });
    const tidA = verifyAccessToken(a.body.accessToken).tid;
    const tidB = verifyAccessToken(b.body.accessToken).tid;
    expect(tidA).toBeTruthy();
    expect(tidB).toBeTruthy();
    expect(tidA).not.toBe(tidB);
  });
});
