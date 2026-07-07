import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { getActivationReadiness } from './activation.js';
import { getClosureReadiness } from './closure.js';
import { computeNextSteps, type NextStepsInput, type NextStepsResult, type ProjectStage } from './nextsteps.helpers.js';

export type { NextStep, NextStepsResult } from './nextsteps.helpers.js';

// Gather the live state and compute the guided next-step cues. Readiness is only
// resolved for the stage that needs it (activation for CHARTERED, closure for
// IN_PROGRESS) to keep the endpoint cheap. Pure logic lives in nextsteps.helpers.ts.
export async function getNextSteps(projectId: string, viewerRole: string): Promise<NextStepsResult> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { status: true, baselineLockedAt: true, scheduleBaselinedAt: true },
  });
  if (!project) throw NotFound('Project not found');

  const status = project.status as ProjectStage;
  const input: NextStepsInput = {
    status,
    baselineLocked: project.baselineLockedAt != null,
    scheduleBaselined: project.scheduleBaselinedAt != null,
    hasWbs: false,
    activationReady: false,
    openHighRisks: 0,
    hasAcceptance: false,
    hasLessons: false,
    closureReady: false,
    // Lifecycle governance (activate/resume/close) is ADMIN/PMO-only; a PM sees those
    // cues as informational ("awaiting PMO") rather than actions they can perform.
    canGovern: viewerRole === 'ADMIN' || viewerRole === 'PMO',
  };

  if (status === 'CHARTERED') {
    const [readiness, taskCount] = await Promise.all([
      getActivationReadiness(projectId),
      prisma.task.count({ where: { projectId } }),
    ]);
    input.activationReady = readiness.canActivate;
    input.hasWbs = taskCount > 0;
  } else if (status === 'IN_PROGRESS') {
    const [readiness, taskCount, openHighRisks] = await Promise.all([
      getClosureReadiness(projectId),
      prisma.task.count({ where: { projectId } }),
      prisma.risk.count({
        where: { projectId, severity: { in: ['HIGH', 'CRITICAL'] }, status: { in: ['IDENTIFIED', 'ANALYZING', 'PLANNED', 'OPEN'] } },
      }),
    ]);
    const ok = (key: string) => readiness.items.find((it) => it.key === key)?.ok ?? false;
    input.closureReady = readiness.canClose;
    input.hasAcceptance = ok('acceptance');
    input.hasLessons = ok('lessons');
    input.hasWbs = taskCount > 0;
    input.openHighRisks = openHighRisks;
  }

  return computeNextSteps(input);
}
