import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { assertAiBudget, budgetStatus } from '../../lib/aiBudget.js';

// AI token & cost accounting (improvement #1): the /ai-usage/summary dashboard is ADMIN-only,
// tenant-scoped, and derives $ from the per-model price table. These tests verify the roll-up math,
// tenant isolation, and role gating.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let adminToken = '';
let pmToken = '';
let tidA = '';
let tidB = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';

  await wipeDb();
  await backfillDefaultTenant(prisma);
  const a = await prisma.tenant.create({ data: { slug: 'usea', name: 'Usage A' } });
  const b = await prisma.tenant.create({ data: { slug: 'useb', name: 'Usage B' } });
  tidA = a.id; tidB = b.id;

  const admin = await prisma.user.create({ data: { name: 'adm', email: 'adm@usea.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: admin.id, tenantId: tidA, role: 'ADMIN' } });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email, tv: 0, tid: tidA });

  const pm = await prisma.user.create({ data: { name: 'pm', email: 'pm@usea.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: pm.id, tenantId: tidA, role: 'PROJECT_MANAGER' } });
  pmToken = signAccessToken({ sub: pm.id, role: 'PROJECT_MANAGER', email: pm.email, tv: 0, tid: tidA });

  // Tenant A: two opus calls (assistant_qa + cr_impact). Tenant B: one call that must NOT leak into A.
  await runWithTenant(tidA, async () => {
    await prisma.aiUsage.create({ data: { tenantId: tidA, feature: 'assistant_qa', model: 'claude-opus-4-8', inputTokens: 1_000_000, outputTokens: 200_000, cacheCreationTokens: 0, cacheReadTokens: 0 } });
    await prisma.aiUsage.create({ data: { tenantId: tidA, feature: 'cr_impact', model: 'claude-opus-4-8', inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 1_000_000 } });
  });
  await runWithTenant(tidB, async () => {
    await prisma.aiUsage.create({ data: { tenantId: tidB, feature: 'assistant_qa', model: 'claude-opus-4-8', inputTokens: 5_000_000, outputTokens: 5_000_000, cacheCreationTokens: 0, cacheReadTokens: 0 } });
  });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('/ai-usage/summary', () => {
  it('rolls up the active tenant only, with correct token totals and $ estimate', async () => {
    const res = await request(app).get(api('/ai-usage/summary?window=30d')).set(bearer(adminToken));
    expect(res.status).toBe(200);
    // Tenant A only: 2 calls. (Tenant B's big call must be excluded.)
    expect(res.body.totals.calls).toBe(2);
    expect(res.body.totals.inputTokens).toBe(1_000_000);
    expect(res.body.totals.outputTokens).toBe(200_000);
    expect(res.body.totals.cacheReadTokens).toBe(1_000_000);
    // Opus 4.8: input $5, output $25, cacheRead $0.5 per MTok.
    // = 1M*5 + 0.2M*25 + 1M*0.5 = 5 + 5 + 0.5 = 10.5 USD
    expect(res.body.totals.estimatedCostUsd).toBeCloseTo(10.5, 5);
    const features = res.body.byFeature.map((b: { key: string }) => b.key).sort();
    expect(features).toEqual(['assistant_qa', 'cr_impact']);
  });

  it('defaults to the calendar-month window', async () => {
    const res = await request(app).get(api('/ai-usage/summary')).set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.window).toBe('month');
  });

  it('is ADMIN-only (PM is forbidden)', async () => {
    const res = await request(app).get(api('/ai-usage/summary')).set(bearer(pmToken));
    expect(res.status).toBe(403);
  });
});

describe('AI budget cap (#4)', () => {
  // Tenant A has ~$10.50 of usage this month (1M input @ $5 + 0.2M output @ $25 + 1M cacheRead @ $0.5).
  let prevBudget: string | undefined;
  beforeAll(() => { prevBudget = process.env.AI_BUDGET_JSON; });
  afterAll(() => { if (prevBudget === undefined) delete process.env.AI_BUDGET_JSON; else process.env.AI_BUDGET_JSON = prevBudget; });

  it('is dormant (no throw, null status) when no caps configured', async () => {
    delete process.env.AI_BUDGET_JSON; delete process.env.AI_BUDGET_USD;
    await runWithTenant(tidA, async () => {
      await expect(assertAiBudget()).resolves.toBeUndefined();
      expect(await budgetStatus()).toBeNull();
    });
  });

  it('throws AI_BUDGET_EXCEEDED once over the plan cap, and reports status', async () => {
    process.env.AI_BUDGET_JSON = JSON.stringify({ TRIAL: 5 }); // tenant A (TRIAL) is at ~$10.5 > $5
    await runWithTenant(tidA, async () => {
      const status = await budgetStatus();
      expect(status?.capUsd).toBe(5);
      expect(status?.usedUsd).toBeCloseTo(10.5, 5);
      expect(status?.remainingUsd).toBe(0);
      await expect(assertAiBudget()).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
    });
  });

  it('allows calls under the cap', async () => {
    process.env.AI_BUDGET_JSON = JSON.stringify({ TRIAL: 100 }); // well above tenant A's ~$10.5
    await runWithTenant(tidA, async () => {
      await expect(assertAiBudget()).resolves.toBeUndefined();
    });
  });
});
