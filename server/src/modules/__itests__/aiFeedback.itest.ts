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

// Anett feedback (Fase 2): 👍/👎 capture + the deterministic learning loop — a 👎 with a note becomes
// a GUIDANCE memory (TENANT for org-writers, USER otherwise) that later prompts honor.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const answerPort: AiPort = {
  async draftJson() { return null; },
  async draftNarrative() { return null; },
  async runToolLoop() { return 'ok'; },
};
const systemPort: AiPort = {
  async draftJson() { return null; },
  async draftNarrative() { return null; },
  async runToolLoop({ system }) { return JSON.stringify({ system }); },
};

let prevFlag: string | undefined;
let prevKey: string | undefined;
let adminToken = '';
let pmToken = '';
let memTid = '';

const feedback = (token: string, body: object) => request(app).post(api('/assistant/feedback')).set(bearer(token)).send(body);
const enableMemory = (on: boolean) => prisma.tenant.update({ where: { id: memTid }, data: { aiMemoryEnabled: on } });
const askSystem = (token: string) => request(app).post(api('/assistant/ask')).set(bearer(token)).send({ messages: [{ role: 'user', content: 'x' }] });

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.MULTITENANCY_ENFORCE = 'true';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  __setAiPort(answerPort);

  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'fbco', name: 'Fb Co', aiNarrativeEnabled: true } });
  memTid = t.id;
  const admin = await prisma.user.create({ data: { name: 'adm', email: 'adm@fbco.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: admin.id, tenantId: memTid, role: 'ADMIN' } });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email, tv: 0, tid: memTid });
  const pm = await prisma.user.create({ data: { name: 'pm', email: 'pm@fbco.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: pm.id, tenantId: memTid, role: 'PROJECT_MANAGER' } });
  pmToken = signAccessToken({ sub: pm.id, role: 'PROJECT_MANAGER', email: pm.email, tv: 0, tid: memTid });
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

describe('Anett feedback — /assistant/feedback', () => {
  it('validates the body (bad rating / missing answer → 400)', async () => {
    expect((await feedback(pmToken, { rating: 'MEH', answer: 'a' })).status).toBe(400);
    expect((await feedback(pmToken, { rating: 'UP' })).status).toBe(400);
  });

  it('👍 records a rating and spawns no memory', async () => {
    const res = await feedback(pmToken, { rating: 'UP', answer: 'Jawaban bagus', question: 'apa kabar portofolio?' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), guidanceStored: false });
    const mem = await runWithTenant(memTid, () => prisma.aiMemory.count());
    expect(mem).toBe(0);
  });

  it('👎 with a note but memory OFF: recorded, but no guidance memory', async () => {
    await enableMemory(false);
    const res = await feedback(pmToken, { rating: 'DOWN', answer: 'Angka salah', note: 'Pakai BAC dari baseline terkunci, bukan draft' });
    expect(res.status).toBe(201);
    expect(res.body.guidanceStored).toBe(false);
    const mem = await runWithTenant(memTid, () => prisma.aiMemory.count());
    expect(mem).toBe(0);
  });

  it('👎 + note (memory ON, ADMIN) → TENANT GUIDANCE memory, linked + injected next turn', async () => {
    await enableMemory(true);
    const note = 'Selalu sebut nilai dalam juta Rupiah, bukan angka penuh';
    const res = await feedback(adminToken, { rating: 'DOWN', answer: 'Rp 1000000000', note });
    expect(res.status).toBe(201);
    expect(res.body.guidanceStored).toBe(true);

    const mem = await runWithTenant(memTid, () => prisma.aiMemory.findMany({ where: { kind: 'GUIDANCE' } }));
    expect(mem.length).toBe(1);
    expect(mem[0]).toMatchObject({ scope: 'TENANT', source: 'FEEDBACK', content: note });
    // The feedback row links back to the spawned memory.
    const fb = await runWithTenant(memTid, () => prisma.aiFeedback.findFirst({ where: { memoryId: mem[0].id } }));
    expect(fb).not.toBeNull();

    // TENANT guidance is visible to every user's prompt, framed as a correction to comply with.
    __setAiPort(systemPort);
    const ask = await askSystem(pmToken);
    __setAiPort(answerPort);
    const sys = (JSON.parse(ask.body.answer) as { system: string }).system;
    expect(sys).toContain('Koreksi dari feedback sebelumnya');
    expect(sys).toContain(note);
  });

  it('👎 + note (memory ON, non-admin PM) → USER-scoped guidance (personal only)', async () => {
    const note = 'Untuk saya, ringkas maksimal 3 poin';
    const res = await feedback(pmToken, { rating: 'DOWN', answer: 'Jawaban panjang', note });
    expect(res.body.guidanceStored).toBe(true);
    const mem = await runWithTenant(memTid, () => prisma.aiMemory.findFirst({ where: { content: note } }));
    expect(mem).toMatchObject({ scope: 'USER' });
    expect(mem!.userId).not.toBeNull();
  });
});
