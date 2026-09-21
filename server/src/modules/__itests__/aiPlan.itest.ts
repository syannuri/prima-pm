import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { proposeAction } from '../aiActions/aiActions.service.js';
import { decideApproval } from '../approval/approval.service.js';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

// Autopilot (multi-step) — Anett composes ONE ordered plan of whitelisted actions (EXECUTE_PLAN) that
// runs as one unit. Like Stage C, proposeAction does NOT call the LLM (the plan arrives as params), so
// we only need the env gate on; no fake AiPort. Runs with MULTITENANCY_ENFORCE=false, so
// PROJECT_PM/ROLE approvers resolve via the global User.role.

let adminId: string, pmId: string;
let pmToken: string, viewerToken: string;
let projectId: string, taskId: string;
let actionsOnlyProjectId: string; // tenant has aiActionsEnabled but NOT aiAutopilotEnabled
let prevKey: string | undefined;

beforeAll(async () => {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((x) => `"${x.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

  prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';

  const admin = await prisma.user.create({ data: { name: 'AP Admin', email: 'ap-admin@corp.test', role: 'ADMIN', passwordHash: await hashPassword('Admin-Pass-1'), isActive: true } });
  const pm = await prisma.user.create({ data: { name: 'AP PM', email: 'ap-pm@corp.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('Pm-Pass-1'), isActive: true } });
  const viewer = await prisma.user.create({ data: { name: 'AP Viewer', email: 'ap-view@corp.test', role: 'VIEWER', passwordHash: await hashPassword('View-Pass-1'), isActive: true } });
  adminId = admin.id; pmId = pm.id;
  pmToken = signAccessToken({ sub: pm.id, role: 'PROJECT_MANAGER', email: pm.email });
  viewerToken = signAccessToken({ sub: viewer.id, role: 'VIEWER', email: viewer.email });

  // Non-tenant project → env gate alone governs both actions + autopilot (no per-tenant opt-in to fail).
  const project = await prisma.project.create({ data: { code: 'AP-1', name: 'Autopilot Test', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id } });
  projectId = project.id;
  const task = await prisma.task.create({ data: { projectId, wbsCode: '1', name: 'Design', planStart: new Date('2030-02-01'), planEnd: new Date('2030-02-06'), progressPct: 0 } });
  taskId = task.id;

  // A tenant that opted into ACTIONS but NOT autopilot — exercises the extra autopilot gate (403).
  const tenant = await prisma.tenant.create({ data: { name: 'AP Tenant', slug: 'ap-tenant', aiActionsEnabled: true, aiAutopilotEnabled: false } });
  const tp = await prisma.project.create({ data: { code: 'AP-T', name: 'Actions-only Proj', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id, tenantId: tenant.id } });
  actionsOnlyProjectId = tp.id;
});

afterAll(async () => {
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

beforeEach(async () => {
  await prisma.approvalRequest.deleteMany({});
  await prisma.approvalWorkflow.deleteMany({});
  await prisma.aiActionProposal.deleteMany({});
  await prisma.risk.deleteMany({});
  await prisma.changeRequest.deleteMany({});
  await prisma.baselineVersion.deleteMany({ where: { projectId } });
  await prisma.task.deleteMany({ where: { projectId, id: { not: taskId } } });
  await prisma.task.update({ where: { id: taskId }, data: { planStart: new Date('2030-02-01'), planEnd: new Date('2030-02-06'), baselineStart: null, baselineFinish: null, progressPct: 0 } });
  await prisma.project.update({ where: { id: projectId }, data: { baselineLockedAt: null, baselineLockedById: null } });
});

const reqFor = (proposalId: string) => prisma.approvalRequest.findFirst({ where: { entityId: proposalId } });

const plan = (goal: string, steps: { actionType: string; params: unknown; rationale?: string }[]) => ({ goal, steps });

describe('Autopilot — multi-step AI plans (EXECUTE_PLAN)', () => {
  it('503 when the global gate is off (ANTHROPIC_API_KEY unset)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(proposeAction({ projectId, actionType: 'EXECUTE_PLAN', params: plan('do a thing', [{ actionType: 'TIDY_SCHEDULE', params: { mode: 'push' } }]) }, pmId))
      .rejects.toMatchObject({ statusCode: 503 });
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('403 when the tenant enabled actions but NOT autopilot (separate opt-in)', async () => {
    // A single action is allowed on this tenant…
    await expect(proposeAction({ projectId: actionsOnlyProjectId, actionType: 'CREATE_RISK', params: { title: 'Allowed risk', probabilityScore: 2, impactScore: 2 } }, pmId))
      .resolves.toMatchObject({ routed: true });
    // …but a multi-step plan needs the stronger autopilot consent → 403.
    await expect(proposeAction({ projectId: actionsOnlyProjectId, actionType: 'EXECUTE_PLAN', params: plan('multi', [{ actionType: 'TIDY_SCHEDULE', params: { mode: 'push' } }]) }, pmId))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('400 on an empty plan (no steps)', async () => {
    await expect(proposeAction({ projectId, actionType: 'EXECUTE_PLAN', params: plan('empty', []) }, pmId))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('400 when a step tries to nest another plan (no recursion)', async () => {
    await expect(proposeAction({ projectId, actionType: 'EXECUTE_PLAN', params: plan('nested', [{ actionType: 'EXECUTE_PLAN', params: plan('inner', []) }]) }, pmId))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('400 when a step carries invalid params for its action type', async () => {
    await expect(proposeAction({ projectId, actionType: 'EXECUTE_PLAN', params: plan('bad', [{ actionType: 'CREATE_RISK', params: { title: 'x', probabilityScore: 9, impactScore: 1 } }]) }, pmId))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('400 when a plan exceeds the step cap (>12)', async () => {
    const steps = Array.from({ length: 13 }, () => ({ actionType: 'TIDY_SCHEDULE', params: { mode: 'push' } }));
    await expect(proposeAction({ projectId, actionType: 'EXECUTE_PLAN', params: plan('too many', steps) }, pmId))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('an ALL-SCHEDULE plan applies directly on an unlocked baseline (create task + reschedule)', async () => {
    const { id, applied, routed } = await proposeAction({ projectId, actionType: 'EXECUTE_PLAN', params: plan('build out and shift', [
      { actionType: 'CREATE_TASK', params: { name: 'AP UAT', startDate: '2030-05-01', durationDays: 2 }, rationale: 'add UAT' },
      { actionType: 'RESCHEDULE_TASK', params: { taskId, startDate: '2030-03-01' }, rationale: 'shift design' },
    ]) }, pmId);
    expect(applied).toBe(true);
    expect(routed).toBe(false);
    expect(await reqFor(id)).toBeNull(); // applied outright, no approval row
    expect((await prisma.aiActionProposal.findUnique({ where: { id } }))?.status).toBe('APPLIED');
    // Both steps landed, in order.
    expect(await prisma.task.findFirst({ where: { projectId, name: 'AP UAT' } })).toBeTruthy();
    expect((await prisma.task.findUnique({ where: { id: taskId } }))?.planStart.toISOString().slice(0, 10)).toBe('2030-03-01');
  });

  it('a MIXED plan (schedule + risk) always routes for approval even when unlocked, then applies every step', async () => {
    const { id, applied, routed } = await proposeAction({ projectId, actionType: 'EXECUTE_PLAN', params: plan('shift and log a risk', [
      { actionType: 'RESCHEDULE_TASK', params: { taskId, startDate: '2030-04-01' } },
      { actionType: 'CREATE_RISK', params: { title: 'Schedule shift risk', probabilityScore: 3, impactScore: 3 } },
    ]) }, pmId);
    expect(applied).toBe(false);
    expect(routed).toBe(true); // a non-schedule step forces a human sign-off
    // Nothing applied yet.
    expect((await prisma.task.findUnique({ where: { id: taskId } }))?.planStart.toISOString().slice(0, 10)).toBe('2030-02-01');
    expect(await prisma.risk.count({ where: { projectId } })).toBe(0);

    const req = await reqFor(id);
    await decideApproval(req!.id, adminId, 'APPROVED');
    expect((await prisma.aiActionProposal.findUnique({ where: { id } }))?.status).toBe('APPLIED');
    expect((await prisma.task.findUnique({ where: { id: taskId } }))?.planStart.toISOString().slice(0, 10)).toBe('2030-04-01');
    expect((await prisma.risk.findFirst({ where: { projectId } }))?.title).toBe('Schedule shift risk');
  });

  it('a plan on a LOCKED baseline routes, then applies EVERY schedule step under a SINGLE controlled re-baseline', async () => {
    await prisma.project.update({ where: { id: projectId }, data: { baselineLockedAt: new Date(), baselineLockedById: pmId } });
    const versionsBefore = await prisma.baselineVersion.count({ where: { projectId } });

    const { id, applied, routed } = await proposeAction({ projectId, actionType: 'EXECUTE_PLAN', params: plan('recover the slip', [
      { actionType: 'CREATE_TASK', params: { name: 'AP Recovery', startDate: '2031-01-01', durationDays: 4 } },
      { actionType: 'RESCHEDULE_TASK', params: { taskId, startDate: '2031-02-01' } },
    ]) }, pmId);
    expect(applied).toBe(false);
    expect(routed).toBe(true);

    const req = await reqFor(id);
    await decideApproval(req!.id, adminId, 'APPROVED');
    expect((await prisma.aiActionProposal.findUnique({ where: { id } }))?.status).toBe('APPLIED');

    // Both writes landed and were re-baselined…
    const added = await prisma.task.findFirst({ where: { projectId, name: 'AP Recovery' } });
    expect(added!.baselineStart?.getTime()).toBe(added!.planStart.getTime());
    const moved = await prisma.task.findUnique({ where: { id: taskId } });
    expect(moved!.planStart.toISOString().slice(0, 10)).toBe('2031-02-01');
    expect(moved!.baselineStart?.getTime()).toBe(moved!.planStart.getTime());
    // …the project stayed locked and captured EXACTLY ONE new revision for the whole plan (not one per step).
    expect((await prisma.project.findUnique({ where: { id: projectId } }))!.baselineLockedAt).not.toBeNull();
    expect(await prisma.baselineVersion.count({ where: { projectId } })).toBe(versionsBefore + 1);
  });

  it('stop-on-first-failure: a failing step aborts the plan (FAILED, failureNote names the step)', async () => {
    // All-schedule + unlocked → direct-apply path; step 2 targets a non-existent task → throws.
    await expect(proposeAction({ projectId, actionType: 'EXECUTE_PLAN', params: plan('will fail mid-way', [
      { actionType: 'CREATE_TASK', params: { name: 'AP Before Fail', startDate: '2030-06-01', durationDays: 1 } },
      { actionType: 'RESCHEDULE_TASK', params: { taskId: '00000000-0000-0000-0000-000000000000', startDate: '2030-07-01' } },
    ]) }, pmId)).rejects.toMatchObject({ statusCode: 400 });
    // The proposal is stamped FAILED with a step-numbered note.
    const failed = await prisma.aiActionProposal.findFirst({ where: { projectId, actionType: 'EXECUTE_PLAN' }, orderBy: { createdAt: 'desc' } });
    expect(failed?.status).toBe('FAILED');
    expect(failed?.failureNote).toContain('step 2');
  });

  it('rejecting a routed plan marks it REJECTED and applies nothing', async () => {
    const { id } = await proposeAction({ projectId, actionType: 'EXECUTE_PLAN', params: plan('should not run', [
      { actionType: 'CREATE_RISK', params: { title: 'Nope risk', probabilityScore: 2, impactScore: 2 } },
    ]) }, pmId);
    const req = await reqFor(id);
    await decideApproval(req!.id, pmId, 'REJECTED');
    expect((await prisma.aiActionProposal.findUnique({ where: { id } }))?.status).toBe('REJECTED');
    expect(await prisma.risk.count({ where: { projectId, title: 'Nope risk' } })).toBe(0);
  });

  it('POST /ai-actions/propose accepts an EXECUTE_PLAN (201) and applies an all-schedule plan directly', async () => {
    const res = await request(app)
      .post(api(`/projects/${projectId}/ai-actions/propose`))
      .set(bearer(pmToken))
      .send({ actionType: 'EXECUTE_PLAN', params: plan('http plan', [
        { actionType: 'TIDY_SCHEDULE', params: { mode: 'push' } },
        { actionType: 'RESCHEDULE_TASK', params: { taskId, startDate: '2030-08-01' } },
      ]), rationale: 'via HTTP' });
    expect(res.status).toBe(201);
    expect(res.body.applied).toBe(true);
    expect((await prisma.task.findUnique({ where: { id: taskId } }))?.planStart.toISOString().slice(0, 10)).toBe('2030-08-01');
  });

  it('POST /ai-actions/propose EXECUTE_PLAN is 403 for a read-only VIEWER', async () => {
    const res = await request(app)
      .post(api(`/projects/${projectId}/ai-actions/propose`))
      .set(bearer(viewerToken))
      .send({ actionType: 'EXECUTE_PLAN', params: plan('nope', [{ actionType: 'TIDY_SCHEDULE', params: {} }]) });
    expect(res.status).toBe(403);
  });
});
