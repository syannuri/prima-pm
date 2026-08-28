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
    expect(res.body).toEqual({ aiAvailable: false, actionsAvailable: false, voiceServer: false });
  });

  it('400 on an empty message list', async () => {
    await request(app).patch(api(`/admin/tenants/${aico}`)).set(bearer(platformToken)).send({ aiNarrativeEnabled: true });
    const res = await request(app).post(askUrl()).set(bearer(pmToken)).send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it('200 returns an answer once the tenant opts in', async () => {
    const avail = await request(app).get(availUrl()).set(bearer(pmToken));
    expect(avail.body).toEqual({ aiAvailable: true, actionsAvailable: false, voiceServer: false }); // narrative on, actions/voice not yet
    const res = await ask(pmToken);
    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('asisten');
  });

  it('replies in English when the caller sends lang:"en" (else Indonesian)', async () => {
    let captured = '';
    __setAiPort({
      async draftJson() { return null; },
      async draftNarrative() { return null; },
      async runToolLoop({ system }) { captured = system; return 'ok'; },
    });

    await request(app).post(askUrl()).set(bearer(pmToken)).send({ messages: [{ role: 'user', content: 'How is my project?' }], lang: 'en' });
    expect(captured).toContain('project-management English');
    expect(captured).not.toContain('Bahasa Indonesia');

    await request(app).post(askUrl()).set(bearer(pmToken)).send({ messages: [{ role: 'user', content: 'Bagaimana proyek saya?' }] }); // no lang → id
    expect(captured).toContain('Bahasa Indonesia');

    __setAiPort(answerPort);
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

  it('OUTCOME LEARNING: get_action_effectiveness cites the tenant track record; foreign project refused', async () => {
    await prisma.tenant.update({ where: { id: aico }, data: { aiActionsEnabled: true } });
    // Seed measured TIDY_SCHEDULE outcomes on the PM's own project (2 improved, 1 worsened).
    await runWithTenant(aico, async () => {
      const proj = await prisma.project.findFirst({ where: { code: 'MINE-1' }, select: { id: true } });
      for (const v of ['IMPROVED', 'IMPROVED', 'WORSENED']) {
        const p = await prisma.aiActionProposal.create({ data: { projectId: proj!.id, actionType: 'TIDY_SCHEDULE', params: {}, status: 'APPLIED', appliedAt: new Date() } });
        await prisma.aiActionOutcome.create({ data: {
          projectId: proj!.id, proposalId: p.id, actionType: 'TIDY_SCHEDULE', scored: true,
          appliedAt: new Date(), evalDueAt: new Date(), spiBefore: 0.8, spiAfter: v === 'WORSENED' ? 0.7 : 0.9,
          spiDelta: v === 'WORSENED' ? -0.1 : 0.1, measuredAt: new Date(), verdict: v as never,
        } });
      }
    });
    __setAiPort({
      async draftJson() { return null; },
      async draftNarrative() { return null; },
      async runToolLoop({ executeTool }) {
        const all = await executeTool('get_action_effectiveness', {});
        const foreign = await executeTool('get_action_effectiveness', { project_code: 'OTHER-1' });
        return JSON.stringify({ all, foreign });
      },
    });
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    expect(res.status).toBe(200);
    const out = JSON.parse(res.body.answer);
    expect(out.all).toContain('Correlational'); // honesty note is always attached
    const tidy = JSON.parse(out.all).stats.find((s: { actionType: string }) => s.actionType === 'TIDY_SCHEDULE');
    expect(tidy.measured).toBe(3);
    expect(tidy.improved).toBe(2);
    expect(out.foreign).toContain('tidak dapat diakses'); // a non-owned project is refused
    await prisma.tenant.update({ where: { id: aico }, data: { aiActionsEnabled: false } });
  });

  it('RESOURCE: get_resource_conflicts surfaces over-allocation for the caller', async () => {
    await runWithTenant(aico, async () => {
      const proj = await prisma.project.findFirst({ where: { code: 'MINE-1' }, select: { id: true } });
      const r = await prisma.resource.create({ data: { name: 'Overloaded', capacityPerDay: 1, unitCostPerManday: 0, personnelRole: 'PROJECT_PERSONNEL' } });
      // ~40 man-days into a ~22-business-day month → over-allocated.
      for (const nm of ['Task A', 'Task B']) {
        const t = await prisma.task.create({ data: { projectId: proj!.id, wbsCode: '1', name: nm, planStart: new Date('2026-04-01T00:00:00Z'), planEnd: new Date('2026-04-30T00:00:00Z'), progressPct: 0 } });
        await prisma.costItemDirect.create({ data: { projectId: proj!.id, type: 'MANPOWER', label: nm, taskId: t.id, resourceId: r.id, personnelRole: 'PROJECT_PERSONNEL', planMandays: 20, unitCostPerManday: 0, manpowerCost: 0 } });
      }
    });
    __setAiPort({
      async draftJson() { return null; },
      async draftNarrative() { return null; },
      async runToolLoop({ executeTool }) { return await executeTool('get_resource_conflicts', {}); },
    });
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    expect(res.status).toBe(200);
    const conflicts = JSON.parse(res.body.answer);
    expect(conflicts.some((c: { resource: string }) => c.resource === 'Overloaded')).toBe(true);
  });

  it('WHAT-IF: run_what_if simulates + narrates for an owned project, refuses a foreign one', async () => {
    // draftJson is called twice inside runWhatIfAi (spec then narrate); return an empty spec so the
    // sim is deterministic regardless of MINE-1's schedule.
    __setAiPort({
      async draftJson({ jsonSchema }) {
        const props = (jsonSchema as { properties: Record<string, unknown> }).properties;
        if ('summary' in props) return { summary: 'Tidak ada dampak berarti.', tradeoffs: [], recommendation: 'Aman.' };
        return {};
      },
      async draftNarrative() { return null; },
      async runToolLoop({ executeTool }) {
        const mine = await executeTool('run_what_if', { project_code: 'MINE-1', question: 'kalau desain mundur 2 minggu' });
        const foreign = await executeTool('run_what_if', { project_code: 'OTHER-1', question: 'apa saja' });
        return JSON.stringify({ mine, foreign });
      },
    });
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    expect(res.status).toBe(200);
    const out = JSON.parse(res.body.answer);
    expect(out.mine).toContain('narrative');       // owned project simulated
    expect(out.foreign).toContain('tidak dapat diakses'); // foreign project refused
  });

  it('PORTFOLIO: get_portfolio_attention ranks projects that need attention', async () => {
    await runWithTenant(aico, async () => {
      const proj = await prisma.project.findFirst({ where: { code: 'MINE-1' }, select: { id: true } });
      const past = new Date(Date.now() - 5 * 24 * 3600 * 1000);
      await prisma.task.create({ data: { projectId: proj!.id, wbsCode: '9', name: 'Overdue X', planStart: past, planEnd: past, progressPct: 0 } });
    });
    __setAiPort({
      async draftJson() { return null; },
      async draftNarrative() { return null; },
      async runToolLoop({ executeTool }) { return await executeTool('get_portfolio_attention', {}); },
    });
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    expect(res.status).toBe(200);
    const out = JSON.parse(res.body.answer);
    expect(Array.isArray(out.items)).toBe(true);
    expect(out.items.some((i: { code: string }) => i.code === 'MINE-1')).toBe(true);
  });

  it('admin action-outcomes endpoint: 401 unauth, 200 for an ADMIN', async () => {
    const unauth = await request(app).get(api('/ai-settings/action-outcomes'));
    expect(unauth.status).toBe(401);
    const ok = await request(app).get(api('/ai-settings/action-outcomes')).set(bearer(platformToken));
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body.stats)).toBe(true);
    const recent = await request(app).get(api('/ai-settings/action-outcomes/recent?take=5')).set(bearer(platformToken));
    expect(recent.status).toBe(200);
    expect(Array.isArray(recent.body.outcomes)).toBe(true);
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

  it('CONTEXT + tools: resolves "proyek ini", scopes portfolio/tasks to accessible projects', async () => {
    const [mine, other] = await runWithTenant(aico, () => Promise.all([
      prisma.project.findFirst({ where: { code: 'MINE-1' }, select: { id: true } }),
      prisma.project.findFirst({ where: { code: 'OTHER-1' }, select: { id: true } }),
    ]));
    __setAiPort({
      async draftJson() { return null; },
      async draftNarrative() { return null; },
      async runToolLoop({ system, executeTool }) {
        const portfolio = await executeTool('get_portfolio_summary', {});
        const tasks = await executeTool('list_project_tasks', { project_code: 'MINE-1' });
        const foreign = await executeTool('list_project_tasks', { project_code: 'OTHER-1' });
        return JSON.stringify({ system, portfolio, tasks, foreign });
      },
    });
    // Viewing MINE-1 → "proyek ini" must resolve to it in the prompt.
    const res = await request(app).post(askUrl()).set(bearer(pmToken)).send({ messages: [{ role: 'user', content: 'x' }], context: { projectId: mine!.id, tab: 'Cost' } });
    // A project OUTSIDE the caller's set must be ignored (never injected).
    const resForeign = await request(app).post(askUrl()).set(bearer(pmToken)).send({ messages: [{ role: 'user', content: 'x' }], context: { projectId: other!.id } });
    __setAiPort(answerPort);
    expect(res.status).toBe(200);
    const out = JSON.parse(res.body.answer);
    expect(out.system).toContain('proyek MINE-1');
    expect(out.system).toContain('proyek ini');
    expect(JSON.parse(out.portfolio).totalProjects).toBe(1); // only MINE-1 — OTHER-1 excluded
    expect(out.tasks).toContain('total');
    expect(out.foreign).toContain('tidak dapat diakses'); // cross-PM task list refused
    expect(JSON.parse(resForeign.body.answer).system).not.toContain('OTHER-1'); // foreign context ignored
  });

  it('GET /assistant/briefing returns the deterministic attention rollup', async () => {
    const res = await request(app).get(api('/assistant/briefing')).set(bearer(pmToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('approvalsWaiting');
    expect(res.body).toHaveProperty('overdueTasks');
    expect(Array.isArray(res.body.projectsWithOverdue)).toBe(true);
  });

  it('STREAM: /ask/stream emits live step events then the final answer', async () => {
    __setAiPort({
      async draftJson() { return null; },
      async draftNarrative() { return null; },
      async runToolLoop({ executeTool }) {
        await executeTool('list_projects', {});
        await executeTool('get_project_details', { project_code: 'MINE-1' });
        return 'Ini jawaban final.';
      },
    });
    const res = await request(app).post(api('/assistant/ask/stream')).set(bearer(pmToken)).send({ messages: [{ role: 'user', content: 'x' }] });
    __setAiPort(answerPort);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const frames = res.text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
    const steps = frames.filter((f) => f.type === 'step').map((f) => f.label);
    expect(steps).toContain('Membaca daftar proyek');
    expect(steps.some((s: string) => s.startsWith('Menganalisis kesehatan'))).toBe(true);
    const answer = frames.find((f) => f.type === 'answer');
    expect(answer?.answer).toBe('Ini jawaban final.');
    expect(frames.some((f) => f.type === 'done')).toBe(true);
  });

  it('502 when the model declines / returns nothing', async () => {
    __setAiPort({ async draftJson() { return null; }, async draftNarrative() { return null; }, async runToolLoop() { return null; } });
    const res = await ask(pmToken);
    __setAiPort(answerPort);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });
});
