import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { __setAiPort, type AiPort } from '../../lib/ai.js';

// Portfolio "one thing" attention digest. Detection is deterministic (no key); the ai-draft route
// uses an injected fake AiPort. enforce=false → ADMIN sees all projects.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let adminToken = '';
let prevKey: string | undefined;

beforeAll(async () => {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((x) => `"${x.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

  prevKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const admin = await prisma.user.create({ data: { name: 'PA Admin', email: 'pa-admin@corp.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email });

  // Troubled project: 2 overdue tasks + 1 HIGH risk.
  const bad = await prisma.project.create({ data: { code: 'PA-BAD', name: 'Troubled', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' } });
  const past = new Date(Date.now() - 5 * 24 * 3600 * 1000);
  await prisma.task.create({ data: { projectId: bad.id, wbsCode: '1', name: 'Late 1', planStart: past, planEnd: past, progressPct: 20 } });
  await prisma.task.create({ data: { projectId: bad.id, wbsCode: '2', name: 'Late 2', planStart: past, planEnd: past, progressPct: 0 } });
  await prisma.risk.create({ data: {
    projectId: bad.id, code: 'R1', title: 'Vendor slip', status: 'IDENTIFIED', kind: 'THREAT', severity: 'HIGH',
    probabilityScore: 4, impactScore: 4, riskScore: 16, probabilityPct: 0.7, impactCostIdr: 1000, emv: 700,
  } });

  // Healthy project: one future task, no risks.
  const ok = await prisma.project.create({ data: { code: 'PA-OK', name: 'Healthy', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' } });
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await prisma.task.create({ data: { projectId: ok.id, wbsCode: '1', name: 'Future', planStart: new Date(), planEnd: future, progressPct: 0 } });
});

afterAll(async () => {
  __setAiPort(null);
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

describe('attention digest — GET /portfolio/attention', () => {
  it('401 without auth', async () => {
    expect((await request(app).get(api('/portfolio/attention'))).status).toBe(401);
  });

  it('ranks the troubled project with reasons and drops the healthy one', async () => {
    const res = await request(app).get(api('/portfolio/attention')).set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.aiAvailable).toBe(false); // no key
    const codes = res.body.items.map((i: { code: string }) => i.code);
    expect(codes).toContain('PA-BAD');
    expect(codes).not.toContain('PA-OK');
    const bad = res.body.items.find((i: { code: string }) => i.code === 'PA-BAD');
    const kinds = bad.reasons.map((r: { kind: string }) => r.kind);
    expect(kinds).toContain('overdue');
    expect(kinds).toContain('risks');
  });
});

describe('AI focus narrative — POST /portfolio/attention/ai-draft', () => {
  it('503 without a key', async () => {
    const res = await request(app).post(api('/portfolio/attention/ai-draft')).set(bearer(adminToken)).send({});
    expect(res.status).toBe(503);
  });

  it('narrates the ranked digest with a fake AiPort', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    __setAiPort({
      async draftJson() { return { headline: 'Fokus ke PA-BAD.', focus: [{ code: 'PA-BAD', why: '2 tugas telat + risiko tinggi' }], summary: 'Prioritaskan pemulihan jadwal.' }; },
      async draftNarrative() { return null; },
    } as AiPort);
    const res = await request(app).post(api('/portfolio/attention/ai-draft')).set(bearer(adminToken)).send({});
    __setAiPort(null);
    delete process.env.ANTHROPIC_API_KEY;
    expect(res.status).toBe(200);
    expect(res.body.narrative.headline).toContain('PA-BAD');
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });
});
