import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { getResourceCapacity } from '../resource/resource.service.js';

// An assigned agile backlog item, on a dated sprint, should load its assignee's linked
// Resource in the capacity/utilization report by (storyPoints × project.mandaysPerPoint).
describe('Agile assignments feed resource capacity', () => {
  let adminId = '';
  let resourceName = '';

  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

    const admin = await prisma.user.create({ data: { name: 'Cap Admin', email: 'cap-admin@t.test', role: 'ADMIN', passwordHash: await hashPassword('Cap-Pass-1'), isActive: true } });
    adminId = admin.id;
    const dev = await prisma.user.create({ data: { name: 'Dev Dewi', email: 'dev@t.test', role: 'TEAM_MEMBER', passwordHash: await hashPassword('Cap-Pass-1'), isActive: true } });
    // Corporate resource linked to the assignee, half-time (capacity 0.5/day).
    const res = await prisma.resource.create({ data: { name: 'Dev Dewi', userId: dev.id, capacityPerDay: 0.5, unitCostPerManday: 2_000_000 } });
    resourceName = res.name;

    const project = await prisma.project.create({ data: { code: 'PRJ-CAP-0001', name: 'Agile Cap', status: 'IN_PROGRESS', deliveryApproach: 'AGILE', mandaysPerPoint: 2, pmUserId: admin.id } });
    const sprint = await prisma.sprint.create({ data: { projectId: project.id, name: 'S1', status: 'ACTIVE', startDate: new Date('2026-07-06'), endDate: new Date('2026-07-17'), sortOrder: 0 } });
    // Assigned, 5 points → 5 × 2 = 10 man-days of load spread over the sprint.
    await prisma.backlogItem.create({ data: { projectId: project.id, title: 'Build feature', type: 'STORY', storyPoints: 5, status: 'IN_PROGRESS', assigneeUserId: dev.id, sprintId: sprint.id, priority: 0, sortOrder: 0 } });
    // Unassigned item should NOT load anyone.
    await prisma.backlogItem.create({ data: { projectId: project.id, title: 'Someday', type: 'STORY', storyPoints: 8, status: 'TODO', assigneeUserId: null, sprintId: sprint.id, priority: 1, sortOrder: 1 } });
  });

  it('loads the assignee resource by points × mandaysPerPoint', async () => {
    const report = await getResourceCapacity(adminId, 'ADMIN', { granularity: 'month', from: new Date('2026-07-01'), to: new Date('2026-07-31') });
    const row = report.resources.find((r) => r.name === resourceName);
    expect(row).toBeTruthy();
    expect(row!.totalPlanMandays).toBe(10); // 5 pts × 2 md/pt — resolved to the linked resource
  });

  it('ignores unassigned backlog items', async () => {
    const report = await getResourceCapacity(adminId, 'ADMIN', { granularity: 'month' });
    // Only the one assignee resource loads; no phantom row for the 8-pt unassigned item.
    const total = report.summary.totalPlanMandays;
    expect(total).toBe(10);
  });

  it('scales with the project factor', async () => {
    await prisma.project.update({ where: { code: 'PRJ-CAP-0001' }, data: { mandaysPerPoint: 3 } });
    const report = await getResourceCapacity(adminId, 'ADMIN', { granularity: 'month' });
    const row = report.resources.find((r) => r.name === resourceName);
    expect(row!.totalPlanMandays).toBe(15); // 5 pts × 3
    await prisma.project.update({ where: { code: 'PRJ-CAP-0001' }, data: { mandaysPerPoint: 2 } });
  });
});
