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
  if (project.personalOwnerId) return project.personalOwnerId === user.id;
  return corporateRoles.includes(user.role);
}

// May the user create projects? ADMIN/PMO create corporate projects; a GUEST creates a
// personal one (the server forces personal/self-owned).
export function canCreateProject(user: User | null | undefined): boolean {
  return !!user && (user.role === 'ADMIN' || user.role === 'PMO' || user.role === 'GUEST');
}
