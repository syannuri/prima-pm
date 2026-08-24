import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { addDependency, applyAutoSchedule, updateDependency, deleteDependency } from '../schedule/schedule.service.js';
import { setScheduleBaseline } from '../schedule/schedule.service.js';
import { setBaselineLock } from '../projects/baseline.service.js';

// Auto-schedule wiring: a dependency (or a moved predecessor) pushes the successor
// to its earliest legal working-day date. June 2026 anchors — 2026-06-01 is a Monday.
let pmId = '';
let seq = 0;
const day = (n: number) => new Date(Date.UTC(2026, 5, n)); // June 2026, UTC midnight
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function project() {
  seq += 1;
  return prisma.project.create({
    data: { code: `PRJ-AS-${String(seq).padStart(4, '0')}`, name: `AutoSched ${seq}`, status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pmId },
  });
}
const leaf = (projectId: string, wbsCode: string, name: string, s: number, e: number) =>
  prisma.task.create({ data: { projectId, wbsCode, name, planStart: day(s), planEnd: day(e) } });

describe('auto-schedule — weekend-aware dependency propagation', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const pm = await prisma.user.create({ data: { name: 'AS PM', email: 'as-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id;
  });
  beforeEach(async () => { await prisma.project.deleteMany({}); });

  it('pushes a violating FS successor to the predecessor finish (skipping the weekend)', async () => {
    const p = await project();
    const a = await leaf(p.id, '1', 'A', 1, 5); // Mon–Fri (finishes Fri 06-05)
    const b = await leaf(p.id, '2', 'B', 1, 3); // Mon–Wed (dur 2), violates the link
    await addDependency(p.id, b.id, { predecessorId: a.id, type: 'FS', lagDays: 0 }, pmId);

    const out = await applyAutoSchedule(p.id, { actorId: pmId });
    expect(out.moved.map((m) => m.id)).toEqual([b.id]);
    const bAfter = await prisma.task.findUniqueOrThrow({ where: { id: b.id } });
    expect(ymd(bAfter.planStart)).toBe('2026-06-05'); // = A's finish
    expect(ymd(bAfter.planEnd)).toBe('2026-06-09');   // Fri + 2 working days (skips Sat/Sun)
  });

  it('leaves a satisfied link untouched (push-only)', async () => {
    const p = await project();
    const a = await leaf(p.id, '1', 'A', 1, 3); // Mon–Wed
    const b = await leaf(p.id, '2', 'B', 5, 8); // starts Fri — already legal
    await addDependency(p.id, b.id, { predecessorId: a.id, type: 'FS', lagDays: 0 }, pmId);
    const out = await applyAutoSchedule(p.id, { actorId: pmId });
    expect(out.moved).toEqual([]);
    const bAfter = await prisma.task.findUniqueOrThrow({ where: { id: b.id } });
    expect(ymd(bAfter.planStart)).toBe('2026-06-05');
  });

  it('cascades through A→B→C', async () => {
    const p = await project();
    const a = await leaf(p.id, '1', 'A', 1, 5); // Mon–Fri
    const b = await leaf(p.id, '2', 'B', 1, 2); // dur 1
    const c = await leaf(p.id, '3', 'C', 2, 3); // dur 1
    await addDependency(p.id, b.id, { predecessorId: a.id, type: 'FS', lagDays: 0 }, pmId);
    await addDependency(p.id, c.id, { predecessorId: b.id, type: 'FS', lagDays: 0 }, pmId);
    const out = await applyAutoSchedule(p.id, { actorId: pmId });
    expect(out.moved.map((m) => m.id).sort()).toEqual([b.id, c.id].sort());
    const bAfter = await prisma.task.findUniqueOrThrow({ where: { id: b.id } });
    const cAfter = await prisma.task.findUniqueOrThrow({ where: { id: c.id } });
    expect(ymd(bAfter.planStart)).toBe('2026-06-05'); // Fri
    expect(ymd(cAfter.planStart)).toBe('2026-06-08'); // Fri + 1 wd = Mon
  });

  it('dryRun previews the moves without persisting', async () => {
    const p = await project();
    const a = await leaf(p.id, '1', 'A', 1, 5);
    const b = await leaf(p.id, '2', 'B', 1, 3);
    await addDependency(p.id, b.id, { predecessorId: a.id, type: 'FS', lagDays: 0 }, pmId);
    const preview = await applyAutoSchedule(p.id, { dryRun: true });
    expect(preview.moved.map((m) => m.id)).toEqual([b.id]);
    const bAfter = await prisma.task.findUniqueOrThrow({ where: { id: b.id } });
    expect(ymd(bAfter.planStart)).toBe('2026-06-01'); // unchanged — dry run
  });

  it('editing a link lag re-settles the schedule forward', async () => {
    const p = await project();
    const a = await leaf(p.id, '1', 'A', 1, 3); // Mon–Wed (finishes Wed 06-03)
    const b = await leaf(p.id, '2', 'B', 1, 2); // Mon–Tue
    const dep = await addDependency(p.id, b.id, { predecessorId: a.id, type: 'FS', lagDays: 0 }, pmId);
    await applyAutoSchedule(p.id, { actorId: pmId }); // B → Wed
    await updateDependency(p.id, dep.id, { type: 'FS', lagDays: 2 }, pmId);
    await applyAutoSchedule(p.id, { actorId: pmId }); // B → Wed + 2 wd = Fri
    const bAfter = await prisma.task.findUniqueOrThrow({ where: { id: b.id } });
    expect(ymd(bAfter.planStart)).toBe('2026-06-05');
  });

  it('deleting a link does NOT move dates (push-only); asap compacts afterwards', async () => {
    const p = await project();
    const a = await leaf(p.id, '1', 'A', 1, 5); // Mon–Fri
    const b = await leaf(p.id, '2', 'B', 1, 2); // Mon–Tue
    const dep = await addDependency(p.id, b.id, { predecessorId: a.id, type: 'FS', lagDays: 0 }, pmId);
    await applyAutoSchedule(p.id, { actorId: pmId }); // B pushed to Fri 06-05
    expect(ymd((await prisma.task.findUniqueOrThrow({ where: { id: b.id } })).planStart)).toBe('2026-06-05');

    // Remove the link — push-only default leaves B parked where it was pushed.
    await deleteDependency(p.id, dep.id, pmId);
    const afterDelete = await applyAutoSchedule(p.id, { actorId: pmId });
    expect(afterDelete.moved).toEqual([]);
    expect(ymd((await prisma.task.findUniqueOrThrow({ where: { id: b.id } })).planStart)).toBe('2026-06-05');

    // Re-link then compact (asap) pulls B back to hug A again.
    await addDependency(p.id, b.id, { predecessorId: a.id, type: 'FS', lagDays: 0 }, pmId);
    // (B already at Fri, still legal) now widen A earlier is not needed — test asap pull with a gap:
    await prisma.task.update({ where: { id: b.id }, data: { planStart: day(15), planEnd: day(16) } }); // shove B far out
    const compact = await applyAutoSchedule(p.id, { mode: 'asap', actorId: pmId });
    expect(compact.moved.map((m) => m.id)).toEqual([b.id]);
    expect(ymd((await prisma.task.findUniqueOrThrow({ where: { id: b.id } })).planStart)).toBe('2026-06-05'); // hugs A's finish
  });

  it('refuses to persist when the baseline is locked', async () => {
    const p = await project();
    const a = await leaf(p.id, '1', 'A', 1, 5);
    const b = await leaf(p.id, '2', 'B', 1, 3);
    await addDependency(p.id, b.id, { predecessorId: a.id, type: 'FS', lagDays: 0 }, pmId);
    await setScheduleBaseline(p.id, pmId);
    await setBaselineLock(p.id, true, undefined, pmId);
    await expect(applyAutoSchedule(p.id, { actorId: pmId })).rejects.toThrow();
    // dry-run preview is still allowed while locked
    const preview = await applyAutoSchedule(p.id, { dryRun: true });
    expect(preview.moved.map((m) => m.id)).toEqual([b.id]);
  });
});
