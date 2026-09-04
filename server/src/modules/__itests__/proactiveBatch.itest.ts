import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant, runAsSystem } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setAiPort, type AiPort } from '../../lib/ai.js';
import { finalizeDueBatches } from '../report/proactive.service.js';

// Proactive-batch finalise (#Batch): a completed Message Batch's results become AiBriefings, mapped
// back per project via the AiBatch.mapping. Tests the two-phase second half with a fake port — the
// heavy report/predictive pipeline (submit phase) is exercised in prod, not here.
const draft = { executiveSummary: 'ES', highlights: 'HI', lowlights: 'LO', nextFocus: 'NF' };
let ended = true;

const fakePort: AiPort = {
  async draftJson() { return null; },
  async draftNarrative() { return null; },
  async pollBatch() {
    if (!ended) return { ended: false };
    return { ended: true, results: [{ customId: PID, json: draft, usage: { input_tokens: 100, output_tokens: 50 } }] };
  },
};

let prevFlag: string | undefined; let prevKey: string | undefined;
let tid = ''; let PID = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE; process.env.MULTITENANCY_ENFORCE = 'true';
  prevKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-key'; // aiEnabled()
  __setAiPort(fakePort);
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'pbatch', name: 'PBatch', aiProactiveEnabled: true } }); tid = t.id;
  await runWithTenant(tid, async () => {
    const p = await prisma.project.create({ data: { code: 'PB-1', name: 'Batch Proj', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' }, select: { id: true } });
    PID = p.id;
  });
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

const seedBatch = () => runAsSystem(() => prisma.aiBatch.create({ data: {
  batchId: `batch_${Math.random().toString(36).slice(2)}`, feature: 'proactive', status: 'PENDING',
  mapping: { [PID]: { tenantId: tid, code: 'PB-1', name: 'Batch Proj', pmUserId: null, period: 'weekly', periodKey: '2026-W36', model: 'claude-haiku-4-5', slipLevel: null, slipScore: null, overrunLevel: null, overrunScore: null, generatedAt: new Date().toISOString() } },
} }));

beforeEach(async () => {
  await runAsSystem(() => prisma.aiBriefing.deleteMany({}));
  await runAsSystem(() => prisma.aiBatch.deleteMany({}));
  ended = true;
});

describe('finalizeDueBatches (#Batch)', () => {
  it('turns a finished batch into an AiBriefing and marks the batch DONE', async () => {
    await seedBatch();
    const r = await finalizeDueBatches(new Date());
    expect(r.drafted).toBe(1);
    const b = await runAsSystem(() => prisma.aiBriefing.findFirst({ where: { projectId: PID } }));
    expect(b?.execSummary).toBe('ES');
    expect(b?.nextFocus).toBe('NF');
    expect(b?.status).toBe('PENDING');
    const batch = await runAsSystem(() => prisma.aiBatch.findFirst({}));
    expect(batch?.status).toBe('DONE');
    expect(batch?.resolvedAt).not.toBeNull();
  });

  it('leaves the batch PENDING and drafts nothing while still processing', async () => {
    ended = false;
    await seedBatch();
    const r = await finalizeDueBatches(new Date());
    expect(r.drafted).toBe(0);
    const batch = await runAsSystem(() => prisma.aiBatch.findFirst({}));
    expect(batch?.status).toBe('PENDING');
  });

  it('is idempotent — a re-finalise does not duplicate the briefing', async () => {
    await seedBatch();
    await finalizeDueBatches(new Date());
    // Simulate another PENDING batch for the same project/period (e.g. an overlapping submit).
    await seedBatch();
    const r = await finalizeDueBatches(new Date());
    expect(r.drafted).toBe(0); // existing briefing guard prevents a duplicate
    const count = await runAsSystem(() => prisma.aiBriefing.count({ where: { projectId: PID } }));
    expect(count).toBe(1);
  });
});
