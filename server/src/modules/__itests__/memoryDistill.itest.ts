import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setAiPort, type AiPort } from '../../lib/ai.js';
import { distillConversation } from '../assistant/memoryDistill.service.js';
import { listFeedbackInbox } from '../assistant/feedback.service.js';

// Fase 4: auto-distill turns a session transcript into durable AUTO memories (fake AiPort here); the
// admin inbox surfaces feedback for governance review. Gated by AI_MEMORY_AUTODISTILL + tenant opt-in.
let distilled = [{ kind: 'FACT', content: 'User prefers concise weekly status updates' }, { kind: 'PREFERENCE', content: 'User wants answers in Indonesian' }];
const fakePort: AiPort = {
  async draftJson() { return { memories: distilled }; },
  async draftNarrative() { return null; },
};

const turns = [
  { role: 'user' as const, content: 'Please keep future updates concise and weekly, and answer in Indonesian.' },
  { role: 'assistant' as const, content: 'Baik, saya akan ringkas dan mingguan.' },
];

let prevFlag: string | undefined; let prevDistill: string | undefined;
let tid = ''; const admin = { userId: 'u-admin', role: 'ADMIN' as const, name: 'Admin' };

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE; process.env.MULTITENANCY_ENFORCE = 'true';
  prevDistill = process.env.AI_MEMORY_AUTODISTILL; process.env.AI_MEMORY_AUTODISTILL = '1';
  __setAiPort(fakePort);
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'distill', name: 'Distill', aiMemoryEnabled: true } });
  tid = t.id;
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevDistill === undefined) delete process.env.AI_MEMORY_AUTODISTILL; else process.env.AI_MEMORY_AUTODISTILL = prevDistill;
});

beforeEach(async () => {
  await runWithTenant(tid, () => prisma.aiMemory.deleteMany({}));
  await runWithTenant(tid, () => prisma.aiFeedback.deleteMany({}));
  distilled = [{ kind: 'FACT', content: 'User prefers concise weekly status updates' }, { kind: 'PREFERENCE', content: 'User wants answers in Indonesian' }];
});

describe('distillConversation (#3 Fase 4)', () => {
  it('creates AUTO USER memories from a transcript when enabled', async () => {
    const r = await runWithTenant(tid, () => distillConversation(turns, admin));
    expect(r.created.length).toBe(2);
    const rows = await runWithTenant(tid, () => prisma.aiMemory.findMany({ where: { source: 'AUTO' } }));
    expect(rows.length).toBe(2);
    expect(rows.every((m) => m.scope === 'USER' && m.userId === admin.userId)).toBe(true);
  });

  it('is idempotent — a re-distill of the same session adds no duplicates', async () => {
    await runWithTenant(tid, () => distillConversation(turns, admin));
    const second = await runWithTenant(tid, () => distillConversation(turns, admin));
    expect(second.created.length).toBe(0);
    const count = await runWithTenant(tid, () => prisma.aiMemory.count({ where: { source: 'AUTO' } }));
    expect(count).toBe(2);
  });

  it('is a no-op when the auto-distill flag is off', async () => {
    process.env.AI_MEMORY_AUTODISTILL = '0';
    const r = await runWithTenant(tid, () => distillConversation(turns, admin));
    expect(r.created.length).toBe(0);
    process.env.AI_MEMORY_AUTODISTILL = '1';
  });
});

describe('listFeedbackInbox (#3 Fase 4)', () => {
  it('returns feedback (with resolved guidance) for a governance role, and blocks a viewer', async () => {
    await runWithTenant(tid, async () => {
      const mem = await prisma.aiMemory.create({ data: { scope: 'TENANT', kind: 'GUIDANCE', content: 'Always show SPI and CPI together', source: 'FEEDBACK' } });
      await prisma.aiFeedback.create({ data: { userId: 'u1', rating: 'DOWN', answer: 'ans', note: 'show both indices', memoryId: mem.id } });
      await prisma.aiFeedback.create({ data: { userId: 'u1', rating: 'UP', answer: 'good ans' } });
    });
    const all = await runWithTenant(tid, () => listFeedbackInbox(admin, {}));
    expect(all.length).toBe(2);
    const down = await runWithTenant(tid, () => listFeedbackInbox(admin, { rating: 'DOWN' }));
    expect(down.length).toBe(1);
    expect(down[0].guidance).toBe('Always show SPI and CPI together');
    await expect(runWithTenant(tid, () => listFeedbackInbox({ role: 'VIEWER' as const }, {}))).rejects.toThrow();
  });
});
