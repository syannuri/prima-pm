import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { updateTask, getGantt } from '../schedule/schedule.service.js';
import type { UpsertTaskInput } from '../schedule/schedule.schemas.js';

// Multiple owners per task: `ownerResourceIds` is the full owner set, `picResourceId` is the LEAD
// (always folded into the set). Omitting `ownerResourceIds` leaves the existing owners untouched.
let pmId = '';
let seq = 0;

const baseInput = (over: Partial<UpsertTaskInput> = {}): UpsertTaskInput => ({
  name: 'Task A',
  planStart: new Date('2026-07-01'),
  planEnd: new Date('2026-07-10'),
  progressPct: 0,
  isMilestone: false,
  sortOrder: 0,
  ...over,
});

async function projectWithTask() {
  seq += 1;
  const p = await prisma.project.create({
    data: { code: `PRJ-SO-${String(seq).padStart(4, '0')}`, name: `SchedOwn ${seq}`, status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pmId },
  });
  const t = await prisma.task.create({
    data: { projectId: p.id, wbsCode: '1', name: 'Task A', planStart: new Date('2026-07-01'), planEnd: new Date('2026-07-10') },
  });
  return { p, t };
}

const ownerIdsOf = async (taskId: string) =>
  (await prisma.taskOwner.findMany({ where: { taskId }, select: { resourceId: true } })).map((o) => o.resourceId).sort();

describe('Task multiple owners (lead + co-owners)', () => {
  let r1 = '', r2 = '', r3 = '';
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const pm = await prisma.user.create({ data: { name: 'SO PM', email: 'so-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id;
    [r1, r2, r3] = (await Promise.all([
      prisma.resource.create({ data: { name: 'Dadang' } }),
      prisma.resource.create({ data: { name: 'Reno' } }),
      prisma.resource.create({ data: { name: 'Cahya' } }),
    ])).map((r) => r.id);
  });

  beforeEach(async () => { await prisma.project.deleteMany({}); });

  it('sets multiple owners with an explicit lead; getGantt returns them with the lead as picResource', async () => {
    const { p, t } = await projectWithTask();
    await updateTask(p.id, t.id, baseInput({ ownerResourceIds: [r1, r2, r3], picResourceId: r2 }), pmId);

    const task = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(task.picResourceId).toBe(r2);
    expect(await ownerIdsOf(t.id)).toEqual([r1, r2, r3].sort());

    const { tree } = await getGantt(p.id);
    const node = tree[0] as { owners: { id: string }[]; picResource: { id: string } | null };
    expect(node.owners.map((o) => o.id).sort()).toEqual([r1, r2, r3].sort());
    expect(node.picResource?.id).toBe(r2);
  });

  it('folds the lead into the set when it was not listed', async () => {
    const { p, t } = await projectWithTask();
    await updateTask(p.id, t.id, baseInput({ ownerResourceIds: [r1], picResourceId: r2 }), pmId);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(task.picResourceId).toBe(r2);
    expect(await ownerIdsOf(t.id)).toEqual([r1, r2].sort());
  });

  it('with no explicit lead, the first owner leads', async () => {
    const { p, t } = await projectWithTask();
    await updateTask(p.id, t.id, baseInput({ ownerResourceIds: [r3, r1] }), pmId);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(task.picResourceId).toBe(r3);
    expect(await ownerIdsOf(t.id)).toEqual([r1, r3].sort());
  });

  it('replaces the whole set on the next update', async () => {
    const { p, t } = await projectWithTask();
    await updateTask(p.id, t.id, baseInput({ ownerResourceIds: [r1, r2] }), pmId);
    await updateTask(p.id, t.id, baseInput({ ownerResourceIds: [r3] }), pmId);
    expect(await ownerIdsOf(t.id)).toEqual([r3]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).picResourceId).toBe(r3);
  });

  it('leaves owners untouched when ownerResourceIds is omitted', async () => {
    const { p, t } = await projectWithTask();
    await updateTask(p.id, t.id, baseInput({ ownerResourceIds: [r1, r2] }), pmId);
    await updateTask(p.id, t.id, baseInput({ name: 'Renamed' }), pmId); // no ownerResourceIds
    expect(await ownerIdsOf(t.id)).toEqual([r1, r2].sort());
  });

  it('inline lead change (picResourceId only, no ownerResourceIds) folds the new lead into the set, keeping co-owners', async () => {
    const { p, t } = await projectWithTask();
    await updateTask(p.id, t.id, baseInput({ ownerResourceIds: [r1, r2] }), pmId); // set r1 (lead) + r2
    // Simulate the client's inline owner edit: a full PUT that only overrides picResourceId.
    await updateTask(p.id, t.id, baseInput({ picResourceId: r3 }), pmId);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(task.picResourceId).toBe(r3);
    // New lead is now in the set; existing co-owners are preserved (old lead demoted to co-owner).
    expect(await ownerIdsOf(t.id)).toEqual([r1, r2, r3].sort());
  });

  it('rejects an unknown owner resource id', async () => {
    const { p, t } = await projectWithTask();
    await expect(
      updateTask(p.id, t.id, baseInput({ ownerResourceIds: ['00000000-0000-0000-0000-000000000000'] }), pmId),
    ).rejects.toThrow();
  });
});
