import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { __setMailSink, type MailMessage } from '../../lib/mailer.js';
import { createChangeRequest } from '../charter/charter.service.js';
import { createWorkflow, decideApproval, escalateOverdueApprovals } from '../approval/approval.service.js';

// Transactional approval emails: approvers get a "needs your approval" mail (deep-linked to the
// focused inbox), the requester gets an "under review" receipt then an "approved/rejected" mail
// (deep-linked to the entity's tab), and escalation targets get an "overdue" mail. Best-effort and
// dormant unless SMTP is configured — armed here via SMTP_HOST + MAIL_FROM, routed to a sink.

let adminId = '', pmId = '', financeId = '', projectId = '';
let pmEmail = '', adminEmail = '';
let captured: MailMessage[] = [];
const to = (addr: string) => captured.filter((m) => m.to === addr);

const crInput = () => ({ title: 'Ganti rencana', description: 'krn alasan', chargeable: false, magnitude: 'MAJOR' as const, impactAreas: ['QUALITY'] as ['QUALITY'] });

describe('approval emails', () => {
  beforeAll(async () => {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((x) => `"${x.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

    const admin = await prisma.user.create({ data: { name: 'AE Admin', email: 'ae-admin@corp.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
    const pm = await prisma.user.create({ data: { name: 'AE PM', email: 'ae-pm@corp.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    const finance = await prisma.user.create({ data: { name: 'AE Finance', email: 'ae-fin@corp.test', role: 'FINANCE', passwordHash: await hashPassword('x'), isActive: true } });
    adminId = admin.id; pmId = pm.id; financeId = finance.id; pmEmail = pm.email; adminEmail = admin.email;

    const project = await prisma.project.create({ data: { code: 'AE-1', name: 'Email Test', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id } });
    projectId = project.id;
    await prisma.projectCharter.create({
      data: { projectId, description: 'd', goals: 'g', category: 'APP_DEV', hiScope: 's', hiCostIdr: 1000, hiScheduleStart: new Date(), hiScheduleEnd: new Date(), hiDeliverables: 'x', pmUserId: pm.id, locked: true },
    });

    process.env.SMTP_HOST = 'smtp.test';
    process.env.MAIL_FROM = 'Prismatix <no-reply@test>';
    __setMailSink((m) => captured.push(m));
  });
  afterAll(() => {
    __setMailSink(null);
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_FROM;
  });

  beforeEach(async () => {
    captured = [];
    await prisma.approvalRequest.deleteMany({});
    await prisma.approvalWorkflow.deleteMany({});
    await prisma.changeRequest.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.project.update({ where: { id: projectId }, data: { baselineLockedAt: null, baselineLockedById: null, status: 'IN_PROGRESS' } });
  });

  it('emails the approver (pending, deep-linked to the focused inbox) + the requester (under review)', async () => {
    await createWorkflow({ name: 'PM gate', steps: [{ name: 'PM sign-off', mode: 'ANY', approvers: [{ kind: 'PROJECT_PM' }] }] }, adminId);
    const cr = await createChangeRequest(projectId, crInput(), adminId); // requester = admin
    const req = await prisma.approvalRequest.findFirst({ where: { entityId: cr.id } });

    const pending = to(pmEmail).find((m) => m.subject.includes('Persetujuan diperlukan'));
    expect(pending).toBeTruthy();
    expect(pending!.html).toContain(`/approvals?focus=${req!.id}`);
    expect(pending!.html).toContain('PM sign-off');

    const review = to(adminEmail).find((m) => m.subject.includes('sedang ditinjau'));
    expect(review).toBeTruthy();
    expect(review!.html).toContain(`/projects/${projectId}?tab=`);
  });

  it('emails the requester when the item is APPROVED (deep-linked to the entity tab)', async () => {
    await createWorkflow({ name: 'PM gate', steps: [{ name: 'PM', mode: 'ANY', approvers: [{ kind: 'PROJECT_PM' }] }] }, adminId);
    const cr = await createChangeRequest(projectId, crInput(), adminId);
    const req = await prisma.approvalRequest.findFirst({ where: { entityId: cr.id } });
    captured = []; // ignore the creation-time emails

    await decideApproval(req!.id, pmId, 'APPROVED'); // decider = PM, requester = admin

    const decided = to(adminEmail).find((m) => m.subject.includes('disetujui'));
    expect(decided).toBeTruthy();
    expect(decided!.html).toContain(`/projects/${projectId}?tab=`);
    // No spurious rejected mail.
    expect(to(adminEmail).some((m) => m.subject.includes('ditolak'))).toBe(false);
  });

  it('emails the requester when the item is REJECTED', async () => {
    await createWorkflow({ name: 'PM gate', steps: [{ name: 'PM', mode: 'ANY', approvers: [{ kind: 'PROJECT_PM' }] }] }, adminId);
    const cr = await createChangeRequest(projectId, crInput(), adminId);
    const req = await prisma.approvalRequest.findFirst({ where: { entityId: cr.id } });
    captured = [];

    await decideApproval(req!.id, pmId, 'REJECTED', 'not now');

    expect(to(adminEmail).some((m) => m.subject.includes('ditolak'))).toBe(true);
  });

  it('emails escalation targets when an approval blows its SLA', async () => {
    await createWorkflow({ name: 'Finance gate', steps: [{ name: 'Finance', mode: 'ANY', approvers: [{ kind: 'ROLE', role: 'FINANCE' }], slaHours: 1 }] }, adminId);
    await createChangeRequest(projectId, crInput(), adminId);
    captured = [];

    // No escalationUserId → ADMINs are the target. Escalate as-of well past the 1h SLA.
    const r = await escalateOverdueApprovals(new Date(Date.now() + 5 * 3600_000));
    expect(r.escalated).toBeGreaterThanOrEqual(1);

    const overdue = to(adminEmail).find((m) => m.subject.includes('melewati tenggat'));
    expect(overdue).toBeTruthy();
    expect(overdue!.html).toContain('/approvals?focus=');
  });

  it('respects the per-user approval-email opt-out (notificationPrefs.email.approvals=false)', async () => {
    await prisma.user.update({ where: { id: pmId }, data: { notificationPrefs: { email: { approvals: false } } } });
    try {
      await createWorkflow({ name: 'PM gate', steps: [{ name: 'PM', mode: 'ANY', approvers: [{ kind: 'PROJECT_PM' }] }] }, adminId);
      await createChangeRequest(projectId, crInput(), adminId); // PM is the approver but opted out
      expect(to(pmEmail).length).toBe(0); // no approval email to the opted-out PM
      // The requester (admin) still gets their under-review receipt (default ON).
      expect(to(adminEmail).some((m) => m.subject.includes('sedang ditinjau'))).toBe(true);
    } finally {
      await prisma.user.update({ where: { id: pmId }, data: { notificationPrefs: { email: { approvals: true } } } });
    }
  });

  it('sends nothing when SMTP is not configured (dormant)', async () => {
    delete process.env.SMTP_HOST; // disarm emailEnabled(); sink stays but the approval path gates on emailEnabled()
    try {
      await createWorkflow({ name: 'PM gate', steps: [{ name: 'PM', mode: 'ANY', approvers: [{ kind: 'PROJECT_PM' }] }] }, adminId);
      await createChangeRequest(projectId, crInput(), adminId);
      expect(captured).toHaveLength(0);
    } finally {
      process.env.SMTP_HOST = 'smtp.test';
    }
  });
});
