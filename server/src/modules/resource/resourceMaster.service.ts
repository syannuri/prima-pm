import type { PersonnelRole, ResourceType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound } from '../../lib/errors.js';
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

export async function listResources(includeInactive = false) {
  const resources = await prisma.resource.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      rateCard: { select: { id: true, roleName: true, level: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  return { resources };
}

export async function createResource(input: ResourceInput, actorId: string) {
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
      userId: input.userId ?? null,
      isActive: input.isActive ?? true,
    },
  });
  await writeAudit({ userId: actorId, entity: 'Resource', entityId: resource.id, action: 'CREATE', after: resource });
  return resource;
}

export async function updateResource(id: string, input: ResourceInput, actorId: string) {
  const existing = await prisma.resource.findUnique({ where: { id } });
  if (!existing) throw NotFound('Resource not found');
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
      userId: input.userId ?? null,
      isActive: input.isActive ?? existing.isActive,
    },
  });
  await writeAudit({ userId: actorId, entity: 'Resource', entityId: id, action: 'UPDATE', before: existing, after: resource });
  return resource;
}

export async function setResourceActive(id: string, isActive: boolean, actorId: string) {
  const existing = await prisma.resource.findUnique({ where: { id } });
  if (!existing) throw NotFound('Resource not found');
  const resource = await prisma.resource.update({ where: { id }, data: { isActive } });
  await writeAudit({ userId: actorId, entity: 'Resource', entityId: id, action: 'UPDATE', before: existing, after: resource });
  return resource;
}
