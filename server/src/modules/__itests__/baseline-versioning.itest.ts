import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { applyBaselineLock } from '../projects/baseline.service.js';
import { backfillBaselineVersions } from '../projects/baseline.backfill.js';

// Fase 1 — a committed BaselineVersion (combined schedule + cost snapshot) is captured at each lock
// transition; re-baselining (unlock → change → re-lock) appends the next version; and a one-time
// backfill seeds v1 for pre-existing locked projects using the HISTORICAL lock date.
let pmId = '';
let seq = 0;

type ScheduleRow = { taskId: string; wbsCode: string; name: string; baselineStart: string | null; baselineFinish: string | null; weight: number | null };
type CostSnap = { directTotal: string; indirectTotal: string; contingencyReserve: string; managementReserve: string; costBaseline: string; budgetAtCompletion: string };

// A project with two baselined tasks and a cost baseline already populated (we set the baseline*
// columns + CostBaseline directly, isolating versioning from the charter/schedule-capture flow).
async function baselinedProject(cost = { costBaseline: 1000, budgetAtCompletion: 1200, managementReserve: 200 }) {
  seq += 1;
  const p = await prisma.project.create({
    data: { code: `PRJ-BV-${String(seq).padStart(4, '0')}`, name: `BV ${seq}`, status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pmId },
  });
  const d = (n: number) => new Date(2026, 5, n);
  await prisma.task.create({ data: { projectId: p.id, wbsCode: '1', name: 'Phase A', planStart: d(1), planEnd: d(11), baselineStart: d(1), baselineFinish: d(11), baselineWeight: 60 } });
  await prisma.task.create({ data: { projectId: p.id, wbsCode: '2', name: 'Phase B', planStart: d(11), planEnd: d(21), baselineStart: d(11), baselineFinish: d(21), baselineWeight: 40 } });
  await prisma.project.update({ where: { id: p.id }, data: { scheduleBaselinedAt: d(1) } });
  await prisma.costBaseline.create({
    data: { projectId: p.id, directTotal: 800, indirectTotal: 200, contingencyReserve: 0, managementReserve: cost.managementReserve, costBaseline: cost.costBaseline, budgetAtCompletion: cost.budgetAtCompletion },
  });
  return p;
}

const versions = (projectId: string) => prisma.baselineVersion.findMany({ where: { projectId }, orderBy: { version: 'asc' } });

describe('baseline versioning — capture on lock (Fase 1)', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const pm = await prisma.user.create({ data: { name: 'BV PM', email: 'bv-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id;
  });

  beforeEach(async () => {
    await prisma.baselineVersion.deleteMany({});
    await prisma.project.deleteMany({});
  });

  it('captures v1 with the full schedule + cost snapshot when the baseline is locked', async () => {
    const p = await baselinedProject();
    await applyBaselineLock(p.id, 'Initial baseline', pmId);

    const vs = await versions(p.id);
    expect(vs).toHaveLength(1);
    const v = vs[0];
    expect(v.version).toBe(1);
    expect(v.reason).toBe('Initial baseline');
    expect(v.committedBy).toBe(pmId);

    const sched = v.schedule as unknown as ScheduleRow[];
    expect(sched).toHaveLength(2);
    expect(sched.map((s) => s.wbsCode)).toEqual(['1', '2']);
    expect(sched.find((s) => s.wbsCode === '1')!.weight).toBe(60);
    expect(sched.find((s) => s.wbsCode === '2')!.name).toBe('Phase B');

    const cost = v.cost as unknown as CostSnap;
    expect(Number(cost.costBaseline)).toBe(1000);
    expect(Number(cost.budgetAtCompletion)).toBe(1200);
    expect(Number(cost.managementReserve)).toBe(200);
  });

  it('re-baselining (unlock → change cost → re-lock) appends v2 reflecting the new numbers', async () => {
    const p = await baselinedProject();
    await applyBaselineLock(p.id, 'v1', pmId);            // v1
    await applyBaselineLock(p.id, 'reopen', pmId, false); // unlock (no capture)
    await prisma.costBaseline.update({ where: { projectId: p.id }, data: { costBaseline: 1500, budgetAtCompletion: 1800 } });
    await applyBaselineLock(p.id, 'Re-baseline after scope change', pmId); // v2

    const vs = await versions(p.id);
    expect(vs.map((v) => v.version)).toEqual([1, 2]);
    expect(vs[1].reason).toBe('Re-baseline after scope change');
    expect(Number((vs[0].cost as unknown as CostSnap).costBaseline)).toBe(1000); // v1 preserved
    expect(Number((vs[1].cost as unknown as CostSnap).costBaseline)).toBe(1500); // v2 = new
  });

  it('does not capture on unlock or on a re-lock no-op (only on the lock transition)', async () => {
    const p = await baselinedProject();
    await applyBaselineLock(p.id, 'v1', pmId);       // v1
    await applyBaselineLock(p.id, 'again', pmId);    // already locked → no-op, no capture
    expect(await prisma.baselineVersion.count({ where: { projectId: p.id } })).toBe(1);
  });

  it('backfill seeds v1 for a pre-existing locked project using the HISTORICAL lock date, and is idempotent', async () => {
    const p = await baselinedProject();
    const lockedAt = new Date('2026-07-15T00:00:00.000Z');
    // Simulate a project locked BEFORE versioning existed: locked, but no version row.
    await prisma.project.update({ where: { id: p.id }, data: { baselineLockedAt: lockedAt, baselineLockedById: pmId } });
    await prisma.baselineVersion.deleteMany({ where: { projectId: p.id } });

    const first = await backfillBaselineVersions();
    expect(first.created).toBeGreaterThanOrEqual(1);
    const vs = await versions(p.id);
    expect(vs).toHaveLength(1);
    expect(vs[0].version).toBe(1);
    expect(vs[0].committedAt.toISOString()).toBe(lockedAt.toISOString()); // historical, not now
    expect(vs[0].reason).toMatch(/backfill/i);

    // Re-running skips it (idempotent).
    const again = await backfillBaselineVersions();
    expect(again.created).toBe(0);
    expect(await prisma.baselineVersion.count({ where: { projectId: p.id } })).toBe(1);
  });
});
