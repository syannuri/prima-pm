import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { getProjectAlerts } from '../notification/notification.service.js';

// Fase 1 — proactive "due soon" alerts. A leaf task/milestone whose planned finish falls within the
// next 7 whole days (and isn't overdue or complete) raises a DUE_SOON_TASK alert; "due today/tomorrow"
// is MEDIUM, the rest LOW. Overdue still wins, summary rows + completed tasks are skipped, and a
// finish beyond the window raises nothing. Driven through getProjectAlerts with a fixed `now`.
const DAY = 86_400_000;
const NOW = new Date('2026-09-10T09:00:00.000Z');
let pmId = '';
let seq = 0;

// A leaf task due `k` days from NOW (k<0 = overdue). One row per call so wbsCodes stay unique.
async function task(projectId: string, name: string, k: number, opts: { progressPct?: number; isMilestone?: boolean; parentTaskId?: string } = {}) {
  seq += 1;
  const planEnd = new Date(NOW.getTime() + k * DAY);
  const planStart = new Date(planEnd.getTime() - DAY);
  return prisma.task.create({
    data: {
      projectId, wbsCode: String(seq), name, planStart, planEnd,
      progressPct: opts.progressPct ?? 0, isMilestone: opts.isMilestone ?? false, parentTaskId: opts.parentTaskId,
    },
  });
}

async function project() {
  seq += 1;
  return prisma.project.create({
    data: { code: `PRJ-DS-${String(seq).padStart(4, '0')}`, name: `DS ${seq}`, status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pmId },
  });
}

const alerts = async (projectId: string) => (await getProjectAlerts(projectId, NOW)).alerts;
const dueSoon = (a: Awaited<ReturnType<typeof alerts>>) => a.filter((x) => x.type === 'DUE_SOON_TASK');

describe('due-soon task alerts (Fase 1)', () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const pm = await prisma.user.create({ data: { name: 'DS PM', email: 'ds-pm@t.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
    pmId = pm.id;
  });

  beforeEach(async () => {
    await prisma.task.deleteMany({});
    await prisma.project.deleteMany({});
  });

  it('flags a leaf task due within the window and escalates "due today/tomorrow" to MEDIUM', async () => {
    const p = await project();
    await task(p.id, 'Today', 0);
    await task(p.id, 'Tomorrow', 1);
    await task(p.id, 'In three', 3);
    await task(p.id, 'Edge seven', 7);

    const ds = dueSoon(await alerts(p.id));
    const byName = new Map(ds.map((a) => [a.message.match(/"([^"]+)"/)![1], a]));
    expect(byName.get('Today')!.severity).toBe('MEDIUM');
    expect(byName.get('Today')!.message).toMatch(/due today/);
    expect(byName.get('Tomorrow')!.severity).toBe('MEDIUM');
    expect(byName.get('Tomorrow')!.message).toMatch(/due tomorrow/);
    expect(byName.get('In three')!.severity).toBe('LOW');
    expect(byName.get('In three')!.message).toMatch(/due in 3d/);
    expect(byName.get('Edge seven')!.severity).toBe('LOW'); // 7 days = still inside the window
    expect(ds).toHaveLength(4);
    // Deep-link plumbing: points at the Schedule tab + the specific task.
    expect(byName.get('Today')!.tab).toBe('Schedule');
    expect(byName.get('Today')!.entityId).toBeTruthy();
  });

  it('does NOT flag a task whose finish is beyond the window (8+ days out)', async () => {
    const p = await project();
    await task(p.id, 'Far', 8);
    expect(dueSoon(await alerts(p.id))).toHaveLength(0);
  });

  it('does not flag completed tasks, and overdue wins over due-soon', async () => {
    const p = await project();
    await task(p.id, 'Done soon', 2, { progressPct: 100 }); // complete → nothing
    await task(p.id, 'Late', -3);                            // overdue → OVERDUE_TASK, not due-soon

    const all = await alerts(p.id);
    expect(dueSoon(all)).toHaveLength(0);
    expect(all.filter((a) => a.type === 'OVERDUE_TASK')).toHaveLength(1);
  });

  it('skips summary rows (only leaf tasks/milestones count)', async () => {
    const p = await project();
    const parent = await task(p.id, 'Phase (summary)', 2); // becomes a summary once it has a child
    await task(p.id, 'Child', 2, { parentTaskId: parent.id });

    const ds = dueSoon(await alerts(p.id));
    expect(ds).toHaveLength(1);
    expect(ds[0].message).toMatch(/"Child"/);
  });

  it('labels a milestone as "Milestone" in the message', async () => {
    const p = await project();
    await task(p.id, 'Go-live', 4, { isMilestone: true });
    const ds = dueSoon(await alerts(p.id));
    expect(ds).toHaveLength(1);
    expect(ds[0].message).toMatch(/^Milestone "Go-live" is due in 4d/);
  });
});
