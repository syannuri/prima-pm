import type { User, Project, Role } from '../api/types';

// Who may perform GOVERNANCE actions on a project. Mirrors the server's requireProjectGovernance:
// the OWNER of a personal (guest) project self-governs it with no approval matrix; a corporate
// project needs one of `corporateRoles` (ADMIN/PMO by default; baseline-lock also allows the
// owning PROJECT_MANAGER — the server enforces ownership for that case).
export function canGovernProject(
  user: User | null | undefined,
  project: Pick<Project, 'personalOwnerId'>,
  corporateRoles: Role[] = ['ADMIN', 'PMO'],
): boolean {
  if (!user) return false;
  // A GUEST lives entirely in their own PERSONAL tenant and self-governs every project there. The
  // multitenancy refactor moved "is this a personal sandbox?" off the per-project `personalOwnerId`
  // flag (now unset) onto the tenant, and tenant scoping guarantees a guest only ever loads their
  // own projects — so any project a guest can see, they own. (Server mirrors this via tenantIsPersonal.)
  if (user.role === 'GUEST') return true;
  if (project.personalOwnerId) return project.personalOwnerId === user.id; // legacy per-project owner
  return corporateRoles.includes(user.role);
}

// May the user create projects? ADMIN/PMO create corporate projects; a GUEST creates a
// personal one (the server forces personal/self-owned).
export function canCreateProject(user: User | null | undefined): boolean {
  return !!user && (user.role === 'ADMIN' || user.role === 'PMO' || user.role === 'GUEST');
}
