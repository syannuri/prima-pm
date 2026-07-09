import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
import type { UpsertStakeholderInput } from './stakeholder.schemas.js';

// STK-001, STK-002, …
export function generateStakeholderCode(seq: number): string {
  return `STK-${String(seq).padStart(3, '0')}`;
}

function buildData(input: UpsertStakeholderInput) {
  return {
    name: input.name,
    role: input.role ?? null,
    organization: input.organization ?? null,
    category: input.category,
    power: input.power,
    interest: input.interest,
    currentEngagement: input.currentEngagement,
    desiredEngagement: input.desiredEngagement,
    email: input.email ? input.email : null,
    strategy: input.strategy ?? null,
    notes: input.notes ?? null,
  };
}

export async function listStakeholders(projectId: string) {
  return prisma.stakeholder.findMany({ where: { projectId }, orderBy: { code: 'asc' } });
}

export async function createStakeholder(projectId: string, input: UpsertStakeholderInput, actorId: string) {
  const stakeholder = await prisma.$transaction(async (tx) => {
    const count = await tx.stakeholder.count({ where: { projectId } });
    return tx.stakeholder.create({
      data: { ...buildData(input), projectId, code: generateStakeholderCode(count + 1), createdById: actorId },
    });
  });
  await writeAudit({ projectId, userId: actorId, entity: 'Stakeholder', entityId: stakeholder.id, action: 'CREATE', after: stakeholder });
  return stakeholder;
}

export async function updateStakeholder(projectId: string, id: string, input: UpsertStakeholderInput, actorId: string) {
  const existing = await prisma.stakeholder.findFirst({ where: { id, projectId } });
  if (!existing) throw NotFound('Stakeholder not found');
  const stakeholder = await prisma.stakeholder.update({ where: { id }, data: buildData(input) });
  await writeAudit({ projectId, userId: actorId, entity: 'Stakeholder', entityId: id, action: 'UPDATE', before: existing, after: stakeholder });
  return stakeholder;
}

export async function deleteStakeholder(projectId: string, id: string, actorId: string) {
  const existing = await prisma.stakeholder.findFirst({ where: { id, projectId } });
  if (!existing) throw NotFound('Stakeholder not found');
  await prisma.stakeholder.delete({ where: { id } });
  await writeAudit({ projectId, userId: actorId, entity: 'Stakeholder', entityId: id, action: 'DELETE', before: existing });
}
