import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Undo / redo for the WBS bulk-cleanup ops. A bulk delete snapshots what it removed (tasks + deps +
// steps + …) so Undo recreates it, and stores the id set so Redo re-deletes it. The stack is
// fingerprint-guarded — any other edit makes Undo go stale (409 + cleared).
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const D0 = new Date('2026-01-05');
const D1 = new Date('2026-01-10');

let prevFlag: string | undefined;
let ownerToken = '';
let aico = '';
let projectId = '';
let ids: Record<string, string> = {};

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'undoco', name: 'Undo Co' } });
  aico = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@undo.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId: aico, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: aico });
  projectId = await runWithTenant(aico, async () => (await prisma.project.create({ data: { code: 'UNDO-1', name: 'Undo', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' }, select: { id: true } })).id);
});

// Rebuild the tree before each test: P1 → (T1, T2), P2; a T1→T2 dependency; a step on T1.
beforeEach(async () => {
  await runWithTenant(aico, async () => {
    await prisma.scheduleUndo.deleteMany({ where: { projectId } });
    await prisma.taskDependency.deleteMany({ where: { predecessor: { projectId } } });
    await prisma.task.deleteMany({ where: { projectId } });
    const mk = (wbs: string, name: string, parentTaskId?: string) => prisma.task.create({ data: { projectId, wbsCode: wbs, name, planStart: D0, planEnd: D1, parentTaskId: parentTaskId ?? null }, select: { id: true } });
    const p1 = await mk('T-001', 'Phase 1');
    const t1 = await mk('T-002', 'Task 1', p1.id);
    const t2 = await mk('T-003', 'Task 2', p1.id);
    const p2 = await mk('T-004', 'Phase 2');
    await prisma.taskDependency.create({ data: { predecessorId: t1.id, successorId: t2.id, type: 'FS', lagDays: 0 } });
    await prisma.taskStep.create({ data: { taskId: t1.id, name: 'Step A', weight: 1, done: true, sortOrder: 0 } });
    ids = { p1: p1.id, t1: t1.id, t2: t2.id, p2: p2.id };
  });
});

afterAll(async () => { if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag; });

const url = (p: string) => api(`/projects/${projectId}/schedule${p}`);
const post = (p: string, body: object = {}) => request(app).post(url(p)).set(bearer(ownerToken)).send(body);
const get = (p: string) => request(app).get(url(p)).set(bearer(ownerToken));
const counts = () => runWithTenant(aico, () => Promise.all([
  prisma.task.count({ where: { projectId } }),
  prisma.taskDependency.count({ where: { predecessor: { projectId } } }),
  prisma.taskStep.count({ where: { task: { projectId } } }),
]));

describe('schedule undo / redo', () => {
  it('undo recreates the deleted subtree (tasks + dependency + steps); redo re-deletes it', async () => {
    const del = await post('/tasks/bulk-delete', { ids: [ids.p1] });
    expect(del.body.deleted).toBe(3); // P1 + T1 + T2
    expect(del.body.undo.canUndo).toBe(true);
    expect(await counts()).toEqual([1, 0, 0]); // only P2 left (+ the dep + step gone with T1/T2)

    const u = await post('/undo');
    expect(u.status).toBe(200);
    expect(u.body.undo.canUndo).toBe(false);
    expect(u.body.undo.canRedo).toBe(true);
    expect(await counts()).toEqual([4, 1, 1]); // fully restored: 4 tasks, the FS link, the step

    const r = await post('/redo');
    expect(r.status).toBe(200);
    expect(r.body.undo.canRedo).toBe(false);
    expect(r.body.undo.canUndo).toBe(true);
    expect(await counts()).toEqual([1, 0, 0]);
  });

  it('clear then undo restores the whole schedule', async () => {
    expect((await post('/clear')).body.deleted).toBe(4);
    expect((await counts())[0]).toBe(0);
    await post('/undo');
    expect(await counts()).toEqual([4, 1, 1]);
  });

  it('undo goes stale (409) and clears the stack when the schedule is edited another way', async () => {
    await post('/tasks/bulk-delete', { ids: [ids.t2] });
    // An unrelated edit changes the schedule fingerprint.
    await runWithTenant(aico, () => prisma.task.create({ data: { projectId, wbsCode: 'T-099', name: 'New', planStart: D0, planEnd: D1 } }));
    expect((await get('/undo-state')).body.canUndo).toBe(false); // no longer offered
    const u = await post('/undo');
    expect(u.status).toBe(409);
  });

  it('undo-state reports nothing on a fresh project', async () => {
    const res = await get('/undo-state');
    expect(res.body).toMatchObject({ canUndo: false, canRedo: false });
  });
});
