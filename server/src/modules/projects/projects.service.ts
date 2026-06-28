import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound, BadRequest } from '../../lib/errors.js';
import { generateProjectCode } from '../charter/charter.helpers.js';
import type { CreateProjectInput, UpdateProjectInput } from './projects.schemas.js';

const GLOBAL_ROLES: Role[] = ['ADMIN', 'PMO'];

// List projects visible to the caller (global roles see all; others see owned).
export async function listProjects(userId: string, role: Role) {
  const where: Prisma.ProjectWhereInput = { deletedAt: null };
  if (!GLOBAL_ROLES.includes(role)) where.pmUserId = userId;

  return prisma.project.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      pm: { select: { id: true, name: true, email: true } },
      charter: { select: { id: true, locked: true, version: true, category: true } },
      costBaseline: { select: { budgetAtCompletion: true } },
    },
  });
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
    const countThisYear = await tx.project.count({
      where: { code: { startsWith: `PRJ-${year}-` } },
    });
    const code = generateProjectCode(year, countThisYear + 1);

    return tx.project.create({
      data: {
        code,
        name: input.name,
        sponsor: input.sponsor ?? null,
        pmUserId: input.pmUserId ?? null,
        status: 'DRAFT',
      },
    });
  });

  await writeAudit({ projectId: project.id, userId: actorId, entity: 'Project', entityId: project.id, action: 'CREATE', after: project });
  return project;
}

export async function updateProject(id: string, input: UpdateProjectInput, actorId: string) {
  const before = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw NotFound('Project not found');

  const project = await prisma.project.update({
    where: { id },
    data: {
      name: input.name ?? undefined,
      sponsor: input.sponsor === undefined ? undefined : input.sponsor,
      pmUserId: input.pmUserId === undefined ? undefined : input.pmUserId,
      status: input.status ?? undefined,
    },
  });

  await writeAudit({ projectId: id, userId: actorId, entity: 'Project', entityId: id, action: 'UPDATE', before, after: project });
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
