import { prisma } from '../../lib/prisma.js';
import type { Prisma, Role } from '@prisma/client';
import { NotFound } from '../../lib/errors.js';
import { assessActivationReadiness, assessPlanningStatus, type ActivationReadiness } from './activation.helpers.js';
import { createNotification } from '../notification/notification.service.js';

export type { ActivationItem, ActivationReadiness, ActivationInputs } from './activation.helpers.js';
export { assessActivationReadiness } from './activation.helpers.js';

// Roles that see the whole portfolio; everyone else is scoped to the projects they PM.
const GLOBAL_ROLES: Role[] = ['ADMIN', 'PMO'];

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
 * Rich activation-review summary for the PMO decision card: the project's Scope (Charter),
 * Budget (Cost Baseline) and Schedule (WBS), plus the baseline-readiness checklist and any
 * current review state. Composes existing data (charter / cost baseline / task aggregates) in
 * one call so the review popup needs a single request. Read-only.
 */
export async function getActivationReview(projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true, code: true, name: true, status: true, deliveryApproach: true, scheduleBaselinedAt: true,
      activationReviewStatus: true, activationReviewNote: true, activationReviewAt: true, activationReviewById: true,
    },
  });
  if (!project) throw NotFound('Project not found');

  const [readiness, charter, costBaseline, taskCount, milestoneCount, dateAgg, reviewer, sprintCount, backlogCount] = await Promise.all([
    getActivationReadiness(projectId),
    prisma.projectCharter.findUnique({ where: { projectId }, select: { hiScope: true, hiDeliverables: true, goals: true, description: true, hiCostIdr: true, hiScheduleStart: true, hiScheduleEnd: true, committedAt: true } }),
    prisma.costBaseline.findUnique({ where: { projectId }, select: { directTotal: true, indirectTotal: true, contingencyReserve: true, managementReserve: true, costBaseline: true, budgetAtCompletion: true } }),
    prisma.task.count({ where: { projectId } }),
    prisma.task.count({ where: { projectId, isMilestone: true } }),
    prisma.task.aggregate({ where: { projectId }, _min: { planStart: true }, _max: { planEnd: true } }),
    project.activationReviewById ? prisma.user.findUnique({ where: { id: project.activationReviewById }, select: { name: true } }) : Promise.resolve(null),
    prisma.sprint.count({ where: { projectId } }),
    prisma.backlogItem.count({ where: { projectId } }),
  ]);

  const start = dateAgg._min.planStart ?? null;
  const end = dateAgg._max.planEnd ?? null;
  const durationDays = start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1) : null;

  return {
    project: { id: project.id, code: project.code, name: project.name, status: project.status, deliveryApproach: project.deliveryApproach },
    readiness,
    review: { status: project.activationReviewStatus, note: project.activationReviewNote, at: project.activationReviewAt, by: reviewer?.name ?? null },
    charter: charter && {
      scope: charter.hiScope, deliverables: charter.hiDeliverables, goals: charter.goals, description: charter.description,
      hiCostIdr: Number(charter.hiCostIdr), start: charter.hiScheduleStart, end: charter.hiScheduleEnd, committedAt: charter.committedAt,
    },
    budget: costBaseline && {
      direct: Number(costBaseline.directTotal), indirect: Number(costBaseline.indirectTotal),
      contingency: Number(costBaseline.contingencyReserve), managementReserve: Number(costBaseline.managementReserve),
      bac: Number(costBaseline.costBaseline), totalBudget: Number(costBaseline.budgetAtCompletion),
    },
    schedule: {
      deliveryApproach: project.deliveryApproach, hasWbs: taskCount > 0,
      taskCount, milestoneCount, start, end, durationDays,
      scheduleBaselinedAt: project.scheduleBaselinedAt, sprintCount, backlogCount,
    },
  };
}

/**
 * PMO governance queue for the dashboard: chartered projects whose baselines are set
 * (activation-ready), so ADMIN/PMO can see what's waiting for them to activate. Unlike
 * the one-time bell notification, this is derived from live state — it stays listed until
 * the project is actually activated. ADMIN/PMO only (they hold the activation gate).
 * Projects sent back to the PM (activationReviewStatus set) leave the queue until resubmitted.
 */
