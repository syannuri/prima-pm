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

// Anett cross-session memory (Fase 1): the per-tenant opt-in gate, the remember/forget tools, prompt
// injection, USER-vs-TENANT scoping + governance, and the Settings CRUD routes.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const answerPort: AiPort = {
  async draftJson() { return null; },
  async draftNarrative() { return null; },
  async runToolLoop() { return 'ok'; },
};

// A port that runs a caller-supplied script against the real executeTool and returns JSON in `answer`.
const scriptPort = (script: (executeTool: (n: string, i: unknown) => Promise<string>, system: string) => Promise<unknown>): AiPort => ({
  async draftJson() { return null; },
  async draftNarrative() { return null; },
  async runToolLoop({ executeTool, system }) { return JSON.stringify(await script(executeTool, system)); },
});

let prevFlag: string | undefined;
let prevKey: string | undefined;
let adminToken = '';
let pmToken = '';
let memTid = '';

const ask = (token: string) => request(app).post(api('/assistant/ask')).set(bearer(token)).send({ messages: [{ role: 'user', content: 'x' }] });
const enableMemory = (on: boolean) => prisma.tenant.update({ where: { id: memTid }, data: { aiMemoryEnabled: on } });

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.MULTITENANCY_ENFORCE = 'true';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  __setAiPort(answerPort);

  await wipeDb();
  await backfillDefaultTenant(prisma);

  // Narrative on (so /ask passes the base gate); memory OFF initially (dormant-by-default assertion).
  const t = await prisma.tenant.create({ data: { slug: 'memco', name: 'Mem Co', aiNarrativeEnabled: true } });
  memTid = t.id;
  const admin = await prisma.user.create({ data: { name: 'adm', email: 'adm@memco.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: admin.id, tenantId: memTid, role: 'ADMIN' } });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email, tv: 0, tid: memTid });
  const pm = await prisma.user.create({ data: { name: 'pm', email: 'pm@memco.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: pm.id, tenantId: memTid, role: 'PROJECT_MANAGER' } });
  pmToken = signAccessToken({ sub: pm.id, role: 'PROJECT_MANAGER', email: pm.email, tv: 0, tid: memTid });
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

describe('Anett cross-session memory — /assistant memory', () => {
  it('DORMANT: with the tenant flag off, no memory tools/injection and remember is refused', async () => {
    __setAiPort(scriptPort(async (executeTool, system) => ({
      system,
      remember: await executeTool('remember', { content: 'Pengguna suka ringkas', scope: 'user' }),
    })));
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    expect(res.status).toBe(200);
    const out = JSON.parse(res.body.answer) as { system: string; remember: string };
    expect(out.system).not.toContain('memori jangka panjang');
    expect(out.remember).toContain('tidak aktif');
    expect(res.body.memories).toEqual([]);
    const count = await runWithTenant(memTid, () => prisma.aiMemory.count());
    expect(count).toBe(0);
  });

  it('REMEMBER: once opted in, the remember tool stores a USER memory + surfaces it to the client', async () => {
    await enableMemory(true);
    __setAiPort(scriptPort(async (executeTool) => ({
      remember: await executeTool('remember', { content: 'Pengguna lebih suka jawaban ringkas', scope: 'user', kind: 'preference' }),
    })));
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    expect(res.status).toBe(200);
    expect(res.body.memories).toEqual([{ scope: 'USER', content: 'Pengguna lebih suka jawaban ringkas' }]);
    const rows = await runWithTenant(memTid, () => prisma.aiMemory.findMany());
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ scope: 'USER', kind: 'PREFERENCE', source: 'EXPLICIT', active: true });
  });

  it('INJECT: an existing memory is injected into the next prompt', async () => {
    __setAiPort(scriptPort(async (_e, system) => ({ system })));
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    const out = JSON.parse(res.body.answer) as { system: string };
    expect(out.system).toContain('Yang Anda ingat');
    expect(out.system).toContain('Pengguna lebih suka jawaban ringkas');
    expect(out.system).toContain('memori jangka panjang'); // the capability note
  });

  it('SCOPE/GOVERNANCE: a PM cannot write a TENANT memory; an ADMIN can', async () => {
    __setAiPort(scriptPort(async (executeTool) => ({ pm: await executeTool('remember', { content: 'Istilah PRIMA = platform PM', scope: 'tenant', kind: 'glossary' }) })));
    const pmRes = await ask(pmToken);
    __setAiPort(scriptPort(async (executeTool) => ({ admin: await executeTool('remember', { content: 'Istilah PRIMA = platform PM', scope: 'tenant', kind: 'glossary' }) })));
    const adminRes = await ask(adminToken);
    __setAiPort(answerPort);
    expect(JSON.parse(pmRes.body.answer).pm).toContain('admin/PMO');
    expect(JSON.parse(adminRes.body.answer).admin).toContain('"ok":true');
    expect(adminRes.body.memories).toEqual([{ scope: 'TENANT', content: 'Istilah PRIMA = platform PM' }]);
  });

  it('FORGET: the forget tool soft-deletes a matching memory', async () => {
    __setAiPort(scriptPort(async (executeTool) => ({ forget: await executeTool('forget', { query: 'ringkas' }) })));
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    expect(JSON.parse(res.body.answer).forget).toContain('"ok":true');
    const active = await runWithTenant(memTid, () => prisma.aiMemory.findMany({ where: { active: true } }));
    // Only the TENANT glossary memory remains active; the USER preference was forgotten.
    expect(active.map((m) => m.scope)).toEqual(['TENANT']);
  });

  it('CRUD: create/list/pin/delete via /assistant/memory, scoped per user', async () => {
    // PM creates a personal memory via the API.
    const created = await request(app).post(api('/assistant/memory')).set(bearer(pmToken)).send({ content: 'Fokus proyek data center', scope: 'USER', kind: 'FACT' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // PM sees own USER memory + the shared TENANT one; ADMIN does NOT see the PM's USER memory.
    const pmList = await request(app).get(api('/assistant/memory')).set(bearer(pmToken));
    const adminList = await request(app).get(api('/assistant/memory')).set(bearer(adminToken));
    expect(pmList.body.memories.map((m: { content: string }) => m.content)).toContain('Fokus proyek data center');
    expect(adminList.body.memories.map((m: { content: string }) => m.content)).not.toContain('Fokus proyek data center');
    expect(adminList.body.memories.map((m: { content: string }) => m.content)).toContain('Istilah PRIMA = platform PM');

    // Pin, then delete.
    const pinned = await request(app).patch(api(`/assistant/memory/${id}`)).set(bearer(pmToken)).send({ pinned: true });
    expect(pinned.status).toBe(200);
    expect(pinned.body.pinned).toBe(true);
    const del = await request(app).delete(api(`/assistant/memory/${id}`)).set(bearer(pmToken));
    expect(del.status).toBe(204);
    const after = await request(app).get(api('/assistant/memory')).set(bearer(pmToken));
    expect(after.body.memories.map((m: { content: string }) => m.content)).not.toContain('Fokus proyek data center');

    // A PM cannot delete a TENANT memory (governance).
    const tenantMem = await runWithTenant(memTid, () => prisma.aiMemory.findFirst({ where: { scope: 'TENANT', active: true } }));
    const forbidden = await request(app).delete(api(`/assistant/memory/${tenantMem!.id}`)).set(bearer(pmToken));
    expect(forbidden.status).toBe(403);
  });

  it('AI-SETTINGS: memoryEnabled round-trips (ADMIN only)', async () => {
    const get = await request(app).get(api('/ai-settings')).set(bearer(adminToken));
    expect(get.status).toBe(200);
    expect(get.body).toHaveProperty('memoryEnabled', true);
    const patch = await request(app).patch(api('/ai-settings')).set(bearer(adminToken)).send({ memoryEnabled: false });
    expect(patch.body.memoryEnabled).toBe(false);
    await enableMemory(true); // restore
  });
});
