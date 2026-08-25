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

// Portfolio Q&A assistant (Phase 4) — server-side manual tool loop via an injectable port. Exercises
// the two gates (env + per-tenant opt-in), the availability probe, and — critically — the security
// scoping: a PROJECT_MANAGER's tools only ever see projects they own, never another PM's project.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

// Default fake: returns a fixed answer without touching tools.
const answerPort: AiPort = {
  async draftJson() { return null; },
  async draftNarrative() { return null; },
  async runToolLoop() { return 'Halo, ini jawaban dari asisten.'; },
};

let prevFlag: string | undefined;
let prevKey: string | undefined;
let platformToken = '';
let pmToken = '';
let aico = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.MULTITENANCY_ENFORCE = 'true';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  __setAiPort(answerPort);

  await wipeDb();
  const { tenantId: defaultTid } = await backfillDefaultTenant(prisma);

  const platform = await prisma.user.create({ data: { name: 'plat', email: 'plat@asst.test', role: 'ADMIN', isPlatformAdmin: true, passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: platform.id, tenantId: defaultTid, role: 'ADMIN' } });
  platformToken = signAccessToken({ sub: platform.id, role: 'ADMIN', email: platform.email, tv: 0, tid: defaultTid });

  const t = await prisma.tenant.create({ data: { slug: 'asstco', name: 'Asst Co' } });
  aico = t.id;
  const pm = await prisma.user.create({ data: { name: 'pm', email: 'pm@asstco.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: pm.id, tenantId: aico, role: 'PROJECT_MANAGER' } });
  pmToken = signAccessToken({ sub: pm.id, role: 'PROJECT_MANAGER', email: pm.email, tv: 0, tid: aico });
  const other = await prisma.user.create({ data: { name: 'other', email: 'other@asstco.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: other.id, tenantId: aico, role: 'PROJECT_MANAGER' } });

  await runWithTenant(aico, async () => {
    await prisma.project.create({ data: { code: 'MINE-1', name: 'My Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id } });
    await prisma.project.create({ data: { code: 'OTHER-1', name: 'Other PM Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: other.id } });
  });
});

afterAll(async () => {
  __setAiPort(null);
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

const askUrl = () => api('/assistant/ask');
const availUrl = () => api('/assistant/available');
const ask = (token: string) => request(app).post(askUrl()).set(bearer(token)).send({ messages: [{ role: 'user', content: 'Bagaimana proyek saya?' }] });

describe('AI portfolio assistant — /assistant', () => {
  it('503 when the global gate is off (ANTHROPIC_API_KEY unset)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await ask(pmToken);
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_DISABLED');
  });

  it('403 when the tenant has not opted in', async () => {
    const res = await ask(pmToken);
    expect(res.status).toBe(403);
  });

  it('/available reflects the gates (false before opt-in)', async () => {
    const res = await request(app).get(availUrl()).set(bearer(pmToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aiAvailable: false, actionsAvailable: false });
  });

  it('400 on an empty message list', async () => {
    await request(app).patch(api(`/admin/tenants/${aico}`)).set(bearer(platformToken)).send({ aiNarrativeEnabled: true });
    const res = await request(app).post(askUrl()).set(bearer(pmToken)).send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it('200 returns an answer once the tenant opts in', async () => {
    const avail = await request(app).get(availUrl()).set(bearer(pmToken));
    expect(avail.body).toEqual({ aiAvailable: true, actionsAvailable: false }); // narrative on, actions not yet
    const res = await ask(pmToken);
    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('asisten');
  });

  it('SECURITY: a PM\'s tools only see their own projects, never another PM\'s', async () => {
    // A port that drives the real executeTool: probe list_projects + a foreign project by code.
    __setAiPort({
      async draftJson() { return null; },
      async draftNarrative() { return null; },
      async runToolLoop({ executeTool }) {
        const list = await executeTool('list_projects', {});
        const mine = await executeTool('get_project_details', { project_code: 'MINE-1' });
        const foreign = await executeTool('get_project_details', { project_code: 'OTHER-1' });
        return JSON.stringify({ list, mineOk: !mine.includes('tidak dapat diakses'), foreign });
      },
    });
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    expect(res.status).toBe(200);
    const out = JSON.parse(res.body.answer);
    // Own project resolves; foreign project is refused; the list contains only the owned project.
    expect(out.mineOk).toBe(true);
    expect(out.foreign).toContain('tidak dapat diakses');
    expect(out.list).toContain('MINE-1');
    expect(out.list).not.toContain('OTHER-1');
  });

  it('STAGE C: Anett can propose_action (stages a proposal for approval, never executes)', async () => {
    // Opt the tenant into AI actions (separate, stronger switch than the narrative gate). No charter
    // needed: this test only STAGES a proposal (PENDING) — the risk executor runs on approval, later.
    await prisma.tenant.update({ where: { id: aico }, data: { aiActionsEnabled: true } });
    __setAiPort({
      async draftJson() { return null; },
      async draftNarrative() { return null; },
      async runToolLoop({ executeTool }) {
        const foreign = await executeTool('propose_action', { project_code: 'OTHER-1', action_type: 'TIDY_SCHEDULE', params: {} });
        const mine = await executeTool('propose_action', { project_code: 'MINE-1', action_type: 'CREATE_RISK', params: { title: 'Vendor may slip', probabilityScore: 4, impactScore: 3 }, rationale: 'SPI down' });
        return JSON.stringify({ foreign, mine });
      },
    });
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    expect(res.status).toBe(200);
    const out = JSON.parse(res.body.answer);
    expect(out.foreign).toContain('tidak dapat diakses'); // cross-PM project is refused
    expect(out.mine).toContain('"ok":true');
    // The staged proposal is surfaced to the client for the "view in Approvals" card.
    expect(res.body.proposals).toEqual([{ actionType: 'CREATE_RISK', projectCode: 'MINE-1', routed: true }]);
    // The proposal landed as PENDING (nothing applied yet).
    const proposals = await runWithTenant(aico, () => prisma.aiActionProposal.findMany({ where: { actionType: 'CREATE_RISK' } }));
    expect(proposals.length).toBe(1);
    expect(proposals[0].status).toBe('PENDING');
    await prisma.tenant.update({ where: { id: aico }, data: { aiActionsEnabled: false } });
  });

  it('HOW-TO: get_process_guide returns grounded steps + surfaces an id-less route as a nav target', async () => {
    __setAiPort({
      async draftJson() { return null; },
      async draftNarrative() { return null; },
      async runToolLoop({ executeTool }) {
        const baseline = await executeTool('get_process_guide', { topic: 'cara membuat baseline biaya dan jadwal' });
        const reports = await executeTool('get_process_guide', { topic: 'buat laporan' });
        const unknown = await executeTool('get_process_guide', { topic: 'xyzzy tidak ada' });
        return JSON.stringify({ baseline, reports, unknown });
      },
    });
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    expect(res.status).toBe(200);
    const out = JSON.parse(res.body.answer);
    // Baseline guide matched and carries the real menu path; it is project-scoped → no nav route.
    expect(out.baseline).toContain('Lock baseline');
    expect(out.baseline).toContain('tab Cost');
    // Unknown topic degrades to the topic list, not a hallucinated answer.
    expect(out.unknown).toContain('availableTopics');
    // The id-less Reports route is surfaced to the client as a clickable nav target (deduped).
    expect(res.body.navigate).toEqual([{ label: 'Buka Reports', path: '/reports' }]);
  });

  it('502 when the model declines / returns nothing', async () => {
    __setAiPort({ async draftJson() { return null; }, async draftNarrative() { return null; }, async runToolLoop() { return null; } });
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });
});
