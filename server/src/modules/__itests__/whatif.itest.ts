import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';

// Deterministic what-if route: real DB load → pure engines → before/after. No AI, no key needed.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let adminToken = '', projectId = '', taskAId = '';

beforeAll(async () => {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((x) => `"${x.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

  const admin = await prisma.user.create({ data: { name: 'WI Admin', email: 'wi-admin@corp.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email });

  const project = await prisma.project.create({ data: { code: 'WI-1', name: 'What-if', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' } });
  projectId = project.id;
  const a = await prisma.task.create({ data: { projectId, wbsCode: '1', name: 'Task A', planStart: new Date('2026-03-02'), planEnd: new Date('2026-03-06'), progressPct: 0 } });
  const b = await prisma.task.create({ data: { projectId, wbsCode: '2', name: 'Task B', planStart: new Date('2026-03-09'), planEnd: new Date('2026-03-13'), progressPct: 0 } });
  taskAId = a.id;
  await prisma.taskDependency.create({ data: { predecessorId: a.id, successorId: b.id, type: 'FS', lagDays: 0 } });
});

const whatif = (body: unknown, token = adminToken) => request(app).post(api(`/projects/${projectId}/forecast/whatif`)).set(bearer(token)).send(body);

describe('what-if — POST /projects/:id/forecast/whatif', () => {
  it('401 without auth', async () => {
    expect((await request(app).post(api(`/projects/${projectId}/forecast/whatif`)).send({})).status).toBe(401);
  });

  it('shifting a predecessor pushes the project finish (real dependency propagation)', async () => {
    const res = await whatif({ taskChanges: [{ taskId: taskAId, shiftDays: 7 }] });
    expect(res.status).toBe(200);
    expect(res.body.deltas.finishDays).toBeGreaterThanOrEqual(5);
    expect(res.body.applied.taskChanges[0].name).toBe('Task A');
    expect(res.body.scenario.movedTaskCount).toBeGreaterThanOrEqual(1);
  });

  it('an empty spec yields zero deltas', async () => {
    const res = await whatif({});
    expect(res.status).toBe(200);
    expect(res.body.deltas.finishDays).toBe(0);
  });

  it('drops an unknown taskId', async () => {
    const res = await whatif({ taskChanges: [{ taskId: '00000000-0000-0000-0000-000000000000', shiftDays: 5 }] });
    expect(res.status).toBe(200);
    expect(res.body.applied.taskChanges).toHaveLength(0);
  });

  it('rejects out-of-bounds input (400)', async () => {
    expect((await whatif({ assumeSpi: 99 })).status).toBe(400);
    expect((await whatif({ taskChanges: [{ taskId: taskAId, durationScale: 50 }] })).status).toBe(400);
  });
});
