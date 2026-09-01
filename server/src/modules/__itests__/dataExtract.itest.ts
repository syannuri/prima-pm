import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setAiPort, type AiPort } from '../../lib/ai.js';

// Stage A — extract-from-notes (Phase A). Generates a structured DRAFT via an injectable port (no
// network, no key). Exercises the two gates (env + per-tenant opt-in), write authorization, and the
// server-side grounding filter: progress updates for a task that ISN'T in the project are dropped.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

// The model "extracts" one real task (1.1) + one hallucinated task (ZZZ) + one issue. The server
// must drop ZZZ and resolve 1.1 to a real taskId.
const EXTRACTION = {
  progressUpdates: [
    { taskWbsCode: '1.1', taskName: 'Design', newPct: 60 },
    { taskWbsCode: 'ZZZ', taskName: 'Ghost task', newPct: 99 },
  ],
  issues: [
    { title: 'Vendor API down', description: 'Integrasi tertunda karena API vendor mati.', category: 'Teknis', impact: 'HIGH' },
  ],
};
const fakePort: AiPort = { async draftJson() { return EXTRACTION; }, async draftNarrative() { return null; } };

let prevFlag: string | undefined;
let prevKey: string | undefined;
let platformToken = '';
let ownerToken = '';   // ADMIN (write)
let viewerToken = '';  // VIEWER (no write)
let aico = '';
let projectId = '';
let realTaskId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.MULTITENANCY_ENFORCE = 'true';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  __setAiPort(fakePort);

  await wipeDb();
  const { tenantId: defaultTid } = await backfillDefaultTenant(prisma);

  const platform = await prisma.user.create({ data: { name: 'plat', email: 'plat@dx.test', role: 'ADMIN', isPlatformAdmin: true, passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: platform.id, tenantId: defaultTid, role: 'ADMIN' } });
  platformToken = signAccessToken({ sub: platform.id, role: 'ADMIN', email: platform.email, tv: 0, tid: defaultTid });

  const t = await prisma.tenant.create({ data: { slug: 'dxco', name: 'DX Co' } });
  aico = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@dxco.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId: aico, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: aico });
  const viewer = await prisma.user.create({ data: { name: 'viewer', email: 'viewer@dxco.test', role: 'VIEWER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: viewer.id, tenantId: aico, role: 'VIEWER' } });
  viewerToken = signAccessToken({ sub: viewer.id, role: 'VIEWER', email: viewer.email, tv: 0, tid: aico });

  const built = await runWithTenant(aico, async () => {
    const proj = await prisma.project.create({ data: { code: 'DX-1', name: 'DX Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' }, select: { id: true } });
    const task = await prisma.task.create({
      data: { projectId: proj.id, wbsCode: '1.1', name: 'Design', planStart: new Date('2026-01-01'), planEnd: new Date('2026-02-01'), progressPct: 20 },
      select: { id: true },
    });
    return { projectId: proj.id, taskId: task.id };
  });
  projectId = built.projectId;
  realTaskId = built.taskId;
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

const url = () => api(`/projects/${projectId}/data-extract/ai-draft`);
const post = (token: string, body: object = { text: 'Design sudah 60%. API vendor mati.' }) => request(app).post(url()).set(bearer(token)).send(body);

describe('AI data extract — data-extract/ai-draft', () => {
  it('503 when the global gate is off (ANTHROPIC_API_KEY unset)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post(ownerToken);
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_DISABLED');
  });

  it('403 when a non-writer (VIEWER) calls it', async () => {
    const res = await post(viewerToken);
    expect(res.status).toBe(403);
  });

  it('403 when the tenant has not opted in', async () => {
    const res = await post(ownerToken);
    expect(res.status).toBe(403);
  });

  it('400 on empty text', async () => {
    await request(app).patch(api(`/admin/tenants/${aico}`)).set(bearer(platformToken)).send({ aiNarrativeEnabled: true });
    const res = await post(ownerToken, { text: '' });
    expect(res.status).toBe(400);
  });

  it('200 resolves real tasks and DROPS hallucinated ones', async () => {
    const res = await post(ownerToken);
    expect(res.status).toBe(200);
    // Only the real task (1.1) survives; the ghost (ZZZ) is filtered out server-side.
    expect(res.body.progressUpdates).toHaveLength(1);
    expect(res.body.progressUpdates[0]).toMatchObject({ taskId: realTaskId, taskWbsCode: '1.1', currentPct: 20, newPct: 60 });
    expect(res.body.issues).toHaveLength(1);
    expect(res.body.issues[0].title).toBe('Vendor API down');
  });

  it('502 when the model declines / returns nothing', async () => {
    __setAiPort({ async draftJson() { return null; }, async draftNarrative() { return null; } });
    const res = await post(ownerToken);
    __setAiPort(fakePort);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });
});
