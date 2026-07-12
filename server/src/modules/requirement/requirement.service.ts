import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound, Conflict } from '../../lib/errors.js';
import type { UpsertRequirementInput } from './requirement.schemas.js';

// REQ-001, REQ-002, …
export function generateRequirementCode(seq: number): string {
  return `REQ-${String(seq).padStart(3, '0')}`;
}

function buildData(input: UpsertRequirementInput) {
  return {
    title: input.title,
    description: input.description ?? null,
    category: input.category,
    priority: input.priority,
    status: input.status,
    source: input.source ?? null,
    acceptanceCriteria: input.acceptanceCriteria ?? null,
    notes: input.notes ?? null,
  };
}

const linkSelect = {
  id: true,
  taskId: true,
  task: { select: { id: true, wbsCode: true, name: true, progressPct: true, isMilestone: true } },
} as const;

export async function listRequirements(projectId: string) {
  const requirements = await prisma.requirement.findMany({
    where: { projectId },
    orderBy: { code: 'asc' },
    include: { taskLinks: { select: linkSelect, orderBy: { task: { wbsCode: 'asc' } } } },
  });

  // Coverage / traceability roll-up. A requirement is "covered" once at least one
  // WBS task is linked to deliver it; uncovered requirements are scope gaps.
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let covered = 0;
  for (const r of requirements) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byPriority[r.priority] = (byPriority[r.priority] ?? 0) + 1;
    if (r.taskLinks.length > 0) covered += 1;
  }
  const coverage = {
    total: requirements.length,
    covered,
    uncovered: requirements.length - covered,
    verified: byStatus.VERIFIED ?? 0,
    byStatus,
    byPriority,
  };

  return { requirements, coverage };
}

export async function createRequirement(projectId: string, input: UpsertRequirementInput, actorId: string) {
  const requirement = await prisma.$transaction(async (tx) => {
    const count = await tx.requirement.count({ where: { projectId } });
    return tx.requirement.create({
      data: { ...buildData(input), projectId, code: generateRequirementCode(count + 1), createdById: actorId },
    });
  });
  await writeAudit({ projectId, userId: actorId, entity: 'Requirement', entityId: requirement.id, action: 'CREATE', after: requirement });
  return requirement;
}

export async function updateRequirement(projectId: string, id: string, input: UpsertRequirementInput, actorId: string) {
  const existing = await prisma.requirement.findFirst({ where: { id, projectId } });
  if (!existing) throw NotFound('Requirement not found');
  const requirement = await prisma.requirement.update({ where: { id }, data: buildData(input) });
  await writeAudit({ projectId, userId: actorId, entity: 'Requirement', entityId: id, action: 'UPDATE', before: existing, after: requirement });
  return requirement;
}

export async function deleteRequirement(projectId: string, id: string, actorId: string) {
  const existing = await prisma.requirement.findFirst({ where: { id, projectId } });
  if (!existing) throw NotFound('Requirement not found');
  await prisma.requirement.delete({ where: { id } }); // cascades RequirementTaskLink rows
  await writeAudit({ projectId, userId: actorId, entity: 'Requirement', entityId: id, action: 'DELETE', before: existing });
}

// ---- Traceability links: requirement <-> WBS task -------------------------

export async function linkTask(projectId: string, requirementId: string, taskId: string, actorId: string) {
  const requirement = await prisma.requirement.findFirst({ where: { id: requirementId, projectId } });
  if (!requirement) throw NotFound('Requirement not found');
  // The task must belong to the SAME project (no cross-project traceability).
  const task = await prisma.task.findFirst({ where: { id: taskId, projectId } });
  if (!task) throw NotFound('Task not found in this project');

  const exists = await prisma.requirementTaskLink.findUnique({
    where: { requirementId_taskId: { requirementId, taskId } },
  });
  if (exists) throw Conflict('That task is already linked to this requirement');

  const link = await prisma.requirementTaskLink.create({ data: { requirementId, taskId } });
  await writeAudit({
    projectId, userId: actorId, entity: 'Requirement', entityId: requirementId,
    action: 'UPDATE', after: { linkedTaskId: taskId, taskWbsCode: task.wbsCode },
  });
  return prisma.requirementTaskLink.findUnique({ where: { id: link.id }, select: linkSelect });
}

export async function unlinkTask(projectId: string, requirementId: string, taskId: string, actorId: string) {
  const requirement = await prisma.requirement.findFirst({ where: { id: requirementId, projectId } });
  if (!requirement) throw NotFound('Requirement not found');
  const link = await prisma.requirementTaskLink.findUnique({
    where: { requirementId_taskId: { requirementId, taskId } },
  });
  if (!link) throw NotFound('Link not found');
  await prisma.requirementTaskLink.delete({ where: { id: link.id } });
  await writeAudit({
    projectId, userId: actorId, entity: 'Requirement', entityId: requirementId,
    action: 'UPDATE', before: { linkedTaskId: taskId },
  });
}
