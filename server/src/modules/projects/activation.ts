import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { assessActivationReadiness, type ActivationReadiness } from './activation.helpers.js';
import { createNotification } from '../notification/notification.service.js';

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

/**
 * When a chartered project's baselines are all set (it just became activation-ready),
 * notify ADMIN/PMO that it's ready to start execution — activation is their gate, so
 * this is a push instead of them polling the dashboard. Fires ONCE per project
 * (guarded by Project.activationReadyNotifiedAt) and skips the actor if they are
 * themselves an ADMIN/PMO. Best-effort: never throws into the calling mutation.
 * Call this AFTER a baseline-completing mutation (cost baseline lock / schedule
 * baseline capture) from the route layer, to avoid a service import cycle.
 */
export async function notifyActivationReady(projectId: string, actorId: string): Promise<void> {
  try {
    const project = await prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true, name: true, code: true, status: true, activationReadyNotifiedAt: true },
    });
    // Only for a chartered project that hasn't already been announced as ready.
    if (!project || project.status !== 'CHARTERED' || project.activationReadyNotifiedAt) return;

    const readiness = await getActivationReadiness(projectId);
    if (!readiness.canActivate) return;

    const recipients = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'PMO'] }, isActive: true, NOT: { id: actorId } },
      select: { id: true },
    });
    await Promise.all(
      recipients.map((r) =>
        createNotification({
          userId: r.id,
          type: 'ACTIVATION_READY',
          title: 'Project ready to activate',
          body: `"${project.name}" (${project.code}) has its baselines set and is ready to start execution.`,
          projectId: project.id,
        }),
      ),
    );
    // Stamp so the alert fires only once (even if the baseline is unlocked & re-locked later).
    await prisma.project.update({ where: { id: project.id }, data: { activationReadyNotifiedAt: new Date() } });
  } catch {
    // Notification is best-effort; a failure must never break the baseline mutation.
  }
}