export async function getAwaitingActivation(role: string) {
  if (role !== 'ADMIN' && role !== 'PMO') return { items: [], count: 0 };

  const projects = await prisma.project.findMany({
    // personalOwnerId: null → this corporate ADMIN/PMO queue never lists guest projects.
    // activationReviewStatus: null → rejected / needs-revision projects drop out until resubmitted.
    where: { status: 'CHARTERED', deletedAt: null, personalOwnerId: null, activationReviewStatus: null },
    select: { id: true, code: true, name: true, deliveryApproach: true, baselineLockedAt: true, scheduleBaselinedAt: true, pm: { select: { name: true } } },
    orderBy: { code: 'asc' },
  });
  if (!projects.length) return { items: [], count: 0 };

  // hasWbs per project in one grouped query (no N+1).
  const counts = await prisma.task.groupBy({ by: ['projectId'], where: { projectId: { in: projects.map((p) => p.id) } }, _count: { _all: true } });
  const hasWbs = new Map(counts.map((c) => [c.projectId, c._count._all > 0]));

  const items = projects
    .filter((p) => assessActivationReadiness({
      baselineLocked: p.baselineLockedAt != null,
      scheduleBaselined: p.scheduleBaselinedAt != null,
      hasWbs: hasWbs.get(p.id) ?? false,
      deliveryApproach: p.deliveryApproach,
    }).canActivate)
    .map((p) => ({ id: p.id, code: p.code, name: p.name, pm: p.pm?.name ?? '—' }));

  return { items, count: items.length };
}

/**
 * Dashboard "Set Baseline" reminder: still-in-planning projects (DRAFT or CHARTERED)
 * with at least one of Charter / Cost baseline / Schedule baseline still outstanding.
 * Complements getAwaitingActivation (which lists projects where all three ARE done and
 * are only waiting on the activation gate). Role-scoped: ADMIN/PMO see the whole
 * portfolio; a PM sees only the projects they own. Fully-planned or executing/closed
 * projects are excluded.
 */
export async function getPlanningReminders(userId: string, role: string) {
  const where: Prisma.ProjectWhereInput = { deletedAt: null, status: { in: ['DRAFT', 'CHARTERED'] } };
  if (role === 'GUEST') {
    where.personalOwnerId = userId; // a guest sees their own planning reminders
  } else {
    where.personalOwnerId = null; // corporate reminders exclude personal (guest) projects
    if (!GLOBAL_ROLES.includes(role as Role)) where.pmUserId = userId;
  }

  const projects = await prisma.project.findMany({
    where,
    select: { id: true, code: true, name: true, status: true, baselineLockedAt: true, scheduleBaselinedAt: true, pm: { select: { name: true } } },
    orderBy: { code: 'asc' },
  });
  if (!projects.length) return { items: [], count: 0 };

  // hasWbs per project in one grouped query (no N+1).
  const counts = await prisma.task.groupBy({ by: ['projectId'], where: { projectId: { in: projects.map((p) => p.id) } }, _count: { _all: true } });
  const hasWbs = new Map(counts.map((c) => [c.projectId, c._count._all > 0]));

  const items = projects
    .map((p) => ({
      p,
      s: assessPlanningStatus({
        status: p.status,
        baselineLocked: p.baselineLockedAt != null,
        scheduleBaselined: p.scheduleBaselinedAt != null,
        hasWbs: hasWbs.get(p.id) ?? false,
      }),
    }))
    .filter(({ s }) => s.inPlanning && !s.complete)
    .map(({ p, s }) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      pm: p.pm?.name ?? '—',
      charter: s.charter,
      cost: s.cost,
      schedule: s.schedule,
      scheduleNa: s.scheduleNa,
    }));

  return { items, count: items.length };
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
      select: { id: true, name: true, code: true, status: true, activationReadyNotifiedAt: true, personalOwnerId: true },
    });
    // Only for a chartered project that hasn't already been announced as ready.
    if (!project || project.status !== 'CHARTERED' || project.activationReadyNotifiedAt) return;
    // Personal (guest) projects self-activate — never ping corporate ADMIN/PMO.
    if (project.personalOwnerId) return;

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
