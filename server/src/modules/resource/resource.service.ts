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

  // Agile assignments → capacity: an assigned backlog item on an AGILE/HYBRID project, sitting
  // in a DATED sprint, loads its assignee for (storyPoints × the project's mandaysPerPoint),
  // spread over the sprint window. Resolved to the assignee's linked Resource where one exists
  // (so agile + manpower load combine under one resource), else keyed by the user.
  const agileItems = await prisma.backlogItem.findMany({
    where: {
      projectId: { in: projectIds },
      assigneeUserId: { not: null },
      storyPoints: { gt: 0 },
      sprint: { is: { startDate: { not: null }, endDate: { not: null } } },
      project: { deliveryApproach: { in: ['AGILE', 'HYBRID'] } },
    },
    select: {
      storyPoints: true,
      status: true,
      assigneeUserId: true,
      assignee: { select: { name: true } },
      sprint: { select: { startDate: true, endDate: true } },
      project: { select: { id: true, code: true, name: true, mandaysPerPoint: true } },
    },
  });
  if (agileItems.length) {
    const assigneeIds = [...new Set(agileItems.map((i) => i.assigneeUserId).filter((x): x is string => !!x))];
    const resByUser = new Map<string, { id: string; name: string; capacityPerDay: number }>();
    const resources = await prisma.resource.findMany({
      where: { userId: { in: assigneeIds }, personalOwnerId: null },
      select: { id: true, name: true, capacityPerDay: true, userId: true },
    });
    for (const r of resources) if (r.userId) resByUser.set(r.userId, { id: r.id, name: r.name, capacityPerDay: Number(r.capacityPerDay) });

    const statusProgress = (s: string) => (s === 'DONE' ? 100 : s === 'IN_PROGRESS' ? 50 : 0);
    for (const i of agileItems) {
      const uid = i.assigneeUserId!;
      const res = resByUser.get(uid);
      inputs.push({
        resourceKey: res ? `R:${res.id}` : `U:${uid}`,
        resourceName: res?.name ?? i.assignee?.name ?? 'Unknown',
        capacityPerDay: res?.capacityPerDay ?? 1,
        personnelRole: null,
        projectId: i.project.id,
        projectCode: i.project.code,
        projectName: i.project.name,
        planMandays: (i.storyPoints ?? 0) * Number(i.project.mandaysPerPoint),
        taskStart: i.sprint?.startDate ?? null,
        taskEnd: i.sprint?.endDate ?? null,
        progressPct: statusProgress(i.status),
        consumedMandays: 0,
      });
    }
  }

  return buildCapacityReport(inputs, granularity, q.from, q.to);
}
