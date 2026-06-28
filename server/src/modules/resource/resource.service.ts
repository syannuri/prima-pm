import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { buildCapacityReport, type AllocationInput, type Granularity } from './resource.helpers.js';

const GLOBAL_ROLES: Role[] = ['ADMIN', 'PMO'];
const dec = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));

export interface CapacityQuery {
  from?: Date;
  to?: Date;
  granularity?: Granularity;
}

// Portfolio-wide manpower allocation vs. capacity, scoped to the caller's visible projects.
export async function getResourceCapacity(userId: string, role: string, q: CapacityQuery) {
  const where: Prisma.ProjectWhereInput = { deletedAt: null };
  if (!GLOBAL_ROLES.includes(role as Role)) where.pmUserId = userId;

  const projects = await prisma.project.findMany({ where, select: { id: true } });
  const projectIds = projects.map((p) => p.id);

  const granularity: Granularity = q.granularity ?? 'month';
  if (projectIds.length === 0) {
    return buildCapacityReport([], granularity, q.from, q.to);
  }

  const items = await prisma.costItemDirect.findMany({
    where: { type: 'MANPOWER', projectId: { in: projectIds } },
    select: {
      label: true,
      personnelRole: true,
      planMandays: true,
      resourceUserId: true,
      resource: { select: { name: true } },
      projectId: true,
      project: { select: { code: true, name: true } },
      task: { select: { planStart: true, planEnd: true } },
    },
  });

  const inputs: AllocationInput[] = items.map((i) => ({
    // A named resource is tracked across projects; an unnamed line is scoped to its project+label.
    resourceKey: i.resourceUserId ? `U:${i.resourceUserId}` : `L:${i.projectId}:${i.label}`,
    resourceName: i.resource?.name ?? i.label,
    personnelRole: i.personnelRole ?? null,
    projectId: i.projectId,
    projectCode: i.project.code,
    projectName: i.project.name,
    planMandays: dec(i.planMandays),
    taskStart: i.task?.planStart ?? null,
    taskEnd: i.task?.planEnd ?? null,
  }));

  return buildCapacityReport(inputs, granularity, q.from, q.to);
}
