import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound, BadRequest, Conflict } from '../../lib/errors.js';
import { generateProjectCode } from '../charter/charter.helpers.js';
import { createNotification } from '../notification/notification.service.js';
import type { CreateProjectInput, UpdateProjectInput } from './projects.schemas.js';
import { getClosureReadiness } from './closure.js';

// Notify a user they've been assigned as a project's PM (skip self-assignment).
export async function notifyPmAssigned(pmUserId: string | null | undefined, actorId: string, project: { id: string; name: string; code: string }) {
  if (!pmUserId || pmUserId === actorId) return;
  await createNotification({
    userId: pmUserId,
    type: 'PROJECT_ASSIGNED',
    title: 'Assigned as Project Manager',
    body: `You've been assigned as PM of "${project.name}" (${project.code}).`,
    projectId: project.id,
  });
}

const GLOBAL_ROLES: Role[] = ['ADMIN', 'PMO'];

// Allowed project-status transitions (lifecycle: DRAFT -> CHARTERED ->
// IN_PROGRESS <-> ON_HOLD -> CLOSED). Charter commit moves DRAFT -> CHARTERED
// via its own flow; this guards manual status edits so a project can't jump
// to an illegal state (e.g. CLOSED -> DRAFT, or skipping CHARTERED). Staying on
// the same status is always allowed (no-op).
const STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['CHARTERED'],
  CHARTERED: ['IN_PROGRESS', 'ON_HOLD', 'CLOSED'],
  IN_PROGRESS: ['ON_HOLD', 'CLOSED'],
  ON_HOLD: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
};

// List projects visible to the caller (global roles see all; others see owned).
export async function listProjects(userId: string, role: Role) {
  const where: Prisma.ProjectWhereInput = { deletedAt: null };
  if (!GLOBAL_ROLES.includes(role)) where.pmUserId = userId;

  const projects = await prisma.project.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      pm: { select: { id: true, name: true, email: true } },
      charter: { select: { id: true, locked: true, version: true, category: true } },
      costBaseline: { select: { budgetAtCompletion: true } },
    },
  });

  // Total recorded changes per project (one grouped query, avoids N+1).
  const changeGroups = await prisma.auditLog.groupBy({
    by: ['projectId'],
    where: { projectId: { in: projects.map((p) => p.id) } },
    _count: { _all: true },
  });
  const changeMap = new Map(changeGroups.map((g) => [g.projectId, g._count._all]));

  return projects.map((p) => ({ ...p, changeCount: changeMap.get(p.id) ?? 0 }));
}

export async function getProject(id: string) {
  const project = await prisma.project.findFirst({
    where: { id, deletedAt: null },
    include: {
      pm: { select: { id: true, name: true, email: true } },
      charter: true,
      costBaseline: true,
    },
  });
  if (!project) throw NotFound('Project not found');
  return project;
}

// Create a project with an auto-generated PRJ-YYYY-#### code (race-safe via transaction).
export async function createProject(input: CreateProjectInput, actorId: string) {
  // Year is derived from the actor's request time; passed explicitly to keep code testable.
  const year = new Date().getFullYear();

  const project = await prisma.$transaction(async (tx) => {
    let code = input.code?.trim();
    if (code) {
      const clash = await tx.project.findUnique({ where: { code }, select: { id: true } });
      if (clash) throw Conflict(`Project code "${code}" is already in use`);
    } else {
      const countThisYear = await tx.project.count({
        where: { code: { startsWith: `PRJ-${year}-` } },
      });
      code = generateProjectCode(year, countThisYear + 1);
    }

    return tx.project.create({
      data: {
        code,
        name: input.name,
        clientName: input.clientName ?? null,
        sponsor: input.sponsor ?? null,
        pmUserId: input.pmUserId ?? null,
        category: input.category ?? null,
        deliveryApproach: input.deliveryApproach ?? 'PREDICTIVE',
        costBaselineIdr: input.costBaselineIdr ?? null,
        totalRevenueIdr: input.totalRevenueIdr ?? null,
        status: 'DRAFT',
      },
    });
  });

  await writeAudit({ projectId: project.id, userId: actorId, entity: 'Project', entityId: project.id, action: 'CREATE', after: project });
  await notifyPmAssigned(project.pmUserId, actorId, project);
  return project;
}

