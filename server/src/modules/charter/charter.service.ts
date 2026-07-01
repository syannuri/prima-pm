import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, Conflict, NotFound } from '../../lib/errors.js';
import {
  canEditCharter,
  checkCharterCompleteness,
  buildCharterSnapshot,
} from './charter.helpers.js';
import { createNotification } from '../notification/notification.service.js';
import type { UpsertCharterInput, ChangeRequestInput } from './charter.schemas.js';

export async function getCharter(projectId: string) {
  const charter = await prisma.projectCharter.findUnique({ where: { projectId } });
  return charter; // may be null (not created yet)
}

// Create or update the charter. Blocked once the charter is committed/locked.
export async function upsertCharter(
  projectId: string,
  input: UpsertCharterInput,
  actorId: string,
) {
  const existing = await prisma.projectCharter.findUnique({ where: { projectId } });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, code: true, pmUserId: true } });

  const guard = canEditCharter(existing);
  if (!guard.allowed) throw Conflict(guard.reason!);

  const data = {
    description: input.description,
    goals: input.goals,
    category: input.category as never,
    hiScope: input.hiScope,
    hiCostIdr: input.hiCostIdr,
    hiScheduleStart: input.hiScheduleStart,
    hiScheduleEnd: input.hiScheduleEnd,
    hiDeliverables: input.hiDeliverables,
    pmUserId: input.pmUserId,
  };

  // Write the charter and sync the project's PM together — Project.pmUserId
  // drives RBAC ownership, so it must never diverge from the charter on a
  // partial failure.
  const charter = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.projectCharter.update({ where: { projectId }, data })
      : await tx.projectCharter.create({ data: { ...data, projectId, version: 1, locked: false } });
    await tx.project.update({
      where: { id: projectId },
      data: {
        pmUserId: input.pmUserId,
        ...(input.deliveryApproach ? { deliveryApproach: input.deliveryApproach } : {}),
        ...(input.sponsor !== undefined ? { sponsor: input.sponsor } : {}),
      },
    });
    return saved;
  });

  await writeAudit({ projectId,
    userId: actorId,
    entity: 'ProjectCharter',
    entityId: charter.id,
    action: existing ? 'UPDATE' : 'CREATE',
    after: charter,
  });
  // Notify the PM if the charter (re)assigned them to this project.
  if (input.pmUserId && input.pmUserId !== project?.pmUserId && input.pmUserId !== actorId) {
    await createNotification({
      userId: input.pmUserId,
      type: 'PROJECT_ASSIGNED',
      title: 'Assigned as Project Manager',
      body: `You've been assigned as PM of "${project?.name ?? 'a project'}"${project?.code ? ` (${project.code})` : ''}.`,
      projectId,
    });
  }
  return charter;
}

// Commit = lock the baseline, snapshot the version, advance project status.
export async function commitCharter(projectId: string, actorId: string) {
  const charter = await prisma.projectCharter.findUnique({ where: { projectId } });
  if (!charter) throw NotFound('Charter has not been created yet');
  if (charter.locked) throw Conflict('Charter is already committed');

  // Defensive completeness check (DB record could have been partially populated).
  const completeness = checkCharterCompleteness(charter as unknown as Record<string, unknown>);
  if (!completeness.ok) {
    throw BadRequest('Charter is incomplete; all fields are mandatory before commit', {
      missing: completeness.missing,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const snapshot = buildCharterSnapshot(charter as unknown as Record<string, unknown>);

    await tx.charterVersion.create({
      data: {
        projectId,
        version: charter.version,
        snapshot: snapshot as object,
        committedBy: actorId,
      },
    });

    const committed = await tx.projectCharter.update({
      where: { projectId },
      data: { locked: true, committedAt: new Date(), committedBy: actorId },
    });

    // Unlock downstream modules by moving the project past DRAFT.
    await tx.project.update({
      where: { id: projectId },
      data: { status: 'CHARTERED' },
    });

    // Ensure a CostBaseline row exists for downstream roll-ups.
    await tx.costBaseline.upsert({
      where: { projectId },
      create: { projectId },
      update: {},
    });

    return committed;
  });

  await writeAudit({ projectId,
    userId: actorId,
    entity: 'ProjectCharter',
    entityId: result.id,
    action: 'COMMIT',
    after: { version: result.version, committedAt: result.committedAt },
  });
  return result;
}

// Raise a Change Request to edit a committed charter.
export async function createChangeRequest(
  projectId: string,
  input: ChangeRequestInput,
  actorId: string,
) {
  const charter = await prisma.projectCharter.findUnique({ where: { projectId } });
  if (!charter) throw NotFound('Charter has not been created yet');
  if (!charter.locked) throw BadRequest('Charter is not committed; edit it directly instead');

  const cr = await prisma.changeRequest.create({
    data: {
      projectId,
      type: 'CHARTER',
      title: input.title,
      description: input.description,
      chargeable: input.chargeable,
      magnitude: input.magnitude,
      impactAreas: input.impactAreas,
      status: 'SUBMITTED',
      requestedBy: actorId,
    },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'ChangeRequest', entityId: cr.id, action: 'CREATE', after: cr });
  // Notify the approvers (ADMIN/PMO) that a change request awaits their decision.
  const [project, approvers] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { name: true, code: true } }),
    prisma.user.findMany({ where: { role: { in: ['ADMIN', 'PMO'] }, isActive: true }, select: { id: true } }),
  ]);
  for (const a of approvers) {
    if (a.id === actorId) continue;
    await createNotification({
      userId: a.id,
      type: 'CR_SUBMITTED',
      title: 'Change request awaits your decision',
      body: `"${input.title}" on "${project?.name ?? 'a project'}"${project?.code ? ` (${project.code})` : ''} needs approval.`,
      projectId,
    });
  }
  return cr;
}

