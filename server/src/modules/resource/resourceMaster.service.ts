import type { PersonnelRole, ResourceType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound, BadRequest, Conflict } from '../../lib/errors.js';
import { activeTenantIsPersonal } from '../../lib/tenant/context.js';
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

// The linked rate card must exist. Cross-workspace isolation is now the tenant extension's job — a
// rate card from another tenant simply doesn't load — so no explicit workspace check is needed.
async function assertRateCard(rateCardId: string | null | undefined): Promise<void> {
  if (!rateCardId) return;
  const rc = await prisma.rateCard.findUnique({ where: { id: rateCardId }, select: { id: true } });
  if (!rc) throw NotFound('Rate card not found');
}

// Resources are tenant-scoped, so the caller only ever sees their own tenant's pool (a guest's
// private pool = their personal tenant; corporate = the corporate tenant).
export async function listResources(includeInactive = false) {
  const resources = await prisma.resource.findMany({
    where: { ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      rateCard: { select: { id: true, roleName: true, level: true, unitCostPerManday: true, isActive: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  return { resources };
}

export async function createResource(input: ResourceInput, actorId: string) {
  await assertRateCard(input.rateCardId);
  // In a guest's personal tenant a resource never links a login account (corporate directory is off-limits).
  const userId = activeTenantIsPersonal() ? null : (input.userId ?? null);
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
      isActive: input.isActive ?? true,
    },
  });
  await writeAudit({ userId: actorId, entity: 'Resource', entityId: resource.id, action: 'CREATE', after: resource });
  return resource;
}

export async function updateResource(id: string, input: ResourceInput, actorId: string) {
  const existing = await prisma.resource.findFirst({ where: { id } });
  if (!existing) throw NotFound('Resource not found');
  await assertRateCard(input.rateCardId);
  const userId = activeTenantIsPersonal() ? null : (input.userId ?? null);
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
export async function refreshResourceRate(id: string, actorId: string) {
  const existing = await prisma.resource.findFirst({
    where: { id },
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

export async function setResourceActive(id: string, isActive: boolean, actorId: string) {
  const existing = await prisma.resource.findFirst({ where: { id } });
  if (!existing) throw NotFound('Resource not found');
  const resource = await prisma.resource.update({ where: { id }, data: { isActive } });
  await writeAudit({ userId: actorId, entity: 'Resource', entityId: id, action: 'UPDATE', before: existing, after: resource });
  return resource;
}

// Hard-delete a resource. Blocked when it is still referenced by a cost line or a task owner —
// those are baked into a project's plan/baseline, so deactivate instead of orphaning them.
export async function deleteResource(id: string, actorId: string) {
  const existing = await prisma.resource.findFirst({ where: { id } });
  if (!existing) throw NotFound('Resource not found');
  const [lineCount, taskCount] = await Promise.all([
    prisma.costItemDirect.count({ where: { resourceId: id } }),
    prisma.task.count({ where: { owners: { some: { resourceId: id } } } }),
  ]);
  if (lineCount + taskCount > 0) {
    throw Conflict('This resource is used by cost lines or task owners — deactivate it instead of deleting.');
  }
  await prisma.resource.delete({ where: { id } });
  await writeAudit({ userId: actorId, entity: 'Resource', entityId: id, action: 'DELETE', before: existing });
}
