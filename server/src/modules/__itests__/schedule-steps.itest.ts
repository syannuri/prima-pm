import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { setTaskSteps, getTaskSteps, getEvm } from '../schedule/schedule.service.js';

// Weighted progress steps (#5): a work package's % is DERIVED from Σ(done step weights)/Σ(weights),
// applied through setTaskProgress (so actual dates stamp and the EV roll-up follows).
let pmId = '';
let seq = 0;

async function projectWithTask() {
  seq += 1;
  const p = await prisma.project.create({
    data: { code: `PRJ-ST-${String(seq).padStart(4, '0')}`, name: `Steps ${seq}`, status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pmId },
  });
  const t = await prisma.task.create({ data: { projectId: p.id, wbsCode: '1', name: 'Work package', planStart: new Date('2026-06-01'), planEnd: new Date('2026-06-20') } });
  return { p, t };
}

describe('Weighted progress steps (#5)', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const pm = await prisma.user.create({ data: { name: 'ST PM', email: 'st-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id;
  });
  beforeEach(async () => { await prisma.project.deleteMany({}); });

  it('derives the task % from done step weights and stamps actuals', async () => {
    const { p, t } = await projectWithTask();
    await setTaskSteps(p.id, t.id, { steps: [
      { name: 'Design', weight: 10, done: true },
      { name: 'Build', weight: 30, done: false },
      { name: 'Test', weight: 60, done: false },
    ] }, pmId);
    let task = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(task.progressPct).toBe(10);       // 10 of 100 weight done
    expect(task.actualStart).not.toBeNull(); // progress > 0 stamps actualStart

    // Finish the remaining steps → 100% + actualFinish stamped.
    await setTaskSteps(p.id, t.id, { steps: [
      { name: 'Design', weight: 10, done: true },
      { name: 'Build', weight: 30, done: true },
      { name: 'Test', weight: 60, done: true },
    ] }, pmId);
    task = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(task.progressPct).toBe(100);
    expect(task.actualFinish).not.toBeNull();
    expect((await getTaskSteps(p.id, t.id)).length).toBe(3);
  });

  it('clearing all steps leaves the last derived % intact (reverts to manual)', async () => {
    const { p, t } = await projectWithTask();
    await setTaskSteps(p.id, t.id, { steps: [{ name: 'A', weight: 1, done: true }, { name: 'B', weight: 1, done: false }] }, pmId);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).progressPct).toBe(50);
    await setTaskSteps(p.id, t.id, { steps: [] }, pmId);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).progressPct).toBe(50); // unchanged
    expect((await getTaskSteps(p.id, t.id)).length).toBe(0);
  });

  it('the derived % flows into the project EVM roll-up', async () => {
    const { p, t } = await projectWithTask();
    await setTaskSteps(p.id, t.id, { steps: [
      { name: 'S1', weight: 1, done: true },
      { name: 'S2', weight: 1, done: true },
      { name: 'S3', weight: 1, done: true },
      { name: 'S4', weight: 1, done: false },
    ] }, pmId);
    // Single-leaf project → weightedProgress == the task's derived 75%.
    const evm = await getEvm(p.id, 0, new Date('2026-07-01'));
    expect(evm.weightedProgress).toBeCloseTo(0.75, 4);
  });
});
