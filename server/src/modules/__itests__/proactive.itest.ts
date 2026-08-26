import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setAiPort, type AiPort } from '../../lib/ai.js';
import { runProactiveSweepIfDue } from '../report/proactive.service.js';

// Proactive AI sweep — auto-drafts a PENDING AiBriefing per active project in an opted-in tenant.
// Uses an injected AiPort (no network/key spend). Exercises the opt-in gate, the send window, draft
// creation + PM notification, and idempotency (no repeat spend within a period).
const DRAFT = { executiveSummary: 'On track overall.', highlights: 'Design complete.', lowlights: 'One task slipping.', nextFocus: 'Start build.' };
const fakePort: AiPort = {
  async draftJson() { return null; },
  async draftNarrative() { return DRAFT; },
};

// Monday 06:30 — matches the schedule we pin below via env, so isProactiveDue() is true.
const DUE = new Date(2026, 7, 24, 6, 30); // 2026-08-24 is a Monday
const NOT_DUE = new Date(2026, 7, 24, 7, 30); // same day, wrong hour

let prevFlag: string | undefined;
let prevKey: string | undefined;
let prevHour: string | undefined;
let prevWeekday: string | undefined;
let tenantId = '';
let pmId = '';
let projectId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevKey = process.env.ANTHROPIC_API_KEY;
  prevHour = process.env.PROACTIVE_HOUR;
  prevWeekday = process.env.PROACTIVE_WEEKDAY;
  process.env.MULTITENANCY_ENFORCE = 'true';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.PROACTIVE_HOUR = String(DUE.getHours());
  process.env.PROACTIVE_WEEKDAY = String(DUE.getDay());
  __setAiPort(fakePort);

  await wipeDb();
  await backfillDefaultTenant(prisma);

  const t = await prisma.tenant.create({ data: { slug: 'proco', name: 'Pro Co', status: 'ACTIVE' } }); // aiProactiveEnabled defaults false
  tenantId = t.id;
  const pm = await prisma.user.create({ data: { name: 'PM', email: 'pm@proco.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  pmId = pm.id;
  await prisma.membership.create({ data: { userId: pm.id, tenantId, role: 'PROJECT_MANAGER' } });

  await runWithTenant(tenantId, async () => {
    const proj = await prisma.project.create({
      data: { code: 'PRO-1', name: 'Proactive Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pmId },
      select: { id: true },
    });
    projectId = proj.id;
    await prisma.task.createMany({
      data: [
        { projectId, wbsCode: '1', name: 'Design', planStart: new Date(Date.UTC(2026, 7, 1)), planEnd: new Date(Date.UTC(2026, 7, 15)) },
        { projectId, wbsCode: '2', name: 'Build', planStart: new Date(Date.UTC(2026, 7, 16)), planEnd: new Date(Date.UTC(2026, 7, 31)) },
      ],
    });
  });
});

afterAll(async () => {
  __setAiPort(null);
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('MULTITENANCY_ENFORCE', prevFlag);
  restore('ANTHROPIC_API_KEY', prevKey);
  restore('PROACTIVE_HOUR', prevHour);
  restore('PROACTIVE_WEEKDAY', prevWeekday);
});

describe('Proactive AI sweep', () => {
  it('is a no-op when the tenant has not opted in', async () => {
    const r = await runProactiveSweepIfDue(DUE);
    expect(r.drafted).toBe(0);
    const count = await runWithTenant(tenantId, () => prisma.aiBriefing.count());
    expect(count).toBe(0);
  });

  it('is a no-op outside the send window even when opted in', async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { aiProactiveEnabled: true } });
    const r = await runProactiveSweepIfDue(NOT_DUE);
    expect(r.drafted).toBe(0);
  });

  it('drafts a PENDING briefing per active project and notifies the PM', async () => {
    const r = await runProactiveSweepIfDue(DUE);
    expect(r.drafted).toBe(1);

    const briefing = await runWithTenant(tenantId, () => prisma.aiBriefing.findFirst({ where: { projectId } }));
    expect(briefing).toBeTruthy();
    expect(briefing!.status).toBe('PENDING');
    expect(briefing!.execSummary).toBe(DRAFT.executiveSummary);
    expect(briefing!.highlights).toBe(DRAFT.highlights);
    expect(briefing!.model).toContain('haiku'); // proactive model default

    const notif = await runWithTenant(tenantId, () => prisma.notification.findFirst({ where: { userId: pmId, type: 'AI_BRIEFING_READY' } }));
    expect(notif).toBeTruthy();
    expect(notif!.projectId).toBe(projectId);
  });

  it('is idempotent within a period — no repeat draft/spend', async () => {
    const r = await runProactiveSweepIfDue(DUE);
    expect(r.drafted).toBe(0);
    const count = await runWithTenant(tenantId, () => prisma.aiBriefing.count({ where: { projectId } }));
    expect(count).toBe(1);
  });
});
