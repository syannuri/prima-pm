import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Multi-select cleanup — bulk-delete (each id expanded to its subtree) + clear the whole schedule.
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
let ids: Record<string, string> = {};

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  await backfillDefaultTenant(prisma);

  const t = await prisma.tenant.create({ data: { slug: 'bulkco', name: 'Bulk Co' } });
  aico = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@bulk.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId: aico, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: aico });
  const viewer = await prisma.user.create({ data: { name: 'viewer', email: 'viewer@bulk.test', role: 'VIEWER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: viewer.id, tenantId: aico, role: 'VIEWER' } });
  viewerToken = signAccessToken({ sub: viewer.id, role: 'VIEWER', email: viewer.email, tv: 0, tid: aico });

  projectId = await runWithTenant(aico, async () => {
    const proj = await prisma.project.create({ data: { code: 'BULK-1', name: 'Bulk', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' }, select: { id: true } });
    return proj.id;
  });
});

// Rebuild the same task tree before each test (tests mutate it destructively).
beforeEach(async () => {
  await runWithTenant(aico, async () => {
    await prisma.taskDependency.deleteMany({ where: { predecessor: { projectId } } });
    await prisma.task.deleteMany({ where: { projectId } });
    const mk = (wbs: string, name: string, parentTaskId?: string) => prisma.task.create({
      data: { projectId, wbsCode: wbs, name, planStart: D0, planEnd: D1, parentTaskId: parentTaskId ?? null },
      select: { id: true },
    });
    const p1 = await mk('T-001', 'Phase 1');
    const t1 = await mk('T-002', 'Task 1', p1.id);
    const t2 = await mk('T-003', 'Task 2', p1.id);
    const p2 = await mk('T-004', 'Phase 2');
    const t3 = await mk('T-005', 'Task 3', p2.id);
    await prisma.taskDependency.create({ data: { predecessorId: t1.id, successorId: t2.id, type: 'FS', lagDays: 0 } });
    ids = { p1: p1.id, t1: t1.id, t2: t2.id, p2: p2.id, t3: t3.id };
  });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

const bulkUrl = () => api(`/projects/${projectId}/schedule/tasks/bulk-delete`);
const clearUrl = () => api(`/projects/${projectId}/schedule/clear`);
const count = () => runWithTenant(aico, () => prisma.task.count({ where: { projectId } }));
const depCount = () => runWithTenant(aico, () => prisma.taskDependency.count({ where: { predecessor: { projectId } } }));

describe('bulk-delete + clear', () => {
  it('deleting a phase removes its whole subtree and its dependencies', async () => {
    const res = await request(app).post(bulkUrl()).set(bearer(ownerToken)).send({ ids: [ids.p1] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(3); // Phase 1 + Task 1 + Task 2
    expect(await count()).toBe(2); // Phase 2 + Task 3 remain
    expect(await depCount()).toBe(0); // the T1→T2 link went with them
  });

  it('deletes multiple selected leaves (deduped) in one call', async () => {
    const res = await request(app).post(bulkUrl()).set(bearer(ownerToken)).send({ ids: [ids.t2, ids.t3, ids.t2] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);
    expect(await count()).toBe(3);
  });

  it('ignores ids that are not in the project (idempotent)', async () => {
    const res = await request(app).post(bulkUrl()).set(bearer(ownerToken)).send({ ids: ['00000000-0000-0000-0000-000000000000'] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
    expect(await count()).toBe(5);
  });

  it('clear removes every task in the schedule', async () => {
    const res = await request(app).post(clearUrl()).set(bearer(ownerToken)).send({});
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(5);
    expect(await count()).toBe(0);
  });

  it('400 on an empty id list', async () => {
    const res = await request(app).post(bulkUrl()).set(bearer(ownerToken)).send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it('403 for a non-writer (VIEWER) on bulk-delete and clear', async () => {
    expect((await request(app).post(bulkUrl()).set(bearer(viewerToken)).send({ ids: [ids.t1] })).status).toBe(403);
    expect((await request(app).post(clearUrl()).set(bearer(viewerToken)).send({})).status).toBe(403);
    expect(await count()).toBe(5);
  });
});
