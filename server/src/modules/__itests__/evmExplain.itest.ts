import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { __setAiPort, type AiPort } from '../../lib/ai.js';
import { EvmExplainSchema, type EvmExplainDraft } from '../report/evmExplain.service.js';

// AI EVM explainer (Phase 2) — generates an advisory EVM interpretation via an injectable port (no
// network, no key). Exercises the two gates (global env + per-tenant opt-in) and the draft shape.
// Reuses the generic AiPort.draftJson core (foundation from Phase 1).
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const DRAFT: EvmExplainDraft = {
  verdict: 'Proyek sedikit di belakang jadwal namun on budget.',
  scheduleDrivers: ['Dua tugas kritis overdue.'],
  costDrivers: [],
  recovery: ['Re-sequence tugas kritis.', 'Tambah sumber daya sementara.'],
};
const fakePort: AiPort = { async draftJson() { return DRAFT; }, async draftNarrative() { return null; } };

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
  process.env.ANTHROPIC_API_KEY = 'test-key';
  __setAiPort(fakePort);

  await wipeDb();
  const { tenantId: defaultTid } = await backfillDefaultTenant(prisma);

  const platform = await prisma.user.create({ data: { name: 'plat', email: 'plat@evm.test', role: 'ADMIN', isPlatformAdmin: true, passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: platform.id, tenantId: defaultTid, role: 'ADMIN' } });
  platformToken = signAccessToken({ sub: platform.id, role: 'ADMIN', email: platform.email, tv: 0, tid: defaultTid });

  const t = await prisma.tenant.create({ data: { slug: 'evmco', name: 'EVM Co' } });
  aico = t.id;
  const owner = await prisma.user.create({ data: { name: 'owner', email: 'owner@evmco.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId: aico, role: 'ADMIN' } });
  ownerToken = signAccessToken({ sub: owner.id, role: 'ADMIN', email: owner.email, tv: 0, tid: aico });

  const proj = await runWithTenant(aico, () => prisma.project.create({
    data: { code: 'EVM-1', name: 'EVM Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE' },
    select: { id: true },
  }));
  projectId = proj.id;
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

const draftUrl = () => api(`/projects/${projectId}/report/evm-explain/ai-draft`);

describe('AI EVM explainer — evm-explain/ai-draft', () => {
  it('the injected draft validates against the shared schema', () => {
    expect(EvmExplainSchema.safeParse(DRAFT).success).toBe(true);
  });

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

  it('200 returns the structured explanation once the tenant opts in', async () => {
    await request(app).patch(api(`/admin/tenants/${aico}`)).set(bearer(platformToken)).send({ aiNarrativeEnabled: true });
    const res = await request(app).post(draftUrl()).set(bearer(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DRAFT);
  });

  it('502 when the model declines / returns nothing', async () => {
    __setAiPort({ async draftJson() { return null; }, async draftNarrative() { return null; } });
    const res = await request(app).post(draftUrl()).set(bearer(ownerToken));
    __setAiPort(fakePort);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });
});
