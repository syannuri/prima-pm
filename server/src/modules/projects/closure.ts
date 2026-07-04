import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { getEvm } from '../schedule/schedule.service.js';
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
  const [evm, openChangeRequests, openHighRisks, openIssues, actualCost, openBacklogItems] = await Promise.all([
    getEvm(projectId, undefined, now),
    prisma.changeRequest.count({ where: { projectId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
    prisma.risk.count({
      where: { projectId, severity: { in: ['HIGH', 'CRITICAL'] }, status: { in: ['IDENTIFIED', 'ANALYZING', 'PLANNED', 'OPEN'] } },
    }),
    prisma.issue.count({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    actualCostAsOf(projectId, now),
    prisma.backlogItem.count({ where: { projectId, status: { not: 'DONE' } } }),
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
  });
}
