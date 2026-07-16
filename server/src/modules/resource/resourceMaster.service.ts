import type { PersonnelRole, ResourceType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound, BadRequest } from '../../lib/errors.js';
import { effectiveDayRate } from './resource.helpers.js';

export interface ResourceInput {
  name: string;
  resourceType?: ResourceType;
  roleTitle?: string | null;
  personnelRole?: PersonnelRole;
  rateCardId?: string | null;
  unitCostPerManday?: number;
  capacityPerDay?: number;
  department?: string | null;
  userId?: string | null;
  isActive?: boolean;
}

// Effective day-rate: an explicit override wins, else the linked rate card's rate.
async function resolveRate(rateCardId: string | null | undefined, override: number | undefined): Promise<number> {
  let rateCardRate: number | null = null;
  if (rateCardId) {
    const rc = await prisma.rateCard.findUnique({ where: { id: rateCardId }, select: { unitCostPerManday: true } });
    rateCardRate = rc ? Number(rc.unitCostPerManday) : null;
  }
  return effectiveDayRate(override, rateCardRate);
}

// A resource may only link a rate card from the SAME owner scope (a guest can't borrow a
// corporate card, and corporate can't link a guest's). `ownerId` is null for corporate.
async function assertRateCardOwner(rateCardId: string | null | undefined, ownerId: string | null): Promise<void> {
  if (!rateCardId) return;
  const rc = await prisma.rateCard.findUnique({ where: { id: rateCardId }, select: { personalOwnerId: true } });
  if (!rc) throw NotFound('Rate card not found');
  if ((rc.personalOwnerId ?? null) !== ownerId) throw BadRequest('That rate card is not in this workspace');
}

// ownerId null = corporate pool; a guest's user id = their private pool.
export async function listResources(includeInactive = false, ownerId: string | null = null) {
  const resources = await prisma.resource.findMany({
    where: { personalOwnerId: ownerId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      rateCard: { select: { id: true, roleName: true, level: true, unitCostPerManday: true, isActive: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  return { resources };
}

export async function createResource(input: ResourceInput, actorId: string, ownerId: string | null = null) {
  await assertRateCardOwner(input.rateCardId, ownerId);
  // A guest's resources never link to a login account (corporate directory is off-limits).
  const userId = ownerId ? null : (input.userId ?? null);
  const unitCostPerManday = await resolveRate(input.rateCardId, input.unitCostPerManday);
  const resource = await prisma.resource.create({
    data: {
      name: input.name,
      resourceType: input.resourceType ?? 'NAMED',
      roleTitle: input.roleTitle ?? null,
      personnelRole: input.personnelRole ?? 'PROJECT_PERSONNEL',
      rateCardId: input.rateCardId ?? null,
      unitCostPerManday,
      capacityPerDay: input.capacityPerDay ?? 1,
      department: input.department ?? null,
      userId,
      personalOwnerId: ownerId,
      isActive: input.isActive ?? true,
    },
  });
  await writeAudit({ userId: actorId, entity: 'Resource', entityId: resource.id, action: 'CREATE', after: resource });
  return resource;
}

export async function updateResource(id: string, input: ResourceInput, actorId: string, ownerId: string | null = null) {
  const existing = await prisma.resource.findFirst({ where: { id, personalOwnerId: ownerId } });
  if (!existing) throw NotFound('Resource not found');
  await assertRateCardOwner(input.rateCardId, ownerId);
  const userId = ownerId ? null : (input.userId ?? null);
  const unitCostPerManday = await resolveRate(input.rateCardId, input.unitCostPerManday);
  const resource = await prisma.resource.update({
    where: { id },
    data: {
      name: input.name,
      resourceType: input.resourceType ?? existing.resourceType,
      roleTitle: input.roleTitle ?? null,
      personnelRole: input.personnelRole ?? existing.personnelRole,
      rateCardId: input.rateCardId ?? null,
      unitCostPerManday,
      capacityPerDay: input.capacityPerDay ?? Number(existing.capacityPerDay),
      department: input.department ?? null,
      userId,
      isActive: input.isActive ?? existing.isActive,
    },
  });
  await writeAudit({ userId: actorId, entity: 'Resource', entityId: id, action: 'UPDATE', before: existing, after: resource });
  return resource;
}

// Re-pull the day-rate from the linked rate card (adopt its current rate).
export async function refreshResourceRate(id: string, actorId: string, ownerId: string | null = null) {
  const existing = await prisma.resource.findFirst({
    where: { id, personalOwnerId: ownerId },
    include: { rateCard: { select: { unitCostPerManday: true } } },
  });
  if (!existing) throw NotFound('Resource not found');
  if (!existing.rateCardId || !existing.rateCard) throw BadRequest('Resource has no linked rate card');
  const resource = await prisma.resource.update({
    where: { id },
    data: { unitCostPerManday: existing.rateCard.unitCostPerManday },
  });
  await writeAudit({ userId: actorId, entity: 'Resource', entityId: id, action: 'UPDATE', before: existing, after: resource });
  return resource;
}

export async function setResourceActive(id: string, isActive: boolean, actorId: string, ownerId: string | null = null) {
  const existing = await prisma.resource.findFirst({ where: { id, personalOwnerId: ownerId } });
  if (!existing) throw NotFound('Resource not found');
  const resource = await prisma.resource.update({ where: { id }, data: { isActive } });
  await writeAudit({ userId: actorId, entity: 'Resource', entityId: id, action: 'UPDATE', before: existing, after: resource });
  return resource;
}
