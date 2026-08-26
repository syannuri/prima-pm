import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Proactive AI briefing REVIEW routes (inbox + per-project get/apply/dismiss) + the /ai-settings
// proactive opt-in. Seeds a PENDING briefing directly (no LLM needed) and exercises the endpoints.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let tenantId = '';
let pmToken = '';
let adminToken = '';
let projectId = '';
let briefingId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';

  await wipeDb();
  await backfillDefaultTenant(prisma);

  const t = await prisma.tenant.create({ data: { slug: 'brief-co', name: 'Brief Co', status: 'ACTIVE' } });
  tenantId = t.id;
  const pm = await prisma.user.create({ data: { name: 'PM', email: 'pm@brief.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: pm.id, tenantId, role: 'PROJECT_MANAGER' } });
  pmToken = signAccessToken({ sub: pm.id, role: 'PROJECT_MANAGER', email: pm.email, tv: 0, tid: tenantId });
  const admin = await prisma.user.create({ data: { name: 'Adm', email: 'adm@brief.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: admin.id, tenantId, role: 'ADMIN' } });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email, tv: 0, tid: tenantId });

  await runWithTenant(tenantId, async () => {
    const proj = await prisma.project.create({
      data: { code: 'BRF-1', name: 'Briefing Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id },
      select: { id: true },
    });
    projectId = proj.id;
    const b = await prisma.aiBriefing.create({
      data: {
        projectId, tenantId, period: 'weekly', periodKey: '2026-08-24', status: 'PENDING',
        execSummary: 'On track.', highlights: 'Design done.', lowlights: 'One slip.', nextFocus: 'Build.',
        slipLevel: 'LOW', slipScore: 10, overrunLevel: 'LOW', overrunScore: 0, model: 'claude-haiku-4-5',
      },
      select: { id: true },
    });
    briefingId = b.id;
  });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('Proactive AI briefing routes', () => {
  it('401 on the inbox without a token', async () => {
    expect((await request(app).get(api('/ai-briefings'))).status).toBe(401);
  });

  it('GET /projects/:id/ai-briefing returns the pending briefing', async () => {
    const res = await request(app).get(api(`/projects/${projectId}/ai-briefing`)).set(bearer(pmToken));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(briefingId);
    expect(res.body.execSummary).toBe('On track.');
    expect(res.body.slip).toEqual({ level: 'LOW', score: 10 });
  });

  it('GET /ai-briefings lists it for the PM with project labels', async () => {
    const res = await request(app).get(api('/ai-briefings')).set(bearer(pmToken));
    expect(res.status).toBe(200);
    expect(res.body.briefings).toHaveLength(1);
    expect(res.body.briefings[0].projectCode).toBe('BRF-1');
  });

  it('/ai-settings round-trips the proactive opt-in (ADMIN)', async () => {
    const on = await request(app).patch(api('/ai-settings')).set(bearer(adminToken)).send({ proactiveEnabled: true });
    expect(on.status).toBe(200);
    expect(on.body.proactiveEnabled).toBe(true);
    expect((await prisma.tenant.findUnique({ where: { id: tenantId } }))!.aiProactiveEnabled).toBe(true);
  });

  it('dismiss resolves the briefing and clears it from the banner + inbox', async () => {
    const res = await request(app).post(api(`/projects/${projectId}/ai-briefing/${briefingId}/dismiss`)).set(bearer(pmToken));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISMISSED');

    const banner = await request(app).get(api(`/projects/${projectId}/ai-briefing`)).set(bearer(pmToken));
    expect(banner.body).toBeNull();
    const inbox = await request(app).get(api('/ai-briefings')).set(bearer(pmToken));
    expect(inbox.body.briefings).toHaveLength(0);
  });
});