export async function updateProject(id: string, input: UpdateProjectInput, actorId: string) {
  const before = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw NotFound('Project not found');

  // Project code is unique — block a clash with another project.
  const newCode = input.code?.trim();
  if (newCode && newCode !== before.code) {
    const clash = await prisma.project.findUnique({ where: { code: newCode }, select: { id: true } });
    if (clash) throw Conflict(`Project code "${newCode}" is already in use`);
  }

  // Enforce the lifecycle: reject illegal status jumps (same status is a no-op).
  const isClosing = input.status === 'CLOSED' && before.status !== 'CLOSED';
  if (input.status && input.status !== before.status) {
    const allowed = STATUS_TRANSITIONS[before.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw BadRequest(`Cannot change status from ${before.status} to ${input.status}`);
    }
  }

  // Status-transition side effects (closure gate + on-hold reason) accumulate here.
  let statusData: Prisma.ProjectUncheckedUpdateInput = {};

  // Closure gate: moving to CLOSED must pass the readiness check (schedule 100%),
  // unless an ADMIN/PMO force-closes with a mandatory reason (route is ADMIN/PMO-only).
  if (isClosing) {
    const readiness = await getClosureReadiness(id);
    const note = input.closureNote?.trim();
    if (!readiness.canClose && !input.forceClose) {
      throw BadRequest(
        `Project isn't ready to close: ${readiness.blockers.map((b) => `${b.label} (${b.detail})`).join('; ')}. Resolve these or force-close with a reason.`,
        { blockers: readiness.blockers, warnings: readiness.warnings },
      );
    }
    if (input.forceClose && !readiness.canClose && !note) {
      throw BadRequest('Force-closing requires a reason (closureNote).');
    }
    statusData.closedAt = new Date();
    statusData.closedById = actorId;
    statusData.closureNote = note || null;
  }

  // On-hold requires a reason; leaving ON_HOLD (resume/activate) clears it.
  if (input.status === 'ON_HOLD' && before.status !== 'ON_HOLD') {
    const reason = input.holdReason?.trim();
    if (!reason) throw BadRequest('A reason is required to put a project on hold (holdReason).');
    statusData.onHoldReason = reason;
  } else if (before.status === 'ON_HOLD' && input.status && input.status !== 'ON_HOLD') {
    statusData.onHoldReason = null;
  }

  const project = await prisma.project.update({
    where: { id },
    data: {
      name: input.name ?? undefined,
      code: newCode ?? undefined,
      clientName: input.clientName === undefined ? undefined : input.clientName,
      sponsor: input.sponsor === undefined ? undefined : input.sponsor,
      category: input.category === undefined ? undefined : input.category,
      deliveryApproach: input.deliveryApproach ?? undefined,
      costBaselineIdr: input.costBaselineIdr === undefined ? undefined : input.costBaselineIdr,
      totalRevenueIdr: input.totalRevenueIdr === undefined ? undefined : input.totalRevenueIdr,
      pmUserId: input.pmUserId === undefined ? undefined : input.pmUserId,
      status: input.status ?? undefined,
      ...statusData,
    },
  });

  await writeAudit({
    projectId: id,
    userId: actorId,
    entity: 'Project',
    entityId: id,
    action: isClosing && input.forceClose ? 'FORCE_CLOSE' : 'UPDATE',
    before,
    after: project,
  });
  return project;
}

// Reassign a project's PM. Updates both Project.pmUserId (drives RBAC ownership) and
// the committed charter's pmUserId (drives the charter display) so they stay consistent.
export async function reassignPm(projectId: string, pmUserId: string, actorId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
  if (!project) throw NotFound('Project not found');

  const pm = await prisma.user.findFirst({ where: { id: pmUserId, isActive: true } });
  if (!pm) throw BadRequest('Selected user not found or inactive');

  await prisma.$transaction([
    prisma.project.update({ where: { id: projectId }, data: { pmUserId } }),
    prisma.projectCharter.updateMany({ where: { projectId }, data: { pmUserId } }),
  ]);

  await writeAudit({
    projectId,
    userId: actorId,
    entity: 'Project',
    entityId: projectId,
    action: 'UPDATE',
    before: { pmUserId: project.pmUserId },
    after: { pmUserId },
  });
  if (pmUserId !== project.pmUserId) await notifyPmAssigned(pmUserId, actorId, project);
  return getProject(projectId);
}

export async function softDeleteProject(id: string, actorId: string) {
  const project = await prisma.project.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await writeAudit({ projectId: id, userId: actorId, entity: 'Project', entityId: id, action: 'DELETE' });
  return project;
}