// PMO/ADMIN decision. Approval unlocks the charter and advances the version.
export async function decideChangeRequest(
  projectId: string,
  crId: string,
  decision: 'APPROVED' | 'REJECTED',
  actorId: string,
) {
  const cr = await prisma.changeRequest.findUnique({ where: { id: crId } });
  if (!cr || cr.projectId !== projectId) throw NotFound('Change Request not found');
  if (cr.status !== 'SUBMITTED' && cr.status !== 'UNDER_REVIEW') {
    throw Conflict('Change Request has already been decided');
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedCr = await tx.changeRequest.update({
      where: { id: crId },
      data: { status: decision, decidedBy: actorId, decidedAt: new Date() },
    });

    if (decision === 'APPROVED' && cr.type === 'CHARTER') {
      // Unlock for editing and bump version so the next commit snapshots a new version.
      await tx.projectCharter.update({
        where: { projectId },
        data: { locked: false, version: { increment: 1 } },
      });
    }
    return updatedCr;
  });

  await writeAudit({ projectId,
    userId: actorId,
    entity: 'ChangeRequest',
    entityId: crId,
    action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: result,
  });

  // Notify the requester (the PM who raised it) of the decision — mirrors the
  // CR_SUBMITTED notification that approvers receive. Skip self-decisions.
  if (cr.requestedBy && cr.requestedBy !== actorId) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, code: true } });
    const where = `on "${project?.name ?? 'a project'}"${project?.code ? ` (${project.code})` : ''}`;
    await createNotification({
      userId: cr.requestedBy,
      type: decision === 'APPROVED' ? 'CR_APPROVED' : 'CR_REJECTED',
      title: `Change request ${decision === 'APPROVED' ? 'approved' : 'rejected'}`,
      body: `Your change request "${cr.title}" ${where} was ${decision === 'APPROVED' ? 'approved' : 'rejected'}.`,
      projectId,
    });
  }
  return result;
}

export async function listCharterVersions(projectId: string) {
  return prisma.charterVersion.findMany({
    where: { projectId },
    orderBy: { version: 'desc' },
  });
}

export async function listChangeRequests(projectId: string) {
  return prisma.changeRequest.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    include: {
      requester: { select: { name: true } },
      reviewer: { select: { name: true } },
      decider: { select: { name: true } },
    },
  });
}

// Mark a submitted CR as under review (records who reviewed it and when). Idempotent
// once it has moved past SUBMITTED.
export async function reviewChangeRequest(projectId: string, crId: string, actorId: string) {
  const cr = await prisma.changeRequest.findUnique({ where: { id: crId } });
  if (!cr || cr.projectId !== projectId) throw NotFound('Change Request not found');
  if (cr.status === 'SUBMITTED') {
    await prisma.changeRequest.update({
      where: { id: crId },
      data: { status: 'UNDER_REVIEW', reviewedBy: actorId, reviewedAt: new Date() },
    });
    await writeAudit({ projectId, userId: actorId, entity: 'ChangeRequest', entityId: crId, action: 'UPDATE', before: { status: cr.status }, after: { status: 'UNDER_REVIEW' } });
  }
  return prisma.changeRequest.findUnique({
    where: { id: crId },
    include: { requester: { select: { name: true } }, reviewer: { select: { name: true } }, decider: { select: { name: true } } },
  });
}
