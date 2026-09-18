import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Bulk date-shift — move selected tasks (each expanded to its subtree) by ±N days + push-only heal.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const DAY = 86_400_000;
const D0 = new Date('2026-01-05T00:00:00.000Z'); // Monday
const D1 = new Date('2026-01-09T00:00:00.000Z'); // Friday

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

  const t = await prisma.tenant.create({ data: { slug: 'bulkshift', name: 'Bulk Shift Co' } });
  aico = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@bulkshift.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId: aico, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: aico });
  const viewer = await prisma.user.create({ data: { name: 'viewer', email: 'viewer@bulkshift.test', role: 'VIEWER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: viewer.id, tenantId: aico, role: 'VIEWER' } });
  viewerToken = signAccessToken({ sub: viewer.id, role: 'VIEWER', email: viewer.email, tv: 0, tid: aico });

  projectId = await runWithTenant(aico, async () => {
    const proj = await prisma.project.create({ data: { code: 'SHIFT-1', name: 'Shift', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' }, select: { id: true } });
    return proj.id;
  });
});

// Rebuild the tree before each test: Phase 1 → {Task 1, Task 2}, plus a standalone Task 3.
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
    const t3 = await mk('T-004', 'Task 3');
    ids = { p1: p1.id, t1: t1.id, t2: t2.id, t3: t3.id };
  });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

const url = () => api(`/projects/${projectId}/schedule/tasks/bulk-shift`);
const task = (id: string) => runWithTenant(aico, () => prisma.task.findUniqueOrThrow({ where: { id }, select: { planStart: true, planEnd: true } }));

describe('bulk date-shift', () => {
  it('shifts a leaf task forward by N days (start + end move together)', async () => {
    const res = await request(app).post(url()).set(bearer(ownerToken)).send({ ids: [ids.t3], days: 5 });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    const t3 = await task(ids.t3);
    expect(t3.planStart.getTime()).toBe(D0.getTime() + 5 * DAY);
    expect(t3.planEnd.getTime()).toBe(D1.getTime() + 5 * DAY);
  });

  it('shifting a phase moves its whole subtree (parent expands to leaves)', async () => {
    const res = await request(app).post(url()).set(bearer(ownerToken)).send({ ids: [ids.p1], days: 3 });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2); // Task 1 + Task 2 (the parent carries no real dates)
    const t1 = await task(ids.t1); const t2 = await task(ids.t2); const t3 = await task(ids.t3);
    expect(t1.planStart.getTime()).toBe(D0.getTime() + 3 * DAY);
    expect(t2.planStart.getTime()).toBe(D0.getTime() + 3 * DAY);
    expect(t3.planStart.getTime()).toBe(D0.getTime()); // untouched
  });

  it('shifts backward with a negative day count', async () => {
    const res = await request(app).post(url()).set(bearer(ownerToken)).send({ ids: [ids.t3], days: -2 });
    expect(res.status).toBe(200);
    expect((await task(ids.t3)).planStart.getTime()).toBe(D0.getTime() - 2 * DAY);
  });

  it('push-only auto-schedule heals a dependency the shift breaks', async () => {
    await runWithTenant(aico, () => prisma.taskDependency.create({ data: { predecessorId: ids.t1, successorId: ids.t2, type: 'FS', lagDays: 0 } }));
    // Move only the predecessor far forward; the FS successor must be pushed past it.
    const res = await request(app).post(url()).set(bearer(ownerToken)).send({ ids: [ids.t1], days: 20 });
    expect(res.status).toBe(200);
    expect(res.body.moved).toBeGreaterThanOrEqual(1); // push-only auto-schedule healed at least the successor
    const t2 = await task(ids.t2);
    expect(t2.planStart.getTime()).toBeGreaterThan(D0.getTime()); // successor was pushed off its original start
  });

  it('silently skips ids not in the project', async () => {
    const res = await request(app).post(url()).set(bearer(ownerToken)).send({ ids: ['00000000-0000-0000-0000-000000000000'], days: 5 });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
  });

  it('400 on a zero-day shift', async () => {
    const res = await request(app).post(url()).set(bearer(ownerToken)).send({ ids: [ids.t3], days: 0 });
    expect(res.status).toBe(400);
  });

  it('403 for a non-writer (VIEWER)', async () => {
    const res = await request(app).post(url()).set(bearer(viewerToken)).send({ ids: [ids.t3], days: 5 });
    expect(res.status).toBe(403);
  });
});
