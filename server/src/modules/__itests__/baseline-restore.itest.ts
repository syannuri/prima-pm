import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { applyBaselineLock, restoreBaselineVersion } from '../projects/baseline.service.js';

// Fase 4 — restore/adopt a prior baseline revision. A single locked→locked op that writes the chosen
// version's snapshot back into the live baseline (Task.baseline* + the CostBaseline numbers) and
// appends the result as a NEW "Restored from Bn" version (append-only history). Since-deleted tasks
// are skipped; tasks added after the restored version keep their current baseline.
let pmId = '';
let seq = 0;

type ScheduleRow = { taskId: string; wbsCode: string; name: string; baselineStart: string | null; baselineFinish: string | null; weight: number | null };
type CostSnap = { directTotal: string; indirectTotal: string; contingencyReserve: string; managementReserve: string; costBaseline: string; budgetAtCompletion: string };

const d = (n: number) => new Date(2026, 5, n); // June 2026

async function baselinedProject() {
  seq += 1;
  const p = await prisma.project.create({
    data: { code: `PRJ-BR-${String(seq).padStart(4, '0')}`, name: `BR ${seq}`, status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pmId },
  });
  await prisma.task.create({ data: { projectId: p.id, wbsCode: '1', name: 'Phase A', planStart: d(1), planEnd: d(11), baselineStart: d(1), baselineFinish: d(11), baselineWeight: 60 } });
  await prisma.task.create({ data: { projectId: p.id, wbsCode: '2', name: 'Phase B', planStart: d(11), planEnd: d(21), baselineStart: d(11), baselineFinish: d(21), baselineWeight: 40 } });
  await prisma.project.update({ where: { id: p.id }, data: { scheduleBaselinedAt: d(1) } });
  await prisma.costBaseline.create({
    data: { projectId: p.id, directTotal: 800, indirectTotal: 200, contingencyReserve: 0, managementReserve: 200, costBaseline: 1000, budgetAtCompletion: 1200 },
  });
  return p;
}

const versions = (projectId: string) => prisma.baselineVersion.findMany({ where: { projectId }, orderBy: { version: 'asc' } });
const task = (projectId: string, wbsCode: string) => prisma.task.findFirstOrThrow({ where: { projectId, wbsCode } });

