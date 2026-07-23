import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { runWeeklyAutoCaptureIfDue } from '../evm/evm.portfolio.js';

// Weekly EVM auto-capture scheduler: opt-in, weekday-gated, once-per-day, system-actor snapshots
// across the corporate portfolio (non-DRAFT, non-archived, non-personal).
let pmId = '';
let seq = 0;

async function project(opts: { status?: 'DRAFT' | 'IN_PROGRESS'; archived?: boolean; personal?: boolean } = {}) {
  seq += 1;
  return prisma.project.create({
    data: {
      code: `PRJ-AC-${String(seq).padStart(4, '0')}`,
      name: `AutoCap ${seq}`,
      status: opts.status ?? 'IN_PROGRESS',
      deliveryApproach: 'PREDICTIVE',
      pmUserId: pmId,
      archivedAt: opts.archived ? new Date() : null,
      personalOwnerId: opts.personal ? pmId : null,
    },
  });
}

async function setSettings(enabled: boolean, weekday: number, lastRunAt: Date | null = null) {
  await prisma.appSetting.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', evmAutoCaptureEnabled: enabled, evmAutoCaptureWeekday: weekday, evmAutoCaptureLastRunAt: lastRunAt },
    update: { evmAutoCaptureEnabled: enabled, evmAutoCaptureWeekday: weekday, evmAutoCaptureLastRunAt: lastRunAt },
  });
}

// A Monday so we can drive the weekday deterministically (2026-07-27 is a Monday, getUTCDay()===1).
const MONDAY = new Date('2026-07-27T09:00:00Z');

describe('Weekly EVM auto-capture', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const pm = await prisma.user.create({ data: { name: 'AC PM', email: 'ac-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id;
  });

  beforeEach(async () => {
    // Fresh project set per test (cascade clears their snapshots) so counts are deterministic.
    await prisma.project.deleteMany({});
  });

  it('does nothing when disabled', async () => {
    await project();
    await setSettings(false, MONDAY.getUTCDay());
    const r = await runWeeklyAutoCaptureIfDue(MONDAY);
    expect(r.ran).toBe(false);
    expect(await prisma.evmSnapshot.count()).toBe(0);
  });

  it('does nothing when today is not the configured weekday', async () => {
    await project();
    await setSettings(true, (MONDAY.getUTCDay() + 1) % 7); // configured for a different day
    const r = await runWeeklyAutoCaptureIfDue(MONDAY);
    expect(r.ran).toBe(false);
    expect(await prisma.evmSnapshot.count()).toBe(0);
  });

  it('captures every non-DRAFT corporate project on the configured weekday, with a system actor + marker note', async () => {
    const live = await project({ status: 'IN_PROGRESS' });
    await project({ status: 'DRAFT' });            // excluded (no baseline/EVM)
    await project({ archived: true });             // excluded (archived)
    await project({ personal: true });             // excluded (personal/guest sandbox)
    await setSettings(true, MONDAY.getUTCDay());

    const r = await runWeeklyAutoCaptureIfDue(MONDAY);
    expect(r.ran).toBe(true);
    if (r.ran) expect(r.total).toBe(1); // only the one live corporate project

    const snaps = await prisma.evmSnapshot.findMany();
    expect(snaps).toHaveLength(1);
    expect(snaps[0].projectId).toBe(live.id);
    expect(snaps[0].createdById).toBeNull();       // system actor
    expect(snaps[0].note).toBe('Auto weekly capture');

    // lastRunAt stamped so a same-day re-run is a no-op.
    const row = await prisma.appSetting.findUnique({ where: { id: 'singleton' } });
    expect(row?.evmAutoCaptureLastRunAt).toBeInstanceOf(Date);
  });

  it('does not run twice on the same day', async () => {
    await project();
    await setSettings(true, MONDAY.getUTCDay(), MONDAY); // already ran earlier today
    const r = await runWeeklyAutoCaptureIfDue(new Date('2026-07-27T18:00:00Z'));
    expect(r.ran).toBe(false);
    expect(await prisma.evmSnapshot.count()).toBe(0);
  });
});
