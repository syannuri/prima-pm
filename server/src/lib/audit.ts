import { prisma } from './prisma.js';
import { getTenantStore, runAsSystem } from './tenant/context.js';

type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'COMMIT'
  | 'APPROVE'
  | 'REJECT'
  | 'LOGIN'
  | 'LOGOUT'
  | 'PASSWORD_CHANGE'
  | 'FORCE_CLOSE'
  | 'REOPEN'
  | 'ACTIVATE'
  | 'FORCE_ACTIVATE'
  | 'REJECT_ACTIVATION'
  | 'REQUEST_ACTIVATION_REVISION'
  | 'RESUBMIT_ACTIVATION'
  | 'ARCHIVE'
  | 'UNARCHIVE'
  | 'IMPERSONATE'
  | 'EXPORT';

interface AuditInput {
  userId?: string | null;
  projectId?: string | null;
  entity: string;
  entityId: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
}

// Append-only audit trail. Never throws into the request flow.
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    const create = () =>
      prisma.auditLog.create({
        data: {
          userId: input.userId ?? null,
          projectId: input.projectId ?? null,
          entity: input.entity,
          entityId: input.entityId,
          action: input.action,
          before: (input.before ?? undefined) as object | undefined,
          after: (input.after ?? undefined) as object | undefined,
        },
      });
    // Within a request the ambient tenant context stamps AuditLog.tenantId automatically. Auth
    // flows (login/logout) and system jobs write audits with NO context — run those as system so
    // the fail-closed extension doesn't reject the write (tenantId stays null, which is fine while
    // the column is nullable). When a context IS present we must NOT bypass it, or the row would be
    // unscoped and invisible to the (scoped) admin audit view.
    await (getTenantStore() ? create() : runAsSystem(create));
  } catch (err) {
    // Audit failures must not break business operations; log only.
    console.error('[audit] failed to write audit log', err);
  }
}
