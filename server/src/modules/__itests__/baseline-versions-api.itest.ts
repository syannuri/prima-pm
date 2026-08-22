import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { applyBaselineLock } from '../projects/baseline.service.js';

// Fase 2 — read API for baseline revision history. GET list (summary) + GET :version (full snapshot),
// both any-project-member reads (requireProjectAccess). Enforcement off (default test config).
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let adminToken = '';
let strangerPmToken = '';
let projectId = '';

beforeAll(async () => {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

  const admin = await prisma.user.create({ data: { name: 'BVA Admin', email: 'bva-admin@t.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  const pm = await prisma.user.create({ data: { name: 'BVA PM', email: 'bva-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  const stranger = await prisma.user.create({ data: { name: 'BVA Other', email: 'bva-other@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email });
  strangerPmToken = signAccessToken({ sub: stranger.id, role: 'PROJECT_MANAGER', email: stranger.email });

  const p = await prisma.project.create({
    data: { code: 'PRJ-BVA-0001', name: 'BVA', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id },
  });
  projectId = p.id;
  const d = (n: number) => new Date(2026, 5, n);
  await prisma.task.create({ data: { projectId: p.id, wbsCode: '1', name: 'Phase A', planStart: d(1), planEnd: d(11), baselineStart: d(1), baselineFinish: d(11), baselineWeight: 100 } });
  await prisma.costBaseline.create({ data: { projectId: p.id, directTotal: 800, indirectTotal: 200, costBaseline: 1000, budgetAtCompletion: 1200, managementReserve: 200 } });

  // Two revisions: v1, then unlock → change → re-lock → v2.
  await applyBaselineLock(p.id, 'Initial', admin.id);
  await applyBaselineLock(p.id, 'reopen', admin.id, false);
  await prisma.costBaseline.update({ where: { projectId: p.id }, data: { costBaseline: 1500, budgetAtCompletion: 1800 } });
  await applyBaselineLock(p.id, 'Scope change', admin.id);
});

describe('baseline versions read API (Fase 2)', () => {
  it('GET /baseline/versions lists revisions newest-first with cost summary + committer name', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/baseline/versions`)).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.versions).toHaveLength(2);
    expect(res.body.versions.map((v: any) => v.version)).toEqual([2, 1]); // newest first
    const v2 = res.body.versions[0];
    expect(v2.reason).toBe('Scope change');
    expect(Number(v2.budgetAtCompletion)).toBe(1800);
    expect(v2.committedByName).toBe('BVA Admin');
    // The list is a summary — it must NOT ship the full per-task schedule.
    expect(v2.schedule).toBeUndefined();
  });

  it('GET /baseline/versions/:version returns the full schedule + cost snapshot', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/baseline/versions/1`)).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.version.version).toBe(1);
    expect(Number(res.body.version.cost.costBaseline)).toBe(1000); // v1 preserved (not the re-baselined 1500)
    expect(res.body.version.schedule).toHaveLength(1);
    expect(res.body.version.schedule[0].wbsCode).toBe('1');
    expect(res.body.version.schedule[0].weight).toBe(100);
  });

  it('404 for a version that does not exist', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/baseline/versions/99`)).set(auth(adminToken));
    expect(res.status).toBe(404);
  });

  it('400 for a non-numeric version', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/baseline/versions/abc`)).set(auth(adminToken));
    expect(res.status).toBe(400);
  });

  it('401 without a token', async () => {
    expect((await request(app).get(api(`/projects/${projectId}/baseline/versions`))).status).toBe(401);
  });

  it('403 for a PM who does not own the project (requireProjectAccess)', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/baseline/versions`)).set(auth(strangerPmToken));
    expect(res.status).toBe(403);
  });
});
