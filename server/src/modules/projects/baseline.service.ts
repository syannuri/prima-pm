import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, NotFound } from '../../lib/errors.js';

type Db = Prisma.TransactionClient | typeof prisma;

// Throws if the project's baseline is locked. Called by every baseline-DEFINING mutation
// (cost lines, management reserve, WBS tasks, schedule baseline) so the PMB/BAC cannot
// shift without a deliberate, audited unlock. Progress/actuals and risks are NOT gated by
// this — they legitimately evolve during execution.
export async function assertBaselineUnlocked(projectId: string, db: Db = prisma): Promise<void> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { baselineLockedAt: true } });
  if (p?.baselineLockedAt) {
    throw BadRequest('The project baseline is locked. Unlock it (ADMIN/PMO) before changing cost lines, the WBS or the schedule baseline.');
  }
}

// Lock or unlock the baseline. Unlocking requires a reason (it re-opens the PMB/BAC to
// change — the deliberate control the change-request process should drive). Audited.
export async function setBaselineLock(projectId: string, locked: boolean, reason: string | undefined, actorId: string) {
  const before = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, baselineLockedAt: true },
  });
  if (!before) throw NotFound('Project not found');
  const wasLocked = before.baselineLockedAt != null;
  if (!locked && wasLocked && !reason?.trim()) {
    throw BadRequest('Unlocking the baseline requires a reason.');
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: locked
      ? { baselineLockedAt: new Date(), baselineLockedById: actorId }
      : { baselineLockedAt: null, baselineLockedById: null },
  });
  await writeAudit({
    projectId,
    userId: actorId,
    entity: 'Project',
    entityId: projectId,
    action: 'UPDATE',
    before: { baselineLocked: wasLocked },
    after: { baselineLocked: locked, reason: reason?.trim() || null },
  });
  return project;
}
