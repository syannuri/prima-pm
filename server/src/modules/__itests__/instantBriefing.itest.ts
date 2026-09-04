import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant, runAsSystem } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setAiPort, type AiPort } from '../../lib/ai.js';
import { draftInstant, runInstantTriggerSweepIfDue } from '../report/proactive.service.js';

// Real-time trigger briefings (#6): a HIGH predictive signal drafts an instant AiBriefing immediately
// (period='instant', deduped per day). The predictive signal derives from heavy EVM data, so we drive
// draftInstant directly with a synthetic HIGH signal + a fake AiPort — the creation/dedupe/notification
// path is what's under test, not the (separately-tested) predictive maths.
const draft = { executiveSummary: 'ES', highlights: 'HI', lowlights: 'LO', nextFocus: 'NF' };
const fakePort: AiPort = { async draftJson() { return null; }, async draftNarrative() { return draft; } };
const highPred = { hasData: true, slip: { level: 'HIGH' as const, score: 60, drivers: [] }, overrun: { level: 'LOW' as const, score: 0, drivers: [] } };

let prevFlag: string | undefined; let prevKey: string | undefined; let prevInstant: string | undefined;
let tid = ''; let proj: { id: string; code: string; name: string; pmUserId: string | null; tenantId: string | null };

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE; process.env.MULTITENANCY_ENFORCE = 'true';
  prevKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-key';
  prevInstant = process.env.PROACTIVE_INSTANT;
  __setAiPort(fakePort);
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'inst', name: 'Inst', aiProactiveEnabled: true } }); tid = t.id;
  await runWithTenant(tid, async () => {
    const p = await prisma.project.create({ data: { code: 'IN-1', name: 'Instant Proj', status: 'IN_PROGRESS' }, select: { id: true, code: true, name: true, pmUserId: true, tenantId: true } });
    proj = p;
  });
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
  if (prevInstant === undefined) delete process.env.PROACTIVE_INSTANT; else process.env.PROACTIVE_INSTANT = prevInstant;
});

beforeEach(async () => {
  await runWithTenant(tid, () => prisma.aiBriefing.deleteMany({}));
});

describe('instant trigger briefings (#6)', () => {
  it('drafts an instant briefing for a HIGH signal', async () => {
    const now = new Date('2026-09-04T10:00:00Z');
    const made = await runWithTenant(tid, () => draftInstant(proj, '2026-09-04', now, highPred));
    expect(made).toBe(true);
    const b = await runWithTenant(tid, () => prisma.aiBriefing.findFirst({ where: { projectId: proj.id, period: 'instant' } }));
    expect(b?.status).toBe('PENDING');
    expect(b?.slipLevel).toBe('HIGH');
    expect(b?.execSummary).toBe('ES');
  });

  it('dedupes to one instant briefing per day', async () => {
    const now = new Date('2026-09-04T10:00:00Z');
    await runWithTenant(tid, () => draftInstant(proj, '2026-09-04', now, highPred));
    const second = await runWithTenant(tid, () => draftInstant(proj, '2026-09-04', now, highPred));
    expect(second).toBe(false);
    const count = await runWithTenant(tid, () => prisma.aiBriefing.count({ where: { projectId: proj.id, period: 'instant' } }));
    expect(count).toBe(1);
  });

  it('is a no-op when PROACTIVE_INSTANT is off', async () => {
    delete process.env.PROACTIVE_INSTANT;
    const r = await runInstantTriggerSweepIfDue(new Date());
    expect(r.drafted).toBe(0);
    const count = await runAsSystem(() => prisma.aiBriefing.count({ where: { period: 'instant' } }));
    expect(count).toBe(0);
  });
});
