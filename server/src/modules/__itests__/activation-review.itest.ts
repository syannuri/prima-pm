import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { getActivationReview, getAwaitingActivation } from '../projects/activation.js';
import { decideActivation, resubmitActivation } from '../projects/projects.service.js';

// PMO activation-review flow: summary card + Approve / Reject / Needs-revision + PM resubmit.
let adminId = '';
let pmId = '';
let seq = 0;

// A CHARTERED, activation-ready (baseline locked, no WBS) project with a committed charter +
// cost baseline, so getActivationReview has scope/budget to show and it can be approved.
async function charteredProject() {
  seq += 1;
  const p = await prisma.project.create({
    data: { code: `PRJ-ACT-${String(seq).padStart(4, '0')}`, name: `Activation ${seq}`, status: 'CHARTERED', deliveryApproach: 'PREDICTIVE', pmUserId: pmId, baselineLockedAt: new Date() },
  });
  await prisma.projectCharter.create({
    data: { projectId: p.id, description: 'd', goals: 'g', category: 'APP_DEV', hiScope: 'Build the thing', hiDeliverables: 'A working app', hiCostIdr: 1_000_000, hiScheduleStart: new Date('2026-08-01'), hiScheduleEnd: new Date('2026-12-01'), pmUserId: pmId, locked: true, committedAt: new Date() },
  });
  await prisma.costBaseline.create({
    data: { projectId: p.id, directTotal: 800_000, indirectTotal: 100_000, contingencyReserve: 100_000, costBaseline: 1_000_000, budgetAtCompletion: 1_000_000 },
  });
  return p.id;
}

describe('PMO activation review', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const admin = await prisma.user.create({ data: { name: 'Rev Admin', email: 'rev-admin@t.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
    adminId = admin.id;
    const pm = await prisma.user.create({ data: { name: 'Rev PM', email: 'rev-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id;
  });

  it('summary returns scope (charter), budget (cost baseline), schedule + readiness', async () => {
    const id = await charteredProject();
    const r = await getActivationReview(id);
    expect(r.charter?.scope).toBe('Build the thing');
    expect(r.budget?.bac).toBe(1_000_000);
    expect(r.schedule.hasWbs).toBe(false);
    expect(r.readiness.canActivate).toBe(true);
  });

  it('APPROVE activates the project and clears any review state', async () => {
    const id = await charteredProject();
    await decideActivation(id, 'APPROVE', adminId, {});
    const p = await prisma.project.findUnique({ where: { id } });
    expect(p?.status).toBe('IN_PROGRESS');
    expect(p?.activationReviewStatus).toBeNull();
  });

  it('NEEDS_REVISION keeps it CHARTERED, records the note, notifies the PM, and drops it from the queue', async () => {
    const id = await charteredProject();
    await decideActivation(id, 'NEEDS_REVISION', adminId, { reason: 'tighten scope' });
    const p = await prisma.project.findUnique({ where: { id } });
    expect(p?.status).toBe('CHARTERED');
    expect(p?.activationReviewStatus).toBe('NEEDS_REVISION');
    expect(p?.activationReviewNote).toBe('tighten scope');
    const notif = await prisma.notification.findFirst({ where: { userId: pmId, projectId: id, type: 'ACTIVATION_REVISION' } });
    expect(notif).toBeTruthy();
    const queue = await getAwaitingActivation('PMO');
    expect(queue.items.some((x) => x.id === id)).toBe(false);
  });

  it('REJECT / NEEDS_REVISION require a reason', async () => {
    const id = await charteredProject();
    await expect(decideActivation(id, 'REJECT', adminId, {})).rejects.toThrow(/reason/i);
  });

  it('resubmit clears the review, re-enters the PMO queue and notifies ADMIN/PMO', async () => {
    const id = await charteredProject();
    await decideActivation(id, 'REJECT', adminId, { reason: 'not yet' });
    expect((await getAwaitingActivation('PMO')).items.some((x) => x.id === id)).toBe(false);

    await resubmitActivation(id, pmId);
    const p = await prisma.project.findUnique({ where: { id } });
    expect(p?.activationReviewStatus).toBeNull();
    expect((await getAwaitingActivation('PMO')).items.some((x) => x.id === id)).toBe(true);
    const notif = await prisma.notification.findFirst({ where: { userId: adminId, projectId: id, type: 'ACTIVATION_READY' } });
    expect(notif).toBeTruthy();
  });
});
