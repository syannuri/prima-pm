import type { Role } from '@prisma/client';
import { prisma } from '../prisma.js';
import { getTenantStore } from './context.js';

// User ids of ACTIVE members holding one of `roles` IN THE ACTIVE TENANT. `Membership` is a global
// model (not tenant-scoped by the extension), so it's queried directly and filtered by the ambient
// tenant when there is one. This replaces the pre-4c pattern `user.findMany({ where: { role } })`,
// which read the GLOBAL `User.role` and so notified/counted admins ACROSS tenants — a cross-tenant
// leak. With no tenant context (enforcement off / single-tenant) there is only the one default
// tenant, so an unfiltered match is still correct.
export async function tenantMemberUserIds(roles: Role[], opts: { excludeUserId?: string } = {}): Promise<string[]> {
  const tenantId = getTenantStore()?.tenantId;
  // No tenant context = enforcement off / single-tenant: fall back to the global User.role (a
  // dual-read kept until User.role is dropped in 4c-drop, where off-mode users must have a membership).
  if (!tenantId) {
    const rows = await prisma.user.findMany({
      where: { role: { in: roles }, isActive: true, ...(opts.excludeUserId ? { id: { not: opts.excludeUserId } } : {}) },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  const rows = await prisma.membership.findMany({
    where: {
      tenantId,
      role: { in: roles },
      user: { isActive: true, ...(opts.excludeUserId ? { id: { not: opts.excludeUserId } } : {}) },
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

// Count of ACTIVE members holding `role` in the active tenant (e.g. the "never delete the last
// admin" guard — now scoped to the tenant, not the whole deployment). Same off-mode fallback.
export async function tenantMemberCount(role: Role): Promise<number> {
  const tenantId = getTenantStore()?.tenantId;
  if (!tenantId) return prisma.user.count({ where: { role, isActive: true } });
  return prisma.membership.count({ where: { tenantId, role, user: { isActive: true } } });
}
