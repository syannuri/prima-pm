import { prisma } from './prisma.js';

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
  | 'REOPEN';

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
    await prisma.auditLog.create({
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
  } catch (err) {
    // Audit failures must not break business operations; log only.
    console.error('[audit] failed to write audit log', err);
  }
}
