import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { setTaskProgress, setTaskActuals } from '../schedule/schedule.service.js';

// Progress ↔ actual-date behaviour is MS-Project style so an accidental "complete" is reversible:
// 100% stamps actualStart+actualFinish; dropping below 100% clears the finish; 0% clears both.
// setTaskActuals edits a specific actual date (or clears it) and rejects finish-before-start —
// and, unlike a plan edit, is not gated by the baseline lock.
let pmId = '';
let seq = 0;

async function projectWithTask(planStart = '2026-07-01', planEnd = '2026-07-10') {
  seq += 1;
  const p = await prisma.project.create({
    data: { code: `PRJ-SA-${String(seq).padStart(4, '0')}`, name: `SchedAct ${seq}`, status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pmId },
  });
  const t = await prisma.task.create({
    data: { projectId: p.id, wbsCode: '1', name: 'Task A', planStart: new Date(planStart), planEnd: new Date(planEnd) },
  });
  return { p, t };
}

describe('Task progress ↔ actual dates (MS-Project reversibility)', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const pm = await prisma.user.create({ data: { name: 'SA PM', email: 'sa-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id;
  });

  beforeEach(async () => {
    await prisma.project.deleteMany({});
  });

  it('stamps both actuals at 100% and clears both when reset to 0% (accidental check reversed)', async () => {
    const { p, t } = await projectWithTask();

    await setTaskProgress(p.id, t.id, 100, pmId);
    let after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.actualStart).not.toBeNull();
    expect(after.actualFinish).not.toBeNull();

    await setTaskProgress(p.id, t.id, 0, pmId);
    after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.actualStart).toBeNull();
    expect(after.actualFinish).toBeNull();
  });

  it('clears only actualFinish when dropping below 100% (still started)', async () => {
    const { p, t } = await projectWithTask();

    await setTaskProgress(p.id, t.id, 100, pmId);
    await setTaskProgress(p.id, t.id, 50, pmId);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.actualStart).not.toBeNull();
    expect(after.actualFinish).toBeNull();
  });

  it('setTaskActuals sets, clears one side, and rejects finish before start', async () => {
    const { p, t } = await projectWithTask();

    await setTaskActuals(p.id, t.id, { actualStart: new Date('2026-07-02'), actualFinish: new Date('2026-07-05') }, pmId);
    let after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.actualStart?.toISOString().slice(0, 10)).toBe('2026-07-02');
    expect(after.actualFinish?.toISOString().slice(0, 10)).toBe('2026-07-05');

    // Clearing just the finish leaves the start intact.
    await setTaskActuals(p.id, t.id, { actualFinish: null }, pmId);
    after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.actualStart).not.toBeNull();
    expect(after.actualFinish).toBeNull();

    await expect(
      setTaskActuals(p.id, t.id, { actualStart: new Date('2026-07-08'), actualFinish: new Date('2026-07-06') }, pmId),
    ).rejects.toThrow();
  });
});
