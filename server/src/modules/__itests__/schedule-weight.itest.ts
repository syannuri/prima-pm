import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { getEvm, updateTask } from '../schedule/schedule.service.js';

// Model B — a manual `weight` on a Main Task steers the authoritative project % (weightedProgress).
// Two equal-duration phases, one 100% done and one 0% done: with no weights the project is 50%;
// weighting the DONE phase heavier pulls it up, weighting the UNDONE phase heavier pulls it down.
// A weight-free WBS must stay exactly duration-weighted (no EVM drift for existing projects).
let pmId = '';
let seq = 0;
const STATUS = new Date('2026-08-01');

async function twoPhaseProject() {
  seq += 1;
  const p = await prisma.project.create({
    data: { code: `PRJ-WT-${String(seq).padStart(4, '0')}`, name: `Weight ${seq}`, status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pmId },
  });
  const day = (n: number) => new Date(2026, 5, n); // June 2026
  // Phase A (done) and Phase B (not started), each a parent with one 10-day leaf.
  const pa = await prisma.task.create({ data: { projectId: p.id, wbsCode: '1', name: 'Phase A', planStart: day(1), planEnd: day(11) } });
  const a1 = await prisma.task.create({ data: { projectId: p.id, parentTaskId: pa.id, wbsCode: '1.1', name: 'A work', planStart: day(1), planEnd: day(11), progressPct: 100 } });
  const pb = await prisma.task.create({ data: { projectId: p.id, wbsCode: '2', name: 'Phase B', planStart: day(1), planEnd: day(11) } });
  const b1 = await prisma.task.create({ data: { projectId: p.id, parentTaskId: pb.id, wbsCode: '2.1', name: 'B work', planStart: day(1), planEnd: day(11), progressPct: 0 } });
  return { p, pa, a1, pb, b1 };
}

// Full-record update helper mirroring what the API route sends (upsertTask), overriding weight.
const setWeight = (projectId: string, task: { id: string; name: string; planStart: Date; planEnd: Date; parentTaskId: string | null }, weight: number | null) =>
  updateTask(projectId, task.id, {
    name: task.name, planStart: task.planStart, planEnd: task.planEnd, parentTaskId: task.parentTaskId,
    progressPct: 0, isMilestone: false, sortOrder: 0, weight,
  } as Parameters<typeof updateTask>[2], pmId);

describe('Model B — manual Main-Task weight steers project %', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const pm = await prisma.user.create({ data: { name: 'WT PM', email: 'wt-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id;
  });

  beforeEach(async () => {
    await prisma.project.deleteMany({});
  });

  it('is 50% with no weights (equal-duration phases, one done one not)', async () => {
    const { p } = await twoPhaseProject();
    const evm = await getEvm(p.id, 0, STATUS);
    expect(evm.weightedProgress).toBeCloseTo(0.5, 4);
  });

  it('weighting the DONE phase heavier pulls the project % up', async () => {
    const { p, pa, pb } = await twoPhaseProject();
    await setWeight(p.id, pa, 90);
    await setWeight(p.id, pb, 10);
    const evm = await getEvm(p.id, 0, STATUS);
    expect(evm.weightedProgress).toBeCloseTo(0.9, 4); // 90% of weight is complete
  });

  it('weighting the UNDONE phase heavier pulls the project % down', async () => {
    const { p, pa, pb } = await twoPhaseProject();
    await setWeight(p.id, pa, 10);
    await setWeight(p.id, pb, 90);
    const evm = await getEvm(p.id, 0, STATUS);
    expect(evm.weightedProgress).toBeCloseTo(0.1, 4); // only the 10%-weighted phase is done
  });

  it('clearing the weight (null) reverts to the duration-weighted 50%', async () => {
    const { p, pa, pb } = await twoPhaseProject();
    await setWeight(p.id, pa, 90);
    await setWeight(p.id, pa, null);
    await setWeight(p.id, pb, null);
    const evm = await getEvm(p.id, 0, STATUS);
    expect(evm.weightedProgress).toBeCloseTo(0.5, 4);
  });
});
