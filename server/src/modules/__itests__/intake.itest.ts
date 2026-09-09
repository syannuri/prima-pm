import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Project Intake & Portfolio Selection: any member submits ideas; ADMIN/PMO score, decide, convert &
// set weights. Verifies role/ownership gating, the scoring math (risk/cost inverted), the full
// lifecycle through convert-to-project, and tenant isolation.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let admin = '', pm = '', team = '', adminB = '';
let tidA = '', tidB = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const a = await prisma.tenant.create({ data: { slug: 'inta', name: 'Intake A' } });
  const b = await prisma.tenant.create({ data: { slug: 'intb', name: 'Intake B' } });
  tidA = a.id; tidB = b.id;

  const mk = async (name: string, email: string, role: any, tid: string) => {
    const u = await prisma.user.create({ data: { name, email, role, passwordHash: await hashPassword('x'), isActive: true } });
    await prisma.membership.create({ data: { userId: u.id, tenantId: tid, role } });
    return signAccessToken({ sub: u.id, role, email, tv: 0, tid });
  };
  admin = await mk('adm', 'adm@inta.test', 'ADMIN', tidA);
  pm = await mk('pm', 'pm@inta.test', 'PROJECT_MANAGER', tidA);
  team = await mk('tm', 'tm@inta.test', 'TEAM_MEMBER', tidA);
  adminB = await mk('admb', 'adm@intb.test', 'ADMIN', tidB);
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('intake / portfolio', () => {
  let id = '';

  it('rejects unauthenticated access', async () => {
    expect((await request(app).get(api('/intake'))).status).toBe(401);
  });

  it('a member (PM) submits a proposal → DRAFT with an INT code', async () => {
    const r = await request(app).post(api('/intake')).set(bearer(pm))
      .send({ title: 'New CRM rollout', summary: 'Replace the legacy CRM', category: 'ENTERPRISE_APP', estCostIdr: 500000000, estRevenueIdr: 900000000 });
    expect(r.status).toBe(201);
    expect(r.body.proposal.status).toBe('DRAFT');
    expect(r.body.proposal.code).toMatch(/^INT-\d{4}-0001$/);
    id = r.body.proposal.id;
  });

  it('the requester submits it for review', async () => {
    const r = await request(app).post(api(`/intake/${id}/submit`)).set(bearer(pm));
    expect(r.status).toBe(200);
    expect(r.body.proposal.status).toBe('SUBMITTED');
  });

  it('another member cannot edit someone else\'s proposal (403); PMO can', async () => {
    expect((await request(app).put(api(`/intake/${id}`)).set(bearer(team)).send({ title: 'hijack' })).status).toBe(403);
    expect((await request(app).put(api(`/intake/${id}`)).set(bearer(admin)).send({ title: 'New CRM rollout (v2)' })).status).toBe(200);
  });

  it('a member cannot score; PMO scores → UNDER_REVIEW with the weighted total (risk/cost inverted)', async () => {
    expect((await request(app).post(api(`/intake/${id}/score`)).set(bearer(team)).send({ scoreValue: 5 })).status).toBe(403);
    const r = await request(app).post(api(`/intake/${id}/score`)).set(bearer(admin))
      .send({ scoreStrategic: 5, scoreValue: 4, scoreRisk: 2, scoreCost: 2, scoreUrgency: 3 });
    expect(r.status).toBe(200);
    expect(r.body.proposal.status).toBe('UNDER_REVIEW');
    // default weights {strategic3,value3,risk2,cost2,urgency1}; risk/cost inverted (6−s):
    // 3*5 + 3*4 + 1*3 + 2*(6−2) + 2*(6−2) = 15+12+3+8+8 = 46
    expect(Number(r.body.proposal.weightedScore)).toBe(46);
  });

  it('PMO approves and converts it into a DRAFT project (one-shot)', async () => {
    expect((await request(app).post(api(`/intake/${id}/decision`)).set(bearer(admin)).send({ decision: 'APPROVE' })).body.proposal.status).toBe('APPROVED');
    const r = await request(app).post(api(`/intake/${id}/convert`)).set(bearer(admin)).send({});
    expect(r.status).toBe(201);
    expect(r.body.project.status).toBe('DRAFT');
    expect(r.body.project.code).toMatch(/^PRJ-\d{4}-/);
    expect(r.body.project.name).toBe('New CRM rollout (v2)');
    expect(r.body.proposal.status).toBe('CONVERTED');
    expect(r.body.proposal.convertedProjectId).toBe(r.body.project.id);
    // second convert is a conflict
    expect((await request(app).post(api(`/intake/${id}/convert`)).set(bearer(admin)).send({})).status).toBe(409);
  });

  it('tenant isolation — tenant B admin sees none of tenant A\'s proposals', async () => {
    const r = await request(app).get(api('/intake')).set(bearer(adminB));
    expect(r.status).toBe(200);
    expect(r.body.proposals.length).toBe(0);
  });

  it('PMO updates scoring weights; members can read them', async () => {
    const put = await request(app).put(api('/intake/weights')).set(bearer(admin)).send({ strategic: 5, value: 3, risk: 1, cost: 1, urgency: 1 });
    expect(put.status).toBe(200);
    expect(put.body.weights.strategic).toBe(5);
    const get = await request(app).get(api('/intake/weights')).set(bearer(pm));
    expect(get.body.weights.strategic).toBe(5);
    // members cannot change weights
    expect((await request(app).put(api('/intake/weights')).set(bearer(team)).send({ strategic: 9, value: 1, risk: 1, cost: 1, urgency: 1 })).status).toBe(403);
  });
});
