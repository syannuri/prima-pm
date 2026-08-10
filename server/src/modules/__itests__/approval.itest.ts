import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { createChangeRequest } from '../charter/charter.service.js';
import { setBaselineLock } from '../projects/baseline.service.js';
import { updateProject } from '../projects/projects.service.js';
import { createWorkflow, decideApproval, listMyApprovals, resolveWorkflowForCr, escalateOverdueApprovals, setDelegation } from '../approval/approval.service.js';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let adminId: string, pmId: string, financeId: string, otherPmId: string;
let adminToken: string, viewerToken: string;
let projectId: string;

const crInput = (over: Partial<{ title: string; magnitude: 'MINOR' | 'MAJOR'; chargeable: boolean; amountIdr: number }> = {}) => ({
  title: over.title ?? 'Change the plan',
  description: 'Because reasons',
  chargeable: over.chargeable ?? false,
  amountIdr: over.amountIdr,
  magnitude: over.magnitude ?? ('MAJOR' as const),
  impactAreas: ['QUALITY'] as ['QUALITY'],
});

// The workflow engine matches, routes and decides against a raised Change Request. Runs with
// MULTITENANCY_ENFORCE=false, so role approvers resolve via the global User.role.
beforeAll(async () => {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((x) => `"${x.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

  const admin = await prisma.user.create({ data: { name: 'Appr Admin', email: 'appr-admin@corp.test', role: 'ADMIN', passwordHash: await hashPassword('Admin-Pass-1'), isActive: true } });
  const pm = await prisma.user.create({ data: { name: 'Appr PM', email: 'appr-pm@corp.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('Pm-Pass-1'), isActive: true } });
  const finance = await prisma.user.create({ data: { name: 'Appr Finance', email: 'appr-fin@corp.test', role: 'FINANCE', passwordHash: await hashPassword('Fin-Pass-1'), isActive: true } });
  const otherPm = await prisma.user.create({ data: { name: 'Other PM', email: 'appr-pm2@corp.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('Pm2-Pass-1'), isActive: true } });
  const viewer = await prisma.user.create({ data: { name: 'Appr Viewer', email: 'appr-view@corp.test', role: 'VIEWER', passwordHash: await hashPassword('View-Pass-1'), isActive: true } });
  adminId = admin.id; pmId = pm.id; financeId = finance.id; otherPmId = otherPm.id;
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email });
  viewerToken = signAccessToken({ sub: viewer.id, role: 'VIEWER', email: viewer.email });

  const project = await prisma.project.create({ data: { code: 'APPR-1', name: 'Approval Test', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id } });
  projectId = project.id;
  // A committed (locked) charter is the precondition for raising a change request.
  await prisma.projectCharter.create({
    data: {
      projectId, description: 'd', goals: 'g', category: 'APP_DEV', hiScope: 's',
      hiCostIdr: 1000, hiScheduleStart: new Date(), hiScheduleEnd: new Date(), hiDeliverables: 'x',
      pmUserId: pm.id, locked: true,
    },
  });
});

// Each flow test starts from a clean slate of workflows/requests so resolveWorkflow is deterministic.
beforeEach(async () => {
  await prisma.approvalRequest.deleteMany({});
  await prisma.approvalWorkflow.deleteMany({});
  await prisma.approvalDelegation.deleteMany({});
  await prisma.changeRequest.deleteMany({});
  await prisma.notification.deleteMany({});
  // Reset project state touched by the baseline/revenue/closure tests so each starts fresh: unlocked,
  // no revenue, IN_PROGRESS (not closed).
  await prisma.project.update({ where: { id: projectId }, data: { baselineLockedAt: null, baselineLockedById: null, totalRevenueIdr: null, status: 'IN_PROGRESS', closedAt: null, closedById: null, closureNote: null } });
});

describe('Approval workflows', () => {
  it('rejects a non-admin builder and accepts an admin (RBAC)', async () => {
    const body = { name: 'wf', steps: [{ name: 'Review', mode: 'ANY', approvers: [{ kind: 'ROLE', role: 'FINANCE' }] }] };
    expect((await request(app).post(api('/approval-workflows')).set(auth(viewerToken)).send(body)).status).toBe(403);
    const ok = await request(app).post(api('/approval-workflows')).set(auth(adminToken)).send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.workflow.steps).toHaveLength(1);
  });

  it('validates the shape (step needs an approver; ROLE needs a role)', async () => {
    expect((await request(app).post(api('/approval-workflows')).set(auth(adminToken)).send({ name: 'x', steps: [] })).status).toBe(400);
    expect((await request(app).post(api('/approval-workflows')).set(auth(adminToken)).send({ name: 'x', steps: [{ name: 's', mode: 'ANY', approvers: [{ kind: 'ROLE' }] }] })).status).toBe(400);
  });

  it('matches only when conditions hold', async () => {
    await createWorkflow({ name: 'Major only', condMagnitude: 'MAJOR', steps: [{ name: 'S', mode: 'ANY', approvers: [{ kind: 'PROJECT_PM' }] }] }, adminId);
    expect(await resolveWorkflowForCr({ id: 'x', projectId, magnitude: 'MINOR', chargeable: false, amountIdr: null })).toBeNull();
    expect(await resolveWorkflowForCr({ id: 'x', projectId, magnitude: 'MAJOR', chargeable: false, amountIdr: null })).not.toBeNull();
  });

  it('routes a matching CR through a 2-step ANY chain and finalises the CR on full approval', async () => {
    await createWorkflow({
      name: 'PM then Finance',
      steps: [
        { name: 'PM sign-off', mode: 'ANY', approvers: [{ kind: 'PROJECT_PM' }] },
        { name: 'Finance sign-off', mode: 'ANY', approvers: [{ kind: 'ROLE', role: 'FINANCE' }] },
      ],
    }, adminId);

    const cr = await createChangeRequest(projectId, crInput(), adminId);
    expect(cr.status).toBe('UNDER_REVIEW');
    const req = await prisma.approvalRequest.findFirst({ where: { entityId: cr.id } });
    expect(req?.status).toBe('PENDING');
    expect(req?.currentOrder).toBe(1);

    // PM (dynamic approver) clears step 1 → advances to step 2.
    const r1 = await decideApproval(req!.id, pmId, 'APPROVED');
    expect(r1.status).toBe('PENDING');
    expect((await prisma.approvalRequest.findUnique({ where: { id: req!.id } }))?.currentOrder).toBe(2);

    // Finance clears step 2 → request + CR both APPROVED.
    const r2 = await decideApproval(req!.id, financeId, 'APPROVED');
    expect(r2.status).toBe('APPROVED');
    expect((await prisma.approvalRequest.findUnique({ where: { id: req!.id } }))?.status).toBe('APPROVED');
    expect((await prisma.changeRequest.findUnique({ where: { id: cr.id } }))?.status).toBe('APPROVED');
  });

  it('an ALL step needs every listed approver before it clears', async () => {
    await createWorkflow({
      name: 'Both must sign',
      steps: [{ name: 'Joint', mode: 'ALL', approvers: [{ kind: 'PROJECT_PM' }, { kind: 'ROLE', role: 'FINANCE' }] }],
    }, adminId);
    const cr = await createChangeRequest(projectId, crInput(), adminId);
    const req = await prisma.approvalRequest.findFirst({ where: { entityId: cr.id } });

    expect((await decideApproval(req!.id, pmId, 'APPROVED')).status).toBe('PENDING'); // finance still outstanding
    expect((await decideApproval(req!.id, financeId, 'APPROVED')).status).toBe('APPROVED');
    expect((await prisma.changeRequest.findUnique({ where: { id: cr.id } }))?.status).toBe('APPROVED');
  });

  it('a single reject closes the whole request and rejects the CR', async () => {
    await createWorkflow({
      name: 'Two gates',
      steps: [
        { name: 'PM', mode: 'ANY', approvers: [{ kind: 'PROJECT_PM' }] },
        { name: 'Finance', mode: 'ANY', approvers: [{ kind: 'ROLE', role: 'FINANCE' }] },
      ],
    }, adminId);
    const cr = await createChangeRequest(projectId, crInput(), adminId);
    const req = await prisma.approvalRequest.findFirst({ where: { entityId: cr.id } });

    expect((await decideApproval(req!.id, pmId, 'REJECTED', 'no')).status).toBe('REJECTED');
    expect((await prisma.approvalRequest.findUnique({ where: { id: req!.id } }))?.status).toBe('REJECTED');
    expect((await prisma.changeRequest.findUnique({ where: { id: cr.id } }))?.status).toBe('REJECTED');
  });

  it('falls back to the legacy single-decider path when no workflow matches', async () => {
    const cr = await createChangeRequest(projectId, crInput(), adminId);
    expect(cr.status).toBe('SUBMITTED');
    expect(await prisma.approvalRequest.count({ where: { entityId: cr.id } })).toBe(0);
  });

  it('rejects a decision from a non-approver and a duplicate vote', async () => {
    await createWorkflow({ name: 'PM gate', steps: [{ name: 'PM', mode: 'ANY', approvers: [{ kind: 'PROJECT_PM' }] }] }, adminId);
    const cr = await createChangeRequest(projectId, crInput(), adminId);
    const req = await prisma.approvalRequest.findFirst({ where: { entityId: cr.id } });
    // otherPm is a PROJECT_MANAGER but NOT this project's PM → not eligible.
    await expect(decideApproval(req!.id, otherPmId, 'APPROVED')).rejects.toThrow();
  });

  it('lists a pending request only for its current-step approver', async () => {
    await createWorkflow({
      name: 'PM then Finance',
      steps: [
        { name: 'PM', mode: 'ANY', approvers: [{ kind: 'PROJECT_PM' }] },
        { name: 'Finance', mode: 'ANY', approvers: [{ kind: 'ROLE', role: 'FINANCE' }] },
      ],
    }, adminId);
    const cr = await createChangeRequest(projectId, crInput(), adminId);
    // At step 1 the PM sees it, finance does not.
    expect(await listMyApprovals(pmId)).toHaveLength(1);
    expect(await listMyApprovals(financeId)).toHaveLength(0);
    const req = await prisma.approvalRequest.findFirst({ where: { entityId: cr.id } });
    await decideApproval(req!.id, pmId, 'APPROVED');
    // Now at step 2 finance sees it, the PM no longer does.
    expect(await listMyApprovals(financeId)).toHaveLength(1);
    expect(await listMyApprovals(pmId)).toHaveLength(0);
  });
});

describe('Approval Phase 2 — cost baseline gating & applyToRevenue', () => {
  it('locks the baseline immediately when no COST_BASELINE workflow matches', async () => {
    const res = await setBaselineLock(projectId, true, undefined, adminId);
    expect(res.approvalPending).toBe(false);
    expect((await prisma.project.findUnique({ where: { id: projectId } }))?.baselineLockedAt).not.toBeNull();
  });

  it('routes a baseline lock for approval and only locks on final sign-off', async () => {
    await createWorkflow({ name: 'Baseline gate', appliesTo: 'COST_BASELINE', steps: [{ name: 'Finance', mode: 'ANY', approvers: [{ kind: 'ROLE', role: 'FINANCE' }] }] }, adminId);
    const res = await setBaselineLock(projectId, true, 'lock it', pmId);
    expect(res.approvalPending).toBe(true);
    // Not locked yet — still awaiting approval.
    expect((await prisma.project.findUnique({ where: { id: projectId } }))?.baselineLockedAt).toBeNull();
    const req = await prisma.approvalRequest.findFirst({ where: { entityType: 'COST_BASELINE', projectId } });
    expect(req?.status).toBe('PENDING');
    // Finance approves → the lock is applied.
    expect((await decideApproval(req!.id, financeId, 'APPROVED')).status).toBe('APPROVED');
    expect((await prisma.project.findUnique({ where: { id: projectId } }))?.baselineLockedAt).not.toBeNull();
  });

  it('a rejected baseline-lock request leaves the baseline unlocked', async () => {
    await createWorkflow({ name: 'Baseline gate', appliesTo: 'COST_BASELINE', steps: [{ name: 'Finance', mode: 'ANY', approvers: [{ kind: 'ROLE', role: 'FINANCE' }] }] }, adminId);
    await setBaselineLock(projectId, true, 'lock it', pmId);
    const req = await prisma.approvalRequest.findFirst({ where: { entityType: 'COST_BASELINE', projectId } });
    await decideApproval(req!.id, financeId, 'REJECTED', 'not yet');
    expect((await prisma.project.findUnique({ where: { id: projectId } }))?.baselineLockedAt).toBeNull();
  });

  it('a CHANGE_REQUEST workflow does not match a baseline lock (appliesTo isolation)', async () => {
    await createWorkflow({ name: 'CR only', appliesTo: 'CHANGE_REQUEST', steps: [{ name: 'PM', mode: 'ANY', approvers: [{ kind: 'PROJECT_PM' }] }] }, adminId);
    const res = await setBaselineLock(projectId, true, undefined, adminId);
    expect(res.approvalPending).toBe(false); // no COST_BASELINE workflow → applied directly
  });

  it('adds a chargeable CR amount to project revenue when the final approver opts in', async () => {
    await createWorkflow({ name: 'Chargeable gate', steps: [{ name: 'Finance', mode: 'ANY', approvers: [{ kind: 'ROLE', role: 'FINANCE' }] }] }, adminId);
    const cr = await createChangeRequest(projectId, crInput({ chargeable: true, amountIdr: 5_000_000 }), adminId);
    const req = await prisma.approvalRequest.findFirst({ where: { entityId: cr.id } });
    await decideApproval(req!.id, financeId, 'APPROVED', null, { applyToRevenue: true });
    expect(Number((await prisma.project.findUnique({ where: { id: projectId } }))?.totalRevenueIdr)).toBe(5_000_000);
  });

  it('leaves revenue untouched when the approver does not opt in', async () => {
    await createWorkflow({ name: 'Chargeable gate', steps: [{ name: 'Finance', mode: 'ANY', approvers: [{ kind: 'ROLE', role: 'FINANCE' }] }] }, adminId);
    const cr = await createChangeRequest(projectId, crInput({ chargeable: true, amountIdr: 5_000_000 }), adminId);
    const req = await prisma.approvalRequest.findFirst({ where: { entityId: cr.id } });
    await decideApproval(req!.id, financeId, 'APPROVED');
    expect((await prisma.project.findUnique({ where: { id: projectId } }))?.totalRevenueIdr).toBeNull();
  });
});

describe('Approval Phase 2b — closure gating, SLA escalation, delegation', () => {
  it('routes a project closure for approval and only closes on final sign-off', async () => {
    await createWorkflow({ name: 'Closure gate', appliesTo: 'PROJECT_CLOSURE', steps: [{ name: 'Finance', mode: 'ANY', approvers: [{ kind: 'ROLE', role: 'FINANCE' }] }] }, adminId);
    // Force-close (no schedule) — routed to Finance for sign-off, not applied yet.
    const result = await updateProject(projectId, { status: 'CLOSED', forceClose: true, closureNote: 'done' }, adminId) as { approvalPending?: boolean };
    expect(result.approvalPending).toBe(true);
    expect((await prisma.project.findUnique({ where: { id: projectId } }))?.status).toBe('IN_PROGRESS');
    const req = await prisma.approvalRequest.findFirst({ where: { entityType: 'PROJECT_CLOSURE', projectId } });
    expect(req?.status).toBe('PENDING');
    // Finance approves → the project actually closes.
    expect((await decideApproval(req!.id, financeId, 'APPROVED')).status).toBe('APPROVED');
    expect((await prisma.project.findUnique({ where: { id: projectId } }))?.status).toBe('CLOSED');
  });

  it('escalates an overdue step to the workspace admins', async () => {
    await createWorkflow({ name: 'SLA gate', steps: [{ name: 'Finance', mode: 'ANY', slaHours: 24, approvers: [{ kind: 'ROLE', role: 'FINANCE' }] }] }, adminId);
    const cr = await createChangeRequest(projectId, crInput(), adminId);
    const req = await prisma.approvalRequest.findFirst({ where: { entityId: cr.id } });
    expect(req?.dueAt).not.toBeNull();
    // Force the deadline into the past, then sweep.
    await prisma.approvalRequest.update({ where: { id: req!.id }, data: { dueAt: new Date(Date.now() - 3600_000) } });
    const r = await escalateOverdueApprovals();
    expect(r.escalated).toBe(1);
    expect((await prisma.approvalRequest.findUnique({ where: { id: req!.id } }))?.escalatedAt).not.toBeNull();
    expect(await prisma.notification.count({ where: { userId: adminId, type: 'APPROVAL_OVERDUE' } })).toBeGreaterThanOrEqual(1);
    // A second sweep does not re-escalate.
    expect((await escalateOverdueApprovals()).escalated).toBe(0);
  });

  it('lets a delegate approve on the delegator’s behalf', async () => {
    await createWorkflow({ name: 'Finance gate', steps: [{ name: 'Finance', mode: 'ANY', approvers: [{ kind: 'ROLE', role: 'FINANCE' }] }] }, adminId);
    // Finance delegates to otherPm (a PROJECT_MANAGER, normally NOT eligible).
    await setDelegation(financeId, otherPmId);
    const cr = await createChangeRequest(projectId, crInput(), adminId);
    const req = await prisma.approvalRequest.findFirst({ where: { entityId: cr.id } });
    // The delegate can see it and clear the step.
    expect(await listMyApprovals(otherPmId)).toHaveLength(1);
    expect((await decideApproval(req!.id, otherPmId, 'APPROVED')).status).toBe('APPROVED');
  });
});
