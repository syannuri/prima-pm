import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
import type { UpsertAssumptionInput, UpsertDependencyInput } from './raid.schemas.js';

const OWNER = { owner: { select: { id: true, name: true } } } as const;
const pad = (n: number) => String(n).padStart(3, '0');

// ---------- Assumptions (ASM-###) ----------
export async function listAssumptions(projectId: string) {
  return prisma.assumption.findMany({ where: { projectId }, include: OWNER, orderBy: { code: 'asc' } });
}

export async function createAssumption(projectId: string, input: UpsertAssumptionInput, actorId: string) {
  const row = await prisma.$transaction(async (tx) => {
    const count = await tx.assumption.count({ where: { projectId } });
    return tx.assumption.create({
      data: {
        projectId, code: `ASM-${pad(count + 1)}`, createdById: actorId,
        statement: input.statement, category: input.category ?? null, status: input.status,
        impact: input.impact, ownerUserId: input.ownerUserId ?? null, notes: input.notes ?? null,
      },
      include: OWNER,
    });
  });
  await writeAudit({ projectId, userId: actorId, entity: 'Assumption', entityId: row.id, action: 'CREATE', after: row });
  return row;
}

export async function updateAssumption(projectId: string, id: string, input: UpsertAssumptionInput, actorId: string) {
  const existing = await prisma.assumption.findFirst({ where: { id, projectId } });
  if (!existing) throw NotFound('Assumption not found');
  const row = await prisma.assumption.update({
    where: { id },
    data: {
      statement: input.statement, category: input.category ?? null, status: input.status,
      impact: input.impact, ownerUserId: input.ownerUserId ?? null, notes: input.notes ?? null,
    },
    include: OWNER,
  });
  await writeAudit({ projectId, userId: actorId, entity: 'Assumption', entityId: id, action: 'UPDATE', before: existing, after: row });
  return row;
}

export async function deleteAssumption(projectId: string, id: string, actorId: string) {
  const existing = await prisma.assumption.findFirst({ where: { id, projectId } });
  if (!existing) throw NotFound('Assumption not found');
  await prisma.assumption.delete({ where: { id } });
  await writeAudit({ projectId, userId: actorId, entity: 'Assumption', entityId: id, action: 'DELETE', before: existing });
}

// ---------- Dependencies (DEP-###) ----------
export async function listDependencies(projectId: string) {
  return prisma.projectDependency.findMany({ where: { projectId }, include: OWNER, orderBy: { code: 'asc' } });
}

export async function createDependency(projectId: string, input: UpsertDependencyInput, actorId: string) {
  const row = await prisma.$transaction(async (tx) => {
    const count = await tx.projectDependency.count({ where: { projectId } });
    return tx.projectDependency.create({
      data: {
        projectId, code: `DEP-${pad(count + 1)}`, createdById: actorId,
        description: input.description, direction: input.direction, counterparty: input.counterparty ?? null,
        dueDate: input.dueDate ?? null, status: input.status, impact: input.impact,
        ownerUserId: input.ownerUserId ?? null, notes: input.notes ?? null,
      },
      include: OWNER,
    });
  });
  await writeAudit({ projectId, userId: actorId, entity: 'ProjectDependency', entityId: row.id, action: 'CREATE', after: row });
  return row;
}

export async function updateDependency(projectId: string, id: string, input: UpsertDependencyInput, actorId: string) {
  const existing = await prisma.projectDependency.findFirst({ where: { id, projectId } });
  if (!existing) throw NotFound('Dependency not found');
  const row = await prisma.projectDependency.update({
    where: { id },
    data: {
      description: input.description, direction: input.direction, counterparty: input.counterparty ?? null,
      dueDate: input.dueDate ?? null, status: input.status, impact: input.impact,
      ownerUserId: input.ownerUserId ?? null, notes: input.notes ?? null,
    },
    include: OWNER,
  });
  await writeAudit({ projectId, userId: actorId, entity: 'ProjectDependency', entityId: id, action: 'UPDATE', before: existing, after: row });
  return row;
}

export async function deleteDependency(projectId: string, id: string, actorId: string) {
  const existing = await prisma.projectDependency.findFirst({ where: { id, projectId } });
  if (!existing) throw NotFound('Dependency not found');
  await prisma.projectDependency.delete({ where: { id } });
  await writeAudit({ projectId, userId: actorId, entity: 'ProjectDependency', entityId: id, action: 'DELETE', before: existing });
}
