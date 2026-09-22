import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setAiPort, type AiPort } from '../../lib/ai.js';
import { enqueueFromDomainEvent, enqueueProactiveTrigger, runProactiveEventDrainIfDue } from '../report/proactiveEvents.service.js';

// Event-driven proactive Anett (Phase 2). A domain event / breach scan queues an AiProactiveTrigger; a
// debounced drain coalesces the pending triggers per project into ONE event-framed AiBriefing. Uses an
// injected AiPort (no key spend). Exercises: the realtime opt-in gate, discrete-event enqueue (HIGH risk
// / CR raised only), coalescing to one briefing per project/day, PM notification, and dedup.
const DRAFT = { executiveSummary: 'Triggered by a live event.', highlights: 'H', lowlights: 'L', nextFocus: 'N' };
let draftCalls = 0;
const fakePort: AiPort = {
  async draftJson() { return null; },
  async draftNarrative() { draftCalls++; return DRAFT; },
};

let prevFlag: string | undefined;
let prevKey: string | undefined;
let tenantId = '';
let pmId = '';
let projectId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.MULTITENANCY_ENFORCE = 'true';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  __setAiPort(fakePort);

  await wipeDb();
  await backfillDefaultTenant(prisma);

  // Opted into BOTH proactive and the realtime sub-opt-in.
  const t = await prisma.tenant.create({ data: { slug: 'evtco', name: 'Event Co', status: 'ACTIVE', aiNarrativeEnabled: true, aiProactiveEnabled: true, aiProactiveRealtime: true } });
  tenantId = t.id;
  const pm = await prisma.user.create({ data: { name: 'PM', email: 'pm@evtco.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  pmId = pm.id;
  await prisma.membership.create({ data: { userId: pm.id, tenantId, role: 'PROJECT_MANAGER' } });
  await runWithTenant(tenantId, async () => {
    const proj = await prisma.project.create({ data: { code: 'EVT-1', name: 'Event Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pmId }, select: { id: true } });
    projectId = proj.id;
    await prisma.task.createMany({ data: [
      { projectId, wbsCode: '1', name: 'A', planStart: new Date(Date.UTC(2026, 7, 1)), planEnd: new Date(Date.UTC(2026, 7, 15)) },
      { projectId, wbsCode: '2', name: 'B', planStart: new Date(Date.UTC(2026, 7, 16)), planEnd: new Date(Date.UTC(2026, 7, 31)) },
    ] });
  });
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

// Clean the queue + briefings + notifications between tests so each starts fresh (same day).
beforeEach(async () => {
  draftCalls = 0;
  await runWithTenant(tenantId, async () => {
    await prisma.aiProactiveTrigger.deleteMany({ where: { projectId } });
    await prisma.aiBriefing.deleteMany({ where: { projectId } });
    await prisma.notification.deleteMany({ where: { projectId } });
  });
});

const pendingCount = () => runWithTenant(tenantId, () => prisma.aiProactiveTrigger.count({ where: { projectId, processedAt: null } }));
const eventBriefings = () => runWithTenant(tenantId, () => prisma.aiBriefing.findMany({ where: { projectId, period: 'event' } }));

describe('Phase 2 — event-driven proactive', () => {
  it('a HIGH risk domain event enqueues a RISK_SPIKE trigger; a non-HIGH risk does not', async () => {
    await runWithTenant(tenantId, async () => {
      await enqueueFromDomainEvent('risk.created', { projectId, severity: 'HIGH', code: 'R-1', title: 'Vendor delay' });
      await enqueueFromDomainEvent('risk.created', { projectId, severity: 'MEDIUM', code: 'R-2', title: 'Minor' });
    });
    const rows = await runWithTenant(tenantId, () => prisma.aiProactiveTrigger.findMany({ where: { projectId } }));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('RISK_SPIKE');
  });

  it('a CRITICAL risk also enqueues (not just HIGH)', async () => {
    await runWithTenant(tenantId, () => enqueueFromDomainEvent('risk.created', { projectId, severity: 'CRITICAL', code: 'R-9', title: 'Data loss' }));
    expect(await pendingCount()).toBe(1);
  });

  it('a raised change request enqueues a CR_RAISED trigger', async () => {
    await runWithTenant(tenantId, () => enqueueFromDomainEvent('change_request.created', { projectId, title: 'Add module' }));
    expect(await pendingCount()).toBe(1);
  });

  it('does NOT enqueue when the tenant has not opted into realtime', async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { aiProactiveRealtime: false } });
    await runWithTenant(tenantId, () => enqueueFromDomainEvent('change_request.created', { projectId, title: 'X' }));
    await prisma.tenant.update({ where: { id: tenantId }, data: { aiProactiveRealtime: true } });
    expect(await pendingCount()).toBe(0);
  });

  it('the drain coalesces multiple triggers into ONE briefing, notifies the PM, and marks them processed', async () => {
    await runWithTenant(tenantId, async () => {
      await enqueueProactiveTrigger({ projectId, kind: 'RISK_SPIKE', summary: 'New HIGH risk R-1' });
      await enqueueProactiveTrigger({ projectId, kind: 'CR_RAISED', summary: 'CR raised — Add module' });
    });
    expect(await pendingCount()).toBe(2);

    const r = await runProactiveEventDrainIfDue(new Date());
    expect(r.drafted).toBe(1);
    expect(draftCalls).toBe(1); // ONE coalesced draft for both triggers
    const briefings = await eventBriefings();
    expect(briefings).toHaveLength(1);
    expect(briefings[0].status).toBe('PENDING');
    expect(await pendingCount()).toBe(0); // both triggers stamped processed

    const notif = await runWithTenant(tenantId, () => prisma.notification.findFirst({ where: { projectId, userId: pmId, type: 'AI_BRIEFING_READY' } }));
    expect(notif).not.toBeNull();
  });

  it('is idempotent: a second drain the same day drafts nothing more', async () => {
    await runWithTenant(tenantId, () => enqueueProactiveTrigger({ projectId, kind: 'CR_RAISED', summary: 'CR raised' }));
    const first = await runProactiveEventDrainIfDue(new Date());
    expect(first.drafted).toBe(1);
    // A repeat CR event the same day collapses onto the (now processed) row → no new pending trigger.
    await runWithTenant(tenantId, () => enqueueProactiveTrigger({ projectId, kind: 'CR_RAISED', summary: 'CR raised again' }));
    expect(await pendingCount()).toBe(0);
    const second = await runProactiveEventDrainIfDue(new Date());
    expect(second.drafted).toBe(0);
    expect((await eventBriefings())).toHaveLength(1);
  });
});
