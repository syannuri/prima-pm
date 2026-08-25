import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';
import { hashPassword } from '../../../lib/password.js';
import { signAccessToken } from '../../../lib/jwt.js';
import { runWithTenant } from '../../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../../lib/tenant/backfill.js';
import { wipeDb } from '../../../test/tenancy.harness.js';
import { __setAiPort, type AiPort } from '../../../lib/ai.js';
import { CrImpactSchema, type CrImpactDraft } from '../crImpact.service.js';

// AI CR Impact (Phase 1) — the endpoint generates an advisory impact DRAFT for a Change Request via
// an injectable port (no network, no key). Exercises the two gates (global env + per-tenant opt-in),
// PMO/ADMIN authorization, and the /ai-available probe. Runs enforcement-ON for a real tenant flow.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const IMPACT: CrImpactDraft = {
  scheduleImpact: 'Menambah ~5 hari ke jalur kritis.',
  costImpact: 'Naik Rp 20 jt di luar kontingensi.',
  riskNarrative: 'Menambah tekanan pada tim pengembangan.',
  newRisks: [{ title: 'Sumber daya bentrok', severity: 'MEDIUM' }],
  recommendation: 'NEEDS_INFO',
  rationale: 'Dampak biaya perlu konfirmasi dari finance.',
  confidence: 'MEDIUM',
};
// The port is generic (draftJson); draftNarrative is unused here but required by the AiPort shape.
const fakePort: AiPort = { async draftJson() { return IMPACT; }, async draftNarrative() { return null; } };

let prevFlag: string | undefined;
let prevKey: string | undefined;
let platformToken = '';
let ownerToken = '';    // ADMIN of the tenant (a decider)
let memberToken = '';   // VIEWER of the tenant (not a decider)
let aico = '';
let projectId = '';
let crId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.MULTITENANCY_ENFORCE = 'true';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  __setAiPort(fakePort);

  await wipeDb();
  const { tenantId: defaultTid } = await backfillDefaultTenant(prisma);

  const platform = await prisma.user.create({ data: { name: 'plat', email: 'plat@cri.test', role: 'ADMIN', isPlatformAdmin: true, passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: platform.id, tenantId: defaultTid, role: 'ADMIN' } });
  platformToken = signAccessToken({ sub: platform.id, role: 'ADMIN', email: platform.email, tv: 0, tid: defaultTid });

  const t = await prisma.tenant.create({ data: { slug: 'crico', name: 'CR Co' } }); // aiNarrativeEnabled defaults false
  aico = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@crico.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId: aico, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: aico });

  const member = await prisma.user.create({ data: { name: 'member', email: 'member@crico.test', role: 'VIEWER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: member.id, tenantId: aico, role: 'VIEWER' } });
  memberToken = signAccessToken({ sub: member.id, role: 'VIEWER', email: member.email, tv: 0, tid: aico });

  const built = await runWithTenant(aico, async () => {
    const proj = await prisma.project.create({
      data: { code: 'CR-1', name: 'CR Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' },
      select: { id: true },
    });
    const cr = await prisma.changeRequest.create({
      data: {
        projectId: proj.id, type: 'SCOPE', title: 'Add reporting module', description: 'New scope for reporting.',
        magnitude: 'MAJOR', impactAreas: ['SCHEDULE', 'COST'], status: 'SUBMITTED', requestedBy: owner.id,
      },
      select: { id: true },
    });
    return { projectId: proj.id, crId: cr.id };
  });
  projectId = built.projectId;
  crId = built.crId;
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

const draftUrl = () => api(`/projects/${projectId}/charter/change-requests/${crId}/impact/ai-draft`);
const availUrl = () => api(`/projects/${projectId}/ai-available`);

describe('AI CR impact — impact/ai-draft', () => {
  it('the injected draft validates against the shared schema', () => {
    expect(CrImpactSchema.safeParse(IMPACT).success).toBe(true);
  });

  it('503 when the global gate is off (ANTHROPIC_API_KEY unset)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app).post(draftUrl()).set(bearer(ownerToken));
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_DISABLED');
  });

  it('403 when a non-decider (VIEWER) calls it', async () => {
    const res = await request(app).post(draftUrl()).set(bearer(memberToken));
    expect(res.status).toBe(403);
  });

  it('403 when the tenant has not opted in', async () => {
    const res = await request(app).post(draftUrl()).set(bearer(ownerToken));
    expect(res.status).toBe(403);
  });

  it('/ai-available reflects the gates (false before opt-in)', async () => {
    const res = await request(app).get(availUrl()).set(bearer(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aiAvailable: false });
  });

  it('200 returns the structured impact draft once the tenant opts in', async () => {
    await request(app).patch(api(`/admin/tenants/${aico}`)).set(bearer(platformToken)).send({ aiNarrativeEnabled: true });
    const avail = await request(app).get(availUrl()).set(bearer(ownerToken));
    expect(avail.body).toEqual({ aiAvailable: true });
    const res = await request(app).post(draftUrl()).set(bearer(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(IMPACT);
  });

  it('502 when the model declines / returns nothing', async () => {
    __setAiPort({ async draftJson() { return null; }, async draftNarrative() { return null; } });
    const res = await request(app).post(draftUrl()).set(bearer(ownerToken));
    __setAiPort(fakePort);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });
});
