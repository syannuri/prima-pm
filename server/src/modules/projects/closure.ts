import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
// Methodology dispatcher (AGILE → points, HYBRID → blended, else → WBS) so the closure
// schedule check reflects the project's ACTUAL delivery approach — matching the Dashboard/
// Portfolio/Forecast. Using WBS-only getEvm made an agile project's schedule read as "no
// WBS" and a hybrid project's read ignore its agile stream.
import { getProjectEvm } from '../agile/agile.service.js';
import { actualCostAsOf } from '../cost/cost.service.js';
import { assessClosureReadiness, type ClosureReadiness } from './closure.helpers.js';

export type { ClosureItem, ClosureReadiness, ClosureInputs } from './closure.helpers.js';
export { assessClosureReadiness } from './closure.helpers.js';

// Gather the live state for a project and assess it against the closure policy
// (pure logic lives in closure.helpers.ts so it can be unit-tested without a DB).
export async function getClosureReadiness(projectId: string): Promise<ClosureReadiness> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, deliveryApproach: true },
  });
  if (!project) throw NotFound('Project not found');

  const now = new Date();
  const [evm, openChangeRequests, openHighRisks, openIssues, actualCost, openBacklogItems, lessonsCount, acceptedCount] =
    await Promise.all([
      getProjectEvm(projectId, undefined, now),
      prisma.changeRequest.count({ where: { projectId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
      prisma.risk.count({
        where: { projectId, severity: { in: ['HIGH', 'CRITICAL'] }, status: { in: ['IDENTIFIED', 'ANALYZING', 'PLANNED', 'OPEN'] } },
      }),
      prisma.issue.count({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      actualCostAsOf(projectId, now),
      prisma.backlogItem.count({ where: { projectId, status: { not: 'DONE' } } }),
      prisma.lessonLearned.count({ where: { projectId } }),
      // A rejection isn't an acceptance — only ACCEPTED / ACCEPTED_WITH_CONDITIONS counts.
      prisma.acceptanceSignoff.count({ where: { projectId, decision: { in: ['ACCEPTED', 'ACCEPTED_WITH_CONDITIONS'] } } }),
    ]);

  return assessClosureReadiness({
    leafTaskCount: evm.leafTaskCount,
    scheduleProgress: evm.scheduleProgress,
    openChangeRequests,
    openHighRisks,
    openIssues,
    actualCost,
    deliveryApproach: project.deliveryApproach,
    openBacklogItems,
    lessonsCount,
    hasAcceptance: acceptedCount > 0,
  });
}

/**
 * PMO governance queue for the dashboard: in-progress projects that have met the closure
 * gate (delivery complete) and are ready for ADMIN/PMO to close. The mirror of
 * getAwaitingActivation — it closes the PM→PMO handoff the Next-steps guide promises
 * ("waiting for PMO to close"). Each item carries the state of the two closeout artifacts
 * (acceptance sign-off / lessons learned) so the PMO can see whether the PM still has
 * closeout work outstanding. ADMIN/PMO only (they hold the close gate).
 *
 * Closure readiness is heavier than activation (an EVM roll-up plus several counts), so it's
 * resolved per project in parallel; portfolios here are small. Only canClose projects surface.
 */
export async function getAwaitingClosure(role: string) {
  if (role !== 'ADMIN' && role !== 'PMO') return { items: [], count: 0 };

  const projects = await prisma.project.findMany({
    // personalOwnerId: null → this corporate ADMIN/PMO queue never lists guest projects.
    where: { status: 'IN_PROGRESS', deletedAt: null, personalOwnerId: null },
    select: { id: true, code: true, name: true, pm: { select: { name: true } } },
    orderBy: { code: 'asc' },
  });
  if (!projects.length) return { items: [], count: 0 };

  const assessed = await Promise.all(projects.map(async (p) => ({ p, r: await getClosureReadiness(p.id) })));
  const isOk = (r: ClosureReadiness, key: string) => r.items.find((it) => it.key === key)?.ok ?? false;
  const items = assessed
    .filter(({ r }) => r.canClose)
    .map(({ p, r }) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      pm: p.pm?.name ?? '—',
      hasAcceptance: isOk(r, 'acceptance'),
      hasLessons: isOk(r, 'lessons'),
    }));

  return { items, count: items.length };
}
