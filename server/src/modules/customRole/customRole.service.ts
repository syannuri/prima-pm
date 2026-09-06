import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';

// Org-defined role catalog (Tier-3). A custom role maps a workspace-specific name onto one built-in base
// role whose permissions it inherits. Enforcement never reads CustomRole — Membership.role (kept = the
// base role) drives every guard — so this adds a governed catalog with zero permission-logic change.
// Runs under the active tenant context (tenant extension scopes reads and stamps tenantId).

// The assignable built-in roles a custom role may map to (GUEST is a sandbox identity, never assigned).
export const BASE_ROLES: Role[] = ['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER'];

export interface CustomRoleDto {
  id: string;
  name: string;
  description: string | null;
  baseRole: Role;
}

const toDto = (r: { id: string; name: string; description: string | null; baseRole: Role }): CustomRoleDto =>
  ({ id: r.id, name: r.name, description: r.description, baseRole: r.baseRole });

export async function listRoles(): Promise<CustomRoleDto[]> {
  const rows = await prisma.customRole.findMany({ orderBy: [{ name: 'asc' }] });
  return rows.map(toDto);
}

export async function createRole(input: { name: string; baseRole: Role; description?: string }): Promise<CustomRoleDto> {
  const row = await prisma.customRole.create({ data: { name: input.name, baseRole: input.baseRole, description: input.description } });
  return toDto(row);
}

export async function updateRole(id: string, input: { name?: string; baseRole?: Role; description?: string | null }): Promise<CustomRoleDto> {
  const existing = await prisma.customRole.findUnique({ where: { id } });
  if (!existing) throw NotFound('Custom role not found');
  const row = await prisma.customRole.update({
    where: { id },
    data: {
      name: input.name,
      baseRole: input.baseRole,
      description: input.description === undefined ? undefined : input.description,
    },
  });
  // Keep members on this custom role in sync if its base role changed (enforcement reads Membership.role).
  if (input.baseRole && input.baseRole !== existing.baseRole) {
    await prisma.membership.updateMany({ where: { customRoleId: id }, data: { role: input.baseRole } });
  }
  return toDto(row);
}

export async function deleteRole(id: string): Promise<void> {
  const existing = await prisma.customRole.findUnique({ where: { id } });
  if (!existing) throw NotFound('Custom role not found');
  // Detach members (their built-in role is unchanged — they simply lose the custom label).
  await prisma.membership.updateMany({ where: { customRoleId: id }, data: { customRoleId: null } });
  await prisma.customRole.delete({ where: { id } });
}

// Resolve a role assignment from an optional custom role id + optional built-in role. When a custom role
// is given it wins: its base role becomes Membership.role and its id the label. Returns null when neither
// is usable (caller keeps the current value / validates upstream).
export async function resolveAssignment(
  input: { role?: Role; customRoleId?: string | null },
): Promise<{ role: Role; customRoleId: string | null } | null> {
  if (input.customRoleId) {
    const cr = await prisma.customRole.findUnique({ where: { id: input.customRoleId }, select: { id: true, baseRole: true } });
    if (!cr) throw NotFound('Custom role not found');
    return { role: cr.baseRole, customRoleId: cr.id };
  }
  if (input.role) return { role: input.role, customRoleId: null };
  return null;
}
