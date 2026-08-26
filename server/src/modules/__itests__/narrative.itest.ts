import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setAiNarrativePort, type NarrativeDraft } from '../../lib/ai.js';

// AI Status Narrative (Phase 1) — the endpoint generates a DRAFT from report data via an injectable
// port (no network, no key). Exercises the two gates (global env + per-tenant opt-in) and the draft
// mapping. Runs enforcement-ON so a real tenant/token/opt-in flow is tested.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const DRAFT: NarrativeDraft = {
  executiveSummary: 'Proyek sehat, sedikit di belakang jadwal.',
  highlights: 'Dua milestone tercapai.',
  lowlights: 'Satu tugas overdue.',
  nextFocus: 'Kejar tugas kritis.',
};

let prevFlag: string | undefined;
let prevKey: string | undefined;
let platformToken = '';
let ownerToken = '';
let aico = '';
let projectId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.MULTITENANCY_ENFORCE = 'true';
  process.env.ANTHROPIC_API_KEY = 'test-key'; // enables the global gate (aiEnabled())

  // Default fake port returns a fixed draft. Individual tests may override. (draftJson is part of
  // the generic AiPort but unused by the narrative flow → returns null.)
  __setAiNarrativePort({ async draftNarrative() { return DRAFT; }, async draftJson() { return null; } });

  await wipeDb();
  const { tenantId: defaultTid } = await backfillDefaultTenant(prisma);

  const platform = await prisma.user.create({ data: { name: 'plat', email: 'plat@ai.test', role: 'ADMIN', isPlatformAdmin: true, passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: platform.id, tenantId: defaultTid, role: 'ADMIN' } });
  platformToken = signAccessToken({ sub: platform.id, role: 'ADMIN', email: platform.email, tv: 0, tid: defaultTid });

  const t = await prisma.tenant.create({ data: { slug: 'aico', name: 'AI Co' } }); // aiNarrativeEnabled defaults false
  aico = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@aico.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId: aico, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: aico });

  const proj = await runWithTenant(aico, () => prisma.project.create({
    data: { code: 'AI-1', name: 'AI Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' },
    select: { id: true },
  }));
  projectId = proj.id;
});

afterAll(async () => {
  __setAiNarrativePort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

const draftUrl = () => api(`/projects/${projectId}/report/commentary/ai-draft?period=weekly`);

describe('AI status narrative — ai-draft', () => {
  it('503 when the global gate is off (ANTHROPIC_API_KEY unset)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app).post(draftUrl()).set(bearer(ownerToken));
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_DISABLED');
  });

  it('403 when the tenant has not opted in', async () => {
    const res = await request(app).post(draftUrl()).set(bearer(ownerToken));
    expect(res.status).toBe(403);
  });

  it('super-admin PATCH can flip the per-tenant opt-in', async () => {
    const res = await request(app).patch(api(`/admin/tenants/${aico}`)).set(bearer(platformToken)).send({ aiNarrativeEnabled: true });
    expect(res.status).toBe(200);
    expect((await prisma.tenant.findUnique({ where: { id: aico } }))!.aiNarrativeEnabled).toBe(true);
  });

  it('200 returns the structured draft once enabled', async () => {
    const res = await request(app).post(draftUrl()).set(bearer(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DRAFT);
  });

  it('drafts in English when the caller sends ?lang=en (else Indonesian)', async () => {
    let captured = '';
    __setAiNarrativePort({ async draftNarrative({ system }) { captured = system; return DRAFT; }, async draftJson() { return null; } });

    await request(app).post(`${draftUrl()}&lang=en`).set(bearer(ownerToken));
    expect(captured).toContain('senior PMO analyst');
    expect(captured).not.toContain('Bahasa Indonesia');

    await request(app).post(draftUrl()).set(bearer(ownerToken)); // no lang → Indonesian default
    expect(captured).toContain('Bahasa Indonesia');

    __setAiNarrativePort({ async draftNarrative() { return DRAFT; }, async draftJson() { return null; } });
  });

  it('502 when the model declines / returns nothing', async () => {
    __setAiNarrativePort({ async draftNarrative() { return null; }, async draftJson() { return null; } });
    const res = await request(app).post(draftUrl()).set(bearer(ownerToken));
    __setAiNarrativePort({ async draftNarrative() { return DRAFT; }, async draftJson() { return null; } });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });

  it('tenant ADMIN self-serve /ai-settings round-trips the opt-in', async () => {
    const get1 = await request(app).get(api('/ai-settings')).set(bearer(ownerToken));
    expect(get1.status).toBe(200);
    expect(get1.body).toEqual({ configured: true, enabled: true, actionsEnabled: false }); // enabled by test 3; Stage C actions still off

    const off = await request(app).patch(api('/ai-settings')).set(bearer(ownerToken)).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);
    // The report availability hint now follows the opt-in.
    const drafted = await request(app).post(draftUrl()).set(bearer(ownerToken));
    expect(drafted.status).toBe(403); // opted back out

    const on = await request(app).patch(api('/ai-settings')).set(bearer(ownerToken)).send({ enabled: true });
    expect(on.body.enabled).toBe(true);
  });
});
