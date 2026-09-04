import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setAiPort, type AiPort } from '../../lib/ai.js';
import { analyzeFeedback, adoptFeedbackSuggestion } from '../assistant/feedback.service.js';

// Feedback → auto prompt-improvement (#2): distill recurring 👎 into suggested GUIDANCE (fake AiPort),
// then adopt one into a durable TENANT GUIDANCE memory. Gated by AI_FEEDBACK_DISTILL + tenant opt-in.
let suggestions = [{ content: 'Always show SPI and CPI together with their interpretation' }];
const fakePort: AiPort = { async draftJson() { return { suggestions }; }, async draftNarrative() { return null; } };

let prevFlag: string | undefined; let prevDistill: string | undefined;
let tid = ''; const admin = { userId: 'u-admin', role: 'ADMIN' as const, name: 'Admin' };

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE; process.env.MULTITENANCY_ENFORCE = 'true';
  prevDistill = process.env.AI_FEEDBACK_DISTILL; process.env.AI_FEEDBACK_DISTILL = '1';
  __setAiPort(fakePort);
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'fbd', name: 'FBD', aiMemoryEnabled: true } }); tid = t.id;
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevDistill === undefined) delete process.env.AI_FEEDBACK_DISTILL; else process.env.AI_FEEDBACK_DISTILL = prevDistill;
});

const seedDowns = (n: number) => runWithTenant(tid, async () => {
  for (let i = 0; i < n; i++) {
    await prisma.aiFeedback.create({ data: { userId: 'u1', rating: 'DOWN', answer: `answer ${i}`, note: 'show both indices' } });
  }
});

beforeEach(async () => {
  await runWithTenant(tid, () => prisma.aiFeedback.deleteMany({}));
  await runWithTenant(tid, () => prisma.aiMemory.deleteMany({}));
  process.env.AI_FEEDBACK_DISTILL = '1';
  suggestions = [{ content: 'Always show SPI and CPI together with their interpretation' }];
});

describe('feedback distill (#2)', () => {
  it('distills recurring 👎 into suggestions for an admin', async () => {
    await seedDowns(4);
    const r = await runWithTenant(tid, () => analyzeFeedback(admin));
    expect(r.suggestions.length).toBe(1);
    expect(r.suggestions[0].content).toMatch(/SPI.*CPI/);
  });

  it('returns nothing below the min-downvote threshold', async () => {
    await seedDowns(2);
    const r = await runWithTenant(tid, () => analyzeFeedback(admin));
    expect(r.suggestions.length).toBe(0);
  });

  it('is a no-op when the distill flag is off', async () => {
    await seedDowns(4);
    process.env.AI_FEEDBACK_DISTILL = '0';
    const r = await runWithTenant(tid, () => analyzeFeedback(admin));
    expect(r.suggestions.length).toBe(0);
  });

  it('blocks a non-governance role', async () => {
    await seedDowns(4);
    await expect(runWithTenant(tid, () => analyzeFeedback({ role: 'VIEWER' as const }))).rejects.toThrow();
  });

  it('adopting a suggestion creates a TENANT GUIDANCE memory', async () => {
    const out = await runWithTenant(tid, () => adoptFeedbackSuggestion('Always cite the source tab', admin));
    expect(out.scope).toBe('TENANT');
    const mem = await runWithTenant(tid, () => prisma.aiMemory.findFirst({ where: { id: out.id } }));
    expect(mem?.kind).toBe('GUIDANCE');
    expect(mem?.source).toBe('FEEDBACK');
    expect(mem?.content).toBe('Always cite the source tab');
  });
});
