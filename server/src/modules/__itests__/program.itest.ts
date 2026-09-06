import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Programs (Tier-3 portfolio hierarchy): ADMIN/PMO manage programs and project assignment; any member
// reads programs + the roll-up. These verify role gating, assignment round-trip, roll-up shape, and
// tenant isolation.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let adminA = '';
let pmA = '';
let adminB = '';
let projectId = '';
let tidA = '';
let tidB = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';

  await wipeDb();
  await backfillDefaultTenant(prisma);
  const a = await prisma.tenant.create({ data: { slug: 'pga', name: 'PG A' } });
  const b = await prisma.tenant.create({ data: { slug: 'pgb', name: 'PG B' } });
  tidA = a.id; tidB = b.id;

  const admin = await prisma.user.create({ data: { name: 'adm', email: 'adm@pga.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: admin.id, tenantId: tidA, role: 'ADMIN' } });
  adminA = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email, tv: 0, tid: tidA });

  const pm = await prisma.user.create({ data: { name: 'pm', email: 'pm@pga.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: pm.id, tenantId: tidA, role: 'PROJECT_MANAGER' } });
  pmA = signAccessToken({ sub: pm.id, role: 'PROJECT_MANAGER', email: pm.email, tv: 0, tid: tidA });

  const badmin = await prisma.user.create({ data: { name: 'admb', email: 'adm@pgb.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: badmin.id, tenantId: tidB, role: 'ADMIN' } });
  adminB = signAccessToken({ sub: badmin.id, role: 'ADMIN', email: badmin.email, tv: 0, tid: tidB });

  await runWithTenant(tidA, async () => {
    const p = await prisma.project.create({ data: { code: 'PG-1', name: 'PG Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id, tenantId: tidA } });
    projectId = p.id;
  });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('programs', () => {
  let programId = '';

  it('lets ADMIN create a program and blocks a non-manager', async () => {
    const ok = await request(app).post(api('/programs')).set(bearer(adminA)).send({ name: 'Digital Transformation', code: 'DX' });
    expect(ok.status).toBe(201);
    expect(ok.body.program.name).toBe('Digital Transformation');
    programId = ok.body.program.id;

    const denied = await request(app).post(api('/programs')).set(bearer(pmA)).send({ name: 'Nope' });
    expect(denied.status).toBe(403);
  });

  it('assigns and detaches a project, reflected in projectCount', async () => {
    const listed = await request(app).get(api('/programs')).set(bearer(pmA));
    expect(listed.status).toBe(200);
    expect(listed.body.programs.find((p: { id: string }) => p.id === programId)?.projectCount).toBe(0);

    const assign = await request(app).post(api(`/programs/${programId}/projects`)).set(bearer(adminA)).send({ projectId });
    expect(assign.status).toBe(204);

    const after = await request(app).get(api('/programs')).set(bearer(adminA));
    expect(after.body.programs.find((p: { id: string }) => p.id === programId)?.projectCount).toBe(1);

    const detach = await request(app).delete(api(`/programs/${programId}/projects/${projectId}`)).set(bearer(adminA));
    expect(detach.status).toBe(204);
    const after2 = await request(app).get(api('/programs')).set(bearer(adminA));
    expect(after2.body.programs.find((p: { id: string }) => p.id === programId)?.projectCount).toBe(0);
  });

  it('returns a roll-up entry for the program', async () => {
    await request(app).post(api(`/programs/${programId}/projects`)).set(bearer(adminA)).send({ projectId });
    const res = await request(app).get(api('/programs/rollup')).set(bearer(adminA));
    expect(res.status).toBe(200);
    const row = res.body.programs.find((p: { id: string }) => p.id === programId);
    expect(row).toBeTruthy();
    expect(row.projectCount).toBe(1);
    expect(row).toHaveProperty('spi');
    expect(row).toHaveProperty('cpi');
    expect(row).toHaveProperty('health');
  });

  it('isolates programs per tenant', async () => {
    const res = await request(app).get(api('/programs')).set(bearer(adminB));
    expect(res.status).toBe(200);
    expect(res.body.programs).toEqual([]);
  });
});
