import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setAiPort, type AiPort } from '../../lib/ai.js';

// #DeepReason (Phase 1 — deeper reasoning). Anett's Q&A tool loop is capped at maxSteps:6/maxTokens:1500
// by default; a hard, multi-tool investigation is otherwise cut short. When AI_DEEP_REASONING is on AND
// the turn looks hard, the budget + effort escalate for THAT turn only. These itests pin the escalation
// via a fake port that captures the exact runToolLoop budget: gate off = default budget always; gate on
// = hard turn escalates, a plain lookup does not.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

// Captures the last runToolLoop budget so a test can assert what Anett requested for the turn.
let captured: { maxSteps?: number; maxTokens?: number; effort?: string } | null = null;
const capturePort: AiPort = {
  async draftJson() { return null; },
  async draftNarrative() { return null; },
  async runToolLoop(input) {
    captured = { maxSteps: input.maxSteps, maxTokens: input.maxTokens, effort: input.effort };
    return 'Jawaban.';
  },
};

let prevFlag: string | undefined;
let prevKey: string | undefined;
let prevDeep: string | undefined;
let pmToken = '';
let aico = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevKey = process.env.ANTHROPIC_API_KEY;
  prevDeep = process.env.AI_DEEP_REASONING;
  process.env.MULTITENANCY_ENFORCE = 'true';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  __setAiPort(capturePort);

  await wipeDb();
  await backfillDefaultTenant(prisma);

  const t = await prisma.tenant.create({ data: { slug: 'deepco', name: 'Deep Co', aiNarrativeEnabled: true } });
  aico = t.id;
  const pm = await prisma.user.create({ data: { name: 'pm', email: 'pm@deepco.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: pm.id, tenantId: aico, role: 'PROJECT_MANAGER' } });
  pmToken = signAccessToken({ sub: pm.id, role: 'PROJECT_MANAGER', email: pm.email, tv: 0, tid: aico });

  await runWithTenant(aico, async () => {
    await prisma.project.create({ data: { code: 'DEEP-1', name: 'Deep Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id } });
  });
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
  if (prevDeep === undefined) delete process.env.AI_DEEP_REASONING; else process.env.AI_DEEP_REASONING = prevDeep;
});

beforeEach(() => { captured = null; });

const ask = (content: string) =>
  request(app).post(api('/assistant/ask')).set(bearer(pmToken)).send({ messages: [{ role: 'user', content }] });

describe('#DeepReason — deep-reasoning escalation', () => {
  it('gate OFF: a hard turn still uses the default budget', async () => {
    delete process.env.AI_DEEP_REASONING;
    const res = await ask('Why is DEEP-1 behind schedule — do a root-cause audit across cost and risk?');
    expect(res.status).toBe(200);
    expect(captured).toEqual({ maxSteps: 6, maxTokens: 1500, effort: undefined });
  });

  it('gate ON + hard turn: budget and effort escalate', async () => {
    process.env.AI_DEEP_REASONING = 'true';
    const res = await ask('Why is DEEP-1 behind schedule — do a root-cause audit across cost and risk?');
    expect(res.status).toBe(200);
    expect(captured?.maxSteps).toBe(12);
    expect(captured?.maxTokens).toBe(4000);
    expect(captured?.effort).toBe('high');
  });

  it('gate ON + plain lookup: stays on the default budget (no over-spend)', async () => {
    process.env.AI_DEEP_REASONING = 'true';
    const res = await ask('List my projects.');
    expect(res.status).toBe(200);
    expect(captured).toEqual({ maxSteps: 6, maxTokens: 1500, effort: undefined });
  });

  it('gate ON respects env-tuned ceilings (clamped)', async () => {
    process.env.AI_DEEP_REASONING = 'true';
    process.env.AI_DEEP_MAX_STEPS = '999'; // clamped to 20
    process.env.AI_DEEP_MAX_TOKENS = '100'; // clamped up to 1500 floor
    process.env.AI_DEEP_EFFORT = 'max';
    const res = await ask('Root-cause investigation across all projects, portfolio-wide.');
    delete process.env.AI_DEEP_MAX_STEPS;
    delete process.env.AI_DEEP_MAX_TOKENS;
    delete process.env.AI_DEEP_EFFORT;
    expect(res.status).toBe(200);
    expect(captured?.maxSteps).toBe(20);
    expect(captured?.maxTokens).toBe(1500);
    expect(captured?.effort).toBe('max');
  });
});
