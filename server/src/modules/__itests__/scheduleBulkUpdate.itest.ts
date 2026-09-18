import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Bulk-edit selected tasks — set % complete and/or assign the lead owner, one call.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const D0 = new Date('2026-01-05');
const D1 = new Date('2026-01-10');

let prevFlag: string | undefined;
let ownerToken = '';
let viewerToken = '';
let aico = '';
let projectId = '';
let resourceId = '';
let ids: Record<string, string> = {};

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  await backfillDefaultTenant(prisma);

  const t = await prisma.tenant.create({ data: { slug: 'bulkupd', name: 'Bulk Update Co' } });
  aico = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@bulkupd.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId: aico, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: aico });
  const viewer = await prisma.user.create({ data: { name: 'viewer', email: 'viewer@bulkupd.test', role: 'VIEWER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: viewer.id, tenantId: aico, role: 'VIEWER' } });
  viewerToken = signAccessToken({ sub: viewer.id, role: 'VIEWER', email: viewer.email, tv: 0, tid: aico });

  ({ projectId, resourceId } = await runWithTenant(aico, async () => {
    const proj = await prisma.project.create({ data: { code: 'BULKU-1', name: 'Bulk Update', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' }, select: { id: true } });
    const res = await prisma.resource.create({ data: { name: 'Alice' }, select: { id: true } });
    return { projectId: proj.id, resourceId: res.id };
  }));
});

// Rebuild the same task tree before each test (tests mutate it).
beforeEach(async () => {
  await runWithTenant(aico, async () => {
    await prisma.taskOwner.deleteMany({ where: { task: { projectId } } });
    await prisma.task.deleteMany({ where: { projectId } });
    const mk = (wbs: string, name: string) => prisma.task.create({
      data: { projectId, wbsCode: wbs, name, planStart: D0, planEnd: D1, progressPct: 0 },
      select: { id: true },
    });
    const t1 = await mk('T-001', 'Task 1');
    const t2 = await mk('T-002', 'Task 2');
    const t3 = await mk('T-003', 'Task 3');
    ids = { t1: t1.id, t2: t2.id, t3: t3.id };
  });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

const url = () => api(`/projects/${projectId}/schedule/tasks/bulk-update`);
const tasks = () => runWithTenant(aico, () => prisma.task.findMany({ where: { projectId }, orderBy: { wbsCode: 'asc' }, select: { id: true, progressPct: true, actualStart: true, actualFinish: true, picResourceId: true } }));
const owners = (taskId: string) => runWithTenant(aico, () => prisma.taskOwner.count({ where: { taskId } }));

describe('bulk-update tasks', () => {
  it('sets % complete on selected tasks and stamps actualFinish at 100%', async () => {
    const res = await request(app).post(url()).set(bearer(ownerToken)).send({ ids: [ids.t1, ids.t2], progressPct: 100 });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    const rows = await tasks();
    const t1 = rows.find((r) => r.id === ids.t1)!;
    const t3 = rows.find((r) => r.id === ids.t3)!;
    expect(t1.progressPct).toBe(100);
    expect(t1.actualStart).not.toBeNull();
    expect(t1.actualFinish).not.toBeNull();
    expect(t3.progressPct).toBe(0); // untouched
  });

  it('assigns the lead owner and folds it into the owner set', async () => {
    const res = await request(app).post(url()).set(bearer(ownerToken)).send({ ids: [ids.t1, ids.t2], picResourceId: resourceId });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    const rows = await tasks();
    expect(rows.find((r) => r.id === ids.t1)!.picResourceId).toBe(resourceId);
    expect(await owners(ids.t1)).toBe(1); // lead is always an owner
    expect(await owners(ids.t3)).toBe(0); // untouched
  });

  it('applies progress + owner together in one call', async () => {
    const res = await request(app).post(url()).set(bearer(ownerToken)).send({ ids: [ids.t3], progressPct: 50, picResourceId: resourceId });
    expect(res.status).toBe(200);
    const t3 = (await tasks()).find((r) => r.id === ids.t3)!;
    expect(t3.progressPct).toBe(50);
    expect(t3.actualStart).not.toBeNull();
    expect(t3.actualFinish).toBeNull(); // <100 → not finished
    expect(t3.picResourceId).toBe(resourceId);
  });

  it('silently skips ids not in the project', async () => {
    const res = await request(app).post(url()).set(bearer(ownerToken)).send({ ids: ['00000000-0000-0000-0000-000000000000'], progressPct: 100 });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
  });

  it('400 when no patch field is provided', async () => {
    const res = await request(app).post(url()).set(bearer(ownerToken)).send({ ids: [ids.t1] });
    expect(res.status).toBe(400);
  });

  it('404 for an unknown owner resource', async () => {
    const res = await request(app).post(url()).set(bearer(ownerToken)).send({ ids: [ids.t1], picResourceId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('403 for a non-writer (VIEWER)', async () => {
    const res = await request(app).post(url()).set(bearer(viewerToken)).send({ ids: [ids.t1], progressPct: 100 });
    expect(res.status).toBe(403);
  });
});
