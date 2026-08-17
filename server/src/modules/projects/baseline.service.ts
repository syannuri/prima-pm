import { prisma, type TxClient } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { emitDomainEvent } from '../events/dispatch.js';
import { activeTenantIsPersonal } from '../../lib/tenant/context.js';

// TxClient (derived from the extended client) accepts both the full client and an interactive tx.
type Db = TxClient;

// Throws if the project's baseline is locked. Called by every baseline-DEFINING mutation
// (cost lines, management reserve, WBS tasks, schedule baseline) so the PMB/BAC cannot
// shift without a deliberate, audited unlock. Progress/actuals and risks are NOT gated by
// this — they legitimately evolve during execution.
export async function assertBaselineUnlocked(projectId: string, db: Db = prisma): Promise<void> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { baselineLockedAt: true } });
  if (p?.baselineLockedAt) {
    throw BadRequest('The project baseline is locked. Unlock it (ADMIN/PMO) before changing cost lines, the WBS or the schedule baseline.');
  }
}

// Lock or unlock the baseline. Unlocking requires a reason (it re-opens the PMB/BAC to
// change — the deliberate control the change-request process should drive). Audited.
//
// If a COST_BASELINE approval workflow matches, a real LOCK is not applied immediately: it is
// submitted for approval and applied on final sign-off (`applyBaselineLock`). A real UNLOCK is
// likewise gated through a BASELINE_UNLOCK workflow (the riskier change-control action) — except in
// a guest's personal tenant, which self-governs and always applies immediately. A re-lock no-op is
// never gated. Returns `{ project, approvalPending }`.
export async function setBaselineLock(projectId: string, locked: boolean, reason: string | undefined, actorId: string) {
  const before = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, baselineLockedAt: true, scheduleBaselinedAt: true },
  });
  if (!before) throw NotFound('Project not found');
  const wasLocked = before.baselineLockedAt != null;
  if (!locked && wasLocked && !reason?.trim()) {
    throw BadRequest('Unlocking the baseline requires a reason.');
  }
  const isLockTransition = locked && !wasLocked;
  // Ordering guard: locking freezes the schedule baseline too (assertBaselineUnlocked blocks
  // setScheduleBaseline). If a WBS project hasn't captured its schedule baseline yet, locking
  // now would trap it — the baseline could never be set without unlocking. Require it first.
  if (isLockTransition && !before.scheduleBaselinedAt) {
    const hasWbs = (await prisma.task.count({ where: { projectId } })) > 0;
    if (hasWbs) {
      throw BadRequest('Capture the schedule baseline (Schedule tab) before locking — it can’t be set once the baseline is locked.');
    }
  }

  // Gate a real lock through an approval workflow when one matches. Dynamic import breaks the
  // approval.service ⇄ baseline.service cycle (the finalizer calls applyBaselineLock below).
  if (isLockTransition) {
    const { startApproval } = await import('../approval/approval.service.js');
    const routed = await startApproval(
      { entityType: 'COST_BASELINE', entityId: projectId, projectId, payload: { reason: reason?.trim() || null, requestedById: actorId } },
      actorId,
    );
    if (routed) {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
      return { project, approvalPending: true as const };
    }
  }

  // Gate a real unlock the same way — re-opening a locked baseline is the riskier change-control
  // action, so under integrated change control it should require sign-off too. GUEST-SAFE: guests
  // self-govern in a personal tenant (no approval matrix), so skip routing entirely there and apply
  // immediately. The startApproval null-on-no-workflow / null-on-no-approvers backstop means a
  // corporate tenant without a resolvable BASELINE_UNLOCK workflow also unlocks immediately. When
  // routed, the baseline STAYS LOCKED (no cost/WBS/schedule edits) until the unlock is approved.
  const isUnlockTransition = !locked && wasLocked;
  if (isUnlockTransition && !activeTenantIsPersonal()) {
    const { startApproval } = await import('../approval/approval.service.js');
    const routed = await startApproval(
      { entityType: 'BASELINE_UNLOCK', entityId: projectId, projectId, payload: { reason: reason?.trim() || null, requestedById: actorId } },
      actorId,
    );
    if (routed) {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
      return { project, approvalPending: true as const };
    }
  }

  const project = await applyBaselineLock(projectId, reason, actorId, locked);
  return { project, approvalPending: false as const };
}

// Apply the lock/unlock to the DB (no approval gate). Called directly by setBaselineLock when no
// workflow matches, and by the approval finalizer when a gated lock is approved (locked defaults
// to true there). Audited; emits baseline.locked only on a real lock transition.
export async function applyBaselineLock(projectId: string, reason: string | undefined, actorId: string, locked = true) {
  const before = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { baselineLockedAt: true } });
  if (!before) throw NotFound('Project not found');
  const wasLocked = before.baselineLockedAt != null;

  const project = await prisma.project.update({
    where: { id: projectId },
    data: locked
      ? { baselineLockedAt: new Date(), baselineLockedById: actorId }
      : { baselineLockedAt: null, baselineLockedById: null },
  });
  await writeAudit({
    projectId,
    userId: actorId,
    entity: 'Project',
    entityId: projectId,
    action: 'UPDATE',
    before: { baselineLocked: wasLocked },
    after: { baselineLocked: locked, reason: reason?.trim() || null },
  });
  // Emit only on a real lock transition (not on unlock or a re-lock no-op). Best-effort.
  if (locked && !wasLocked) {
    await emitDomainEvent('baseline.locked', { projectId, lockedAt: project.baselineLockedAt, lockedById: actorId });
  }
  return project;
}
