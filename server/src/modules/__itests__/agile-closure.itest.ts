import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { getClosureReadiness } from '../projects/closure.js';
import { getProjectEvm } from '../agile/agile.service.js';

// Agile closeout is judged by ITEM completion + formal acceptance — NOT story points.
// Reproduces the real PRJ-2026-0013 case: a partly-estimated backlog whose points read 100%
// while items are still open must NOT be closeable.
describe('Agile closure gate (item-based scope + acceptance)', () => {
  let projectId = '';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
    if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

    const admin = await prisma.user.create({ data: { name: 'Clo Admin', email: 'clo-admin@t.test', role: 'ADMIN', passwordHash: await hashPassword('Clo-Pass-1'), isActive: true } });
    const project = await prisma.project.create({ data: { code: 'PRJ-CLO-0001', name: 'Agile Closeout', status: 'IN_PROGRESS', deliveryApproach: 'AGILE', pmUserId: admin.id } });
    projectId = project.id;

    // Only ONE item is estimated (5 pts) and it's DONE → story-point progress = 5/5 = 100%.
    // The other three carry NO points and are still open — points hide them, items don't.
    const mk = async (title: string, storyPoints: number | null, status: string) =>
      (await prisma.backlogItem.create({ data: { projectId, title, type: 'STORY', storyPoints, status: status as never, priority: 0, sortOrder: 0 } })).id;
    ids.done = await mk('Estimated & done', 5, 'DONE');
    ids.a = await mk('Open A', null, 'IN_PROGRESS');
    ids.b = await mk('Open B', null, 'IN_PROGRESS');
    ids.c = await mk('Open C', null, 'TODO');
  });

  it('is NOT closeable despite story points reading 100% (3 items still open)', async () => {
    // Sanity: the points-based EVM really does read 100% here.
    const evm = await getProjectEvm(projectId, undefined, new Date());
    expect(evm.scheduleProgress).toBe(1);

    const r = await getClosureReadiness(projectId);
    expect(r.canClose).toBe(false);
    const scope = r.blockers.find((b) => b.key === 'scope');
    expect(scope).toBeTruthy();
    expect(scope!.detail).toContain('3 still open');
    // Acceptance is also a hard block for agile.
    expect(r.blockers.map((b) => b.key)).toContain('acceptance');
    // Story points are NOT used as a closure gate — no 'schedule' block on a pure-agile project.
    expect(r.blockers.some((b) => b.key === 'schedule')).toBe(false);
  });

  it('DEFERRING the open items clears the scope blocker (acceptance still required)', async () => {
    await prisma.backlogItem.updateMany({ where: { id: { in: [ids.a, ids.b, ids.c] } }, data: { status: 'DEFERRED' } });
    const r = await getClosureReadiness(projectId);
    expect(r.items.find((i) => i.key === 'scope')!.ok).toBe(true);
    expect(r.canClose).toBe(false); // acceptance still missing
    expect(r.blockers.map((b) => b.key)).toEqual(['acceptance']);
  });

  it('is closeable once a formal acceptance sign-off is on record', async () => {
    await prisma.acceptanceSignoff.create({ data: { projectId, party: 'Customer — PT AMB', decision: 'ACCEPTED' } });
    const r = await getClosureReadiness(projectId);
    expect(r.canClose).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });

  it('excludes DEFERRED items from agile EVM points', async () => {
    // 3 of 4 items are DEFERRED; only the 5-pt DONE item remains in scope → still 100%,
    // but the deferred (unestimated) items no longer sit in the plan.
    const evm = await getProjectEvm(projectId, undefined, new Date());
    expect(evm.leafTaskCount).toBe(1);
    expect(evm.scheduleProgress).toBe(1);
  });
});
