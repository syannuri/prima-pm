import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { __setMailSink, type MailMessage } from '../../lib/mailer.js';
import { decideChangeRequest } from '../charter/charter.service.js';

// CR-approved → re-baseline flow: on approval of a CR that touches cost/schedule while the baseline
// is locked, the baseline is opened, the PM gets an in-app notice deep-linked to the CR's target tab
// with a re-baseline/re-lock reminder, and an email (Indonesian) — honouring the approval opt-out.
let pmId = '', pmoId = '', pmEmail = '', projectId = '';
let captured: MailMessage[] = [];
const toPm = () => captured.filter((m) => m.to === pmEmail);
let seq = 0;

async function cr(impactAreas: string[], title: string) {
  seq += 1;
  return prisma.changeRequest.create({
    data: { projectId, type: impactAreas[0] ?? 'SCOPE', title, description: 'd', requestedBy: pmId, status: 'SUBMITTED', magnitude: 'MAJOR', impactAreas: impactAreas as never, chargeable: false },
  });
}
const lockBaseline = () => prisma.project.update({ where: { id: projectId }, data: { baselineLockedAt: new Date(), baselineLockedById: pmId } });

describe('CR approved → re-baseline reminder + email', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const pm = await prisma.user.create({ data: { name: 'CR PM', email: 'cr-pm@corp.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    const pmo = await prisma.user.create({ data: { name: 'CR PMO', email: 'cr-pmo@corp.test', role: 'PMO', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id; pmoId = pmo.id; pmEmail = pm.email;
    const p = await prisma.project.create({ data: { code: 'CRRB-1', name: 'ReBaseline Test', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id } });
    projectId = p.id;
    process.env.SMTP_HOST = 'smtp.test'; process.env.MAIL_FROM = 'Prismatix <no-reply@test>';
    __setMailSink((m) => captured.push(m));
  });
  afterAll(() => { __setMailSink(null); delete process.env.SMTP_HOST; delete process.env.MAIL_FROM; });
  beforeEach(async () => {
    captured = [];
    await prisma.notification.deleteMany({});
    await prisma.changeRequest.deleteMany({});
    await prisma.user.update({ where: { id: pmId }, data: { notificationPrefs: { email: { approvals: true } } } });
  });

  it('opens the baseline, points the PM at the SCHEDULE tab, reminds to re-lock on Cost, and emails', async () => {
    await lockBaseline();
    const c = await cr(['SCHEDULE'], 'Extend UAT window');
    await decideChangeRequest(projectId, c.id, 'APPROVED', pmoId); // PMO decides; PM is the requester

    // Baseline opened to apply the change.
    expect((await prisma.project.findUnique({ where: { id: projectId } }))?.baselineLockedAt).toBeNull();

    // In-app: deep-links to the CR target (Schedule) + re-lock reminder mentioning Cost.
    const n = await prisma.notification.findFirst({ where: { userId: pmId, type: 'CR_APPROVED' } });
    expect(n).toBeTruthy();
    expect(n!.link).toContain('tab=Schedule');
    expect(n!.body).toMatch(/re-baseline|Cost tab/i);

    // Email to the PM, Indonesian, with the re-lock guidance + link.
    const mail = toPm().find((m) => m.subject.includes('approved'));
    expect(mail).toBeTruthy();
    expect(mail!.html).toMatch(/re-baseline|lock/i);
    expect(mail!.html).toContain(`?tab=Schedule`);
  });

  it('no re-lock reminder when the CR does not touch cost/schedule', async () => {
    await lockBaseline();
    const c = await cr(['QUALITY'], 'Tighten acceptance criteria');
    await decideChangeRequest(projectId, c.id, 'APPROVED', pmoId);
    expect((await prisma.project.findUnique({ where: { id: projectId } }))?.baselineLockedAt).not.toBeNull(); // stays locked
    const n = await prisma.notification.findFirst({ where: { userId: pmId, type: 'CR_APPROVED' } });
    expect(n!.link).toContain('tab=Change'); // Change Req target
    expect(n!.body).not.toMatch(/re-baseline/i);
  });

  it('respects the approval-email opt-out (in-app still fires, no email)', async () => {
    await prisma.user.update({ where: { id: pmId }, data: { notificationPrefs: { email: { approvals: false } } } });
    await lockBaseline();
    const c = await cr(['COST'], 'Add reporting module');
    await decideChangeRequest(projectId, c.id, 'APPROVED', pmoId);
    expect(await prisma.notification.findFirst({ where: { userId: pmId, type: 'CR_APPROVED' } })).toBeTruthy(); // in-app still
    expect(toPm().length).toBe(0); // but no email
  });
});
