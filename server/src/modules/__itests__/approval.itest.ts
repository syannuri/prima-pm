import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { createChangeRequest } from '../charter/charter.service.js';
import { createWorkflow, decideApproval, listMyApprovals, resolveWorkflowForCr } from '../approval/approval.service.js';

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
  await prisma.changeRequest.deleteMany({});
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
