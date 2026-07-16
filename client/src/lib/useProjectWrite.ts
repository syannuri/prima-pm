import { useQueryClient } from '@tanstack/react-query';
import type { Project, Role } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { canGovernProject } from './perms';

// May the current user WRITE to this project's modules? Personal (guest) projects → the owner
// self-governs (no approval matrix); corporate projects → ADMIN/PMO/PROJECT_MANAGER plus any
// module-specific `extraRoles` (FINANCE for cost/timesheet, RISK_OFFICER for risk). Mirrors the
// server's requireProjectGovernance on the module write routes. Reads the project already loaded
// into the ['project', projectId] cache by ProjectPage (panels only mount after it resolves).
export function useProjectWrite(projectId: string, extraRoles: Role[] = []): boolean {
  const { user } = useAuth();
  const qc = useQueryClient();
  const project = qc.getQueryData<{ project: Project }>(['project', projectId])?.project;
  if (!project) return false;
  return canGovernProject(user, project, ['ADMIN', 'PMO', 'PROJECT_MANAGER', ...extraRoles]);
}