describe('baseline restore/adopt (Fase 4)', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const pm = await prisma.user.create({ data: { name: 'BR PM', email: 'br-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id;
  });

  beforeEach(async () => {
    await prisma.baselineVersion.deleteMany({});
    await prisma.project.deleteMany({});
  });

  it('re-bases the live baseline (schedule + cost) to the chosen version and appends a new adopted revision', async () => {
    const p = await baselinedProject();
    await applyBaselineLock(p.id, 'v1', pmId); // B1 captures the original (PMB 1000, Phase A weight 60)

    // Re-baseline: unlock, change cost + a task's schedule baseline, re-lock → B2.
    await applyBaselineLock(p.id, 'reopen', pmId, false);
    await prisma.costBaseline.update({ where: { projectId: p.id }, data: { costBaseline: 1500, budgetAtCompletion: 1800, directTotal: 1300 } });
    const aTask = await task(p.id, '1');
    await prisma.task.update({ where: { id: aTask.id }, data: { baselineFinish: d(16), baselineWeight: 70 } });
    await applyBaselineLock(p.id, 'v2', pmId); // B2

    // Restore B1.
    const res = await restoreBaselineVersion(p.id, 1, 'revert to B1', pmId);
    expect(res.fromVersion).toBe(1);
    expect(res.newVersion).toBe(3); // appended, nothing destroyed
    expect(res.tasksRestored).toBe(2);
    expect(res.tasksMissing).toBe(0);
    expect(res.tasksUntouched).toBe(0);

    // Live CostBaseline re-based to B1 numbers.
    const cb = await prisma.costBaseline.findUniqueOrThrow({ where: { projectId: p.id } });
    expect(Number(cb.costBaseline)).toBe(1000);
    expect(Number(cb.budgetAtCompletion)).toBe(1200);
    expect(Number(cb.directTotal)).toBe(800);
    expect(Number(cb.managementReserve)).toBe(200);

    // Live Task.baseline* re-based to B1 (Phase A back to finish=11 / weight=60).
    const a = await task(p.id, '1');
    expect(a.baselineFinish!.toISOString()).toBe(d(11).toISOString());
    expect(a.baselineWeight).toBe(60);

    // Append-only: B1 + B2 untouched, B3 = adopted snapshot equal to B1's numbers.
    const vs = await versions(p.id);
    expect(vs.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(Number((vs[1].cost as unknown as CostSnap).costBaseline)).toBe(1500); // B2 preserved
    expect(Number((vs[2].cost as unknown as CostSnap).costBaseline)).toBe(1000); // B3 = restored B1
    expect(vs[2].reason).toBe('revert to B1');
    const b3sched = vs[2].schedule as unknown as ScheduleRow[];
    expect(b3sched.find((s) => s.wbsCode === '1')!.weight).toBe(60);
  });

  it('leaves the baseline locked (restore is a single locked→locked op)', async () => {
    const p = await baselinedProject();
    await applyBaselineLock(p.id, 'v1', pmId);
    await restoreBaselineVersion(p.id, 1, undefined, pmId);
    const proj = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(proj.baselineLockedAt).not.toBeNull();
  });

  it('defaults the new revision reason to "Restored from Bn" when none is given', async () => {
    const p = await baselinedProject();
    await applyBaselineLock(p.id, 'v1', pmId);
    const res = await restoreBaselineVersion(p.id, 1, undefined, pmId);
    const v = await prisma.baselineVersion.findFirstOrThrow({ where: { projectId: p.id, version: res.newVersion } });
    expect(v.reason).toBe('Restored from B1');
  });

  it('skips since-deleted tasks and leaves newer tasks untouched (both reported)', async () => {
    const p = await baselinedProject();
    await applyBaselineLock(p.id, 'v1', pmId); // B1 snapshots Phase A + Phase B

    // After B1: delete Phase B and add a new Phase C (not in B1).
    await applyBaselineLock(p.id, 'reopen', pmId, false);
    const bTask = await task(p.id, '2');
    await prisma.task.delete({ where: { id: bTask.id } });
    await prisma.task.create({ data: { projectId: p.id, wbsCode: '3', name: 'Phase C', planStart: d(21), planEnd: d(28), baselineStart: d(21), baselineFinish: d(28), baselineWeight: 25 } });
    await applyBaselineLock(p.id, 'v2', pmId);

    const res = await restoreBaselineVersion(p.id, 1, undefined, pmId);
    expect(res.tasksRestored).toBe(1); // only Phase A still exists from B1
    expect(res.tasksMissing).toBe(1);  // Phase B was in B1 but deleted
    expect(res.tasksUntouched).toBe(1); // Phase C exists but wasn't in B1

    // Phase C keeps its own baseline (untouched by the restore).
    const c = await task(p.id, '3');
    expect(c.baselineWeight).toBe(25);
  });

  it('writes a RESTORE_BASELINE audit entry', async () => {
    const p = await baselinedProject();
    await applyBaselineLock(p.id, 'v1', pmId);
    await restoreBaselineVersion(p.id, 1, 'audit me', pmId);
    const audit = await prisma.auditLog.findFirst({ where: { projectId: p.id, action: 'RESTORE_BASELINE' } });
    expect(audit).not.toBeNull();
  });

  it('rejects a non-existent version', async () => {
    const p = await baselinedProject();
    await applyBaselineLock(p.id, 'v1', pmId);
    await expect(restoreBaselineVersion(p.id, 99, undefined, pmId)).rejects.toThrow();
  });
});
