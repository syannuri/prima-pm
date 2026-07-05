import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { assessActivationReadiness, type ActivationReadiness } from './activation.helpers.js';

export type { ActivationItem, ActivationReadiness, ActivationInputs } from './activation.helpers.js';
export { assessActivationReadiness } from './activation.helpers.js';

// Gather the live state for a project and assess it against the activation policy
// (pure logic lives in activation.helpers.ts so it can be unit-tested without a DB).
export async function getActivationReadiness(projectId: string): Promise<ActivationReadiness> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, deliveryApproach: true, baselineLockedAt: true, scheduleBaselinedAt: true },
  });
  if (!project) throw NotFound('Project not found');

  const taskCount = await prisma.task.count({ where: { projectId } });

  return assessActivationReadiness({
    baselineLocked: project.baselineLockedAt != null,
    scheduleBaselined: project.scheduleBaselinedAt != null,
    hasWbs: taskCount > 0,
    deliveryApproach: project.deliveryApproach,
  });
}
