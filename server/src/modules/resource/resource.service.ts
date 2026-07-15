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
  if (role === 'GUEST') {
    where.personalOwnerId = userId;
  } else {
    where.personalOwnerId = null; // corporate capacity view excludes personal (guest) projects
    if (!GLOBAL_ROLES.includes(role as Role)) where.pmUserId = userId;
  }

  const projects = await prisma.project.findMany({ where, select: { id: true } });
  const projectIds = projects.map((p) => p.id);

  const granularity: Granularity = q.granularity ?? 'month';
  if (projectIds.length === 0) {
    return buildCapacityReport([], granularity, q.from, q.to);
  }

  const items = await prisma.costItemDirect.findMany({
    where: { type: 'MANPOWER', projectId: { in: projectIds } },
    select: {
      id: true,
      label: true,
      personnelRole: true,
      planMandays: true,
      resourceId: true,
      resourceUserId: true,
      resource: { select: { name: true } },
      resourceRef: { select: { name: true, capacityPerDay: true } },
      projectId: true,
      project: { select: { code: true, name: true } },
      task: { select: { planStart: true, planEnd: true, progressPct: true } },
    },
  });

  // Actual man-days logged per manpower line (timesheet) → consumed effort.
  const consumedGroups = await prisma.mandayEntry.groupBy({
    by: ['costItemId'],
    where: { costItemId: { in: items.map((i) => i.id) } },
    _sum: { mandays: true },
  });
  const consumedByLine = new Map(consumedGroups.map((g) => [g.costItemId, dec(g._sum.mandays)]));

  const inputs: AllocationInput[] = items.map((i) => ({
    // Prefer the master resource as the cross-project key; else a linked user;
    // else scope an unnamed line to its project+label.
    resourceKey: i.resourceId
      ? `R:${i.resourceId}`
      : i.resourceUserId
        ? `U:${i.resourceUserId}`
        : `L:${i.projectId}:${i.label}`,
    resourceName: i.resourceRef?.name ?? i.resource?.name ?? i.label,
    capacityPerDay: i.resourceRef ? Number(i.resourceRef.capacityPerDay) : 1,
    personnelRole: i.personnelRole ?? null,
    projectId: i.projectId,
    projectCode: i.project.code,
    projectName: i.project.name,
    planMandays: dec(i.planMandays),
    taskStart: i.task?.planStart ?? null,
    taskEnd: i.task?.planEnd ?? null,
    progressPct: i.task?.progressPct ?? 0,
    consumedMandays: consumedByLine.get(i.id) ?? 0,
  }));

  return buildCapacityReport(inputs, granularity, q.from, q.to);
}
