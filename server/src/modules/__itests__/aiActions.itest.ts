import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { proposeAction } from '../aiActions/aiActions.service.js';
import { decideApproval } from '../approval/approval.service.js';

// Stage C — AI-proposed actions routed through the approval engine. proposeAction does NOT call the
// LLM (the draft arrives as params), so we only need the env gate on; no fake AiPort. Runs with
// MULTITENANCY_ENFORCE=false, so PROJECT_PM/ROLE approvers resolve via the global User.role.

let adminId: string, pmId: string;
let projectId: string, taskId: string;
let tenantProjectId: string, tenantId: string;
let prevKey: string | undefined;

beforeAll(async () => {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((x) => `"${x.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

  prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';

  const admin = await prisma.user.create({ data: { name: 'AIA Admin', email: 'aia-admin@corp.test', role: 'ADMIN', passwordHash: await hashPassword('Admin-Pass-1'), isActive: true } });
  const pm = await prisma.user.create({ data: { name: 'AIA PM', email: 'aia-pm@corp.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('Pm-Pass-1'), isActive: true } });
  adminId = admin.id; pmId = pm.id;

  const project = await prisma.project.create({ data: { code: 'AIA-1', name: 'AI Actions Test', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id } });
  projectId = project.id;
  await prisma.projectCharter.create({
    data: {
      projectId, description: 'd', goals: 'g', category: 'APP_DEV', hiScope: 's',
      hiCostIdr: 1000, hiScheduleStart: new Date(), hiScheduleEnd: new Date(), hiDeliverables: 'x',
      pmUserId: pm.id, locked: true,
    },
  });
  const task = await prisma.task.create({ data: { projectId, wbsCode: '1', name: 'Design', planStart: new Date(), planEnd: new Date(Date.now() + 5 * 86_400_000), progressPct: 0 } });
  taskId = task.id;

  // A tenant-scoped project to exercise the per-tenant opt-in gate.
  const tenant = await prisma.tenant.create({ data: { name: 'AIA Tenant', slug: 'aia-tenant', aiActionsEnabled: false } });
  tenantId = tenant.id;
  const tp = await prisma.project.create({ data: { code: 'AIA-T', name: 'Tenant Proj', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id, tenantId } });
  tenantProjectId = tp.id;
});

afterAll(async () => {
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
});

// Fresh slate of proposals/workflows/requests before each test so routing is deterministic.
beforeEach(async () => {
  await prisma.approvalRequest.deleteMany({});
  await prisma.approvalWorkflow.deleteMany({});
  await prisma.aiActionProposal.deleteMany({});
  await prisma.risk.deleteMany({});
  await prisma.changeRequest.deleteMany({});
  await prisma.task.update({ where: { id: taskId }, data: { progressPct: 0 } });
});

const reqFor = (proposalId: string) => prisma.approvalRequest.findFirst({ where: { entityId: proposalId } });

describe('Stage C — AI-proposed actions', () => {
  it('503 when the global gate is off (ANTHROPIC_API_KEY unset)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(proposeAction({ projectId, actionType: 'CREATE_RISK', params: { title: 'Vendor slip', probabilityScore: 3, impactScore: 4 } }, pmId))
      .rejects.toMatchObject({ statusCode: 503 });
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('403 when the tenant has not opted in (aiActionsEnabled=false)', async () => {
    await expect(proposeAction({ projectId: tenantProjectId, actionType: 'CREATE_RISK', params: { title: 'X risk', probabilityScore: 2, impactScore: 2 } }, pmId))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('400 on invalid action parameters', async () => {
    await expect(proposeAction({ projectId, actionType: 'CREATE_RISK', params: { title: 'no', probabilityScore: 9, impactScore: 1 } }, pmId))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('400 on unknown action type', async () => {
    await expect(proposeAction({ projectId, actionType: 'DELETE_PROJECT', params: {} }, pmId))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('proposes CREATE_RISK, routes to the seeded default workflow, and applies on approval', async () => {
    const { id, routed } = await proposeAction(
      { projectId, actionType: 'CREATE_RISK', params: { title: 'Vendor delivery may slip', probabilityScore: 4, impactScore: 3, kind: 'THREAT' }, rationale: 'SPI trending down' },
      pmId,
    );
    expect(routed).toBe(true);
    // A default AI_ACTION workflow was auto-seeded.
    expect(await prisma.approvalWorkflow.count({ where: { appliesTo: 'AI_ACTION' } })).toBe(1);
    // Nothing applied yet — still PENDING, no risk row.
    expect((await prisma.aiActionProposal.findUnique({ where: { id } }))?.status).toBe('PENDING');
    expect(await prisma.risk.count({ where: { projectId } })).toBe(0);

    const req = await reqFor(id);
    const res = await decideApproval(req!.id, pmId, 'APPROVED'); // PM is a PROJECT_PM approver
    expect(res.status).toBe('APPROVED');
    expect((await prisma.aiActionProposal.findUnique({ where: { id } }))?.status).toBe('APPLIED');
    const risk = await prisma.risk.findFirst({ where: { projectId } });
    expect(risk?.title).toBe('Vendor delivery may slip');
    expect(risk?.probabilityScore).toBe(4);
  });

  it('proposes UPDATE_TASK_PROGRESS and applies the real progress on approval', async () => {
    const { id } = await proposeAction({ projectId, actionType: 'UPDATE_TASK_PROGRESS', params: { taskId, progressPct: 60 } }, pmId);
    const req = await reqFor(id);
    await decideApproval(req!.id, adminId, 'APPROVED'); // ADMIN is also an approver on the default step
    expect((await prisma.task.findUnique({ where: { id: taskId } }))?.progressPct).toBe(60);
    expect((await prisma.aiActionProposal.findUnique({ where: { id } }))?.status).toBe('APPLIED');
  });

  it('rejecting a proposal marks it REJECTED and applies nothing', async () => {
    const { id } = await proposeAction({ projectId, actionType: 'CREATE_RISK', params: { title: 'Should not exist', probabilityScore: 2, impactScore: 2 } }, pmId);
    const req = await reqFor(id);
    const res = await decideApproval(req!.id, pmId, 'REJECTED');
    expect(res.status).toBe('REJECTED');
    expect((await prisma.aiActionProposal.findUnique({ where: { id } }))?.status).toBe('REJECTED');
    expect(await prisma.risk.count({ where: { projectId, title: 'Should not exist' } })).toBe(0);
  });
});
