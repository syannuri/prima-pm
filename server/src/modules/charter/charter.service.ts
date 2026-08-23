import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, Conflict, NotFound } from '../../lib/errors.js';
import {
  canEditCharter,
  checkCharterCompleteness,
  buildCharterSnapshot,
} from './charter.helpers.js';
import { createNotification } from '../notification/notification.service.js';
import { emitDomainEvent } from '../events/dispatch.js';
import { tenantMemberUserIds } from '../../lib/tenant/members.js';
import { emailEnabled, sendMail, appBaseUrl } from '../../lib/mailer.js';
import { crDecidedMail } from '../../lib/mail/templates.js';

// The project tab a CR is "about", so its approved/rejected notice deep-links where the PM must act.
// Schedule wins (re-plan happens there); then Cost, Charter, Risk; else the Change Req tab.
function crTargetTab(areas: string[]): string {
  if (areas.includes('SCHEDULE')) return 'Schedule';
  if (areas.includes('COST')) return 'Cost';
  if (areas.includes('CHARTER')) return 'Charter';
  if (areas.includes('RISK')) return 'Risk';
  return 'Change Req';
}
import type { UpsertCharterInput, ChangeRequestInput } from './charter.schemas.js';

export async function getCharter(projectId: string) {
  const charter = await prisma.projectCharter.findUnique({ where: { projectId } });
  return charter; // may be null (not created yet)
}

// Create or update the charter. Blocked once the charter is committed/locked.
export async function upsertCharter(
  projectId: string,
  input: UpsertCharterInput,
  actorId: string,
) {
  const existing = await prisma.projectCharter.findUnique({ where: { projectId } });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, code: true, pmUserId: true } });

  const guard = canEditCharter(existing);
  if (!guard.allowed) throw Conflict(guard.reason!);

  const data = {
    description: input.description,
    goals: input.goals,
    category: input.category as never,
    // Free-text detail only carries meaning for the OTHER category.
    categoryOther: input.category === 'OTHER' ? (input.categoryOther?.trim() || null) : null,
    hiScope: input.hiScope,
    hiCostIdr: input.hiCostIdr,
    hiScheduleStart: input.hiScheduleStart,
    hiScheduleEnd: input.hiScheduleEnd,
    hiDeliverables: input.hiDeliverables,
    pmUserId: input.pmUserId,
  };

  // Write the charter and sync the project's PM together — Project.pmUserId
  // drives RBAC ownership, so it must never diverge from the charter on a
  // partial failure.
  const charter = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.projectCharter.update({ where: { projectId }, data })
      : await tx.projectCharter.create({ data: { ...data, projectId, version: 1, locked: false } });
    await tx.project.update({
      where: { id: projectId },
      data: {
        pmUserId: input.pmUserId,
        ...(input.deliveryApproach ? { deliveryApproach: input.deliveryApproach } : {}),
        ...(input.sponsor !== undefined ? { sponsor: input.sponsor } : {}),
      },
    });
    return saved;
  });

  await writeAudit({ projectId,
    userId: actorId,
    entity: 'ProjectCharter',
    entityId: charter.id,
    action: existing ? 'UPDATE' : 'CREATE',
    after: charter,
  });
  // Notify the PM if the charter (re)assigned them to this project.
  if (input.pmUserId && input.pmUserId !== project?.pmUserId && input.pmUserId !== actorId) {
    await createNotification({
      userId: input.pmUserId,
      type: 'PROJECT_ASSIGNED',
      title: 'Assigned as Project Manager',
      body: `You've been assigned as PM of "${project?.name ?? 'a project'}"${project?.code ? ` (${project.code})` : ''}.`,
      projectId,
    });
  }
  return charter;
}

// Commit = lock the baseline, snapshot the version, advance project status.
export async function commitCharter(projectId: string, actorId: string) {
  const charter = await prisma.projectCharter.findUnique({ where: { projectId } });
  if (!charter) throw NotFound('Charter has not been created yet');
  if (charter.locked) throw Conflict('Charter is already committed');

  // Defensive completeness check (DB record could have been partially populated).
  const completeness = checkCharterCompleteness(charter as unknown as Record<string, unknown>);
  if (!completeness.ok) {
    throw BadRequest('Charter is incomplete; all fields are mandatory before commit', {
      missing: completeness.missing,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const snapshot = buildCharterSnapshot(charter as unknown as Record<string, unknown>);

    await tx.charterVersion.create({
      data: {
        projectId,
        version: charter.version,
        snapshot: snapshot as object,
        committedBy: actorId,
      },
    });

    const committed = await tx.projectCharter.update({
      where: { projectId },
      data: { locked: true, committedAt: new Date(), committedBy: actorId },
    });

    // Unlock downstream modules by moving the project past DRAFT.
    await tx.project.update({
      where: { id: projectId },
      data: { status: 'CHARTERED' },
    });

    // Ensure a CostBaseline row exists for downstream roll-ups.
    await tx.costBaseline.upsert({
      where: { projectId },
      create: { projectId },
      update: {},
    });

    return committed;
  });

  await writeAudit({ projectId,
    userId: actorId,
    entity: 'ProjectCharter',
    entityId: result.id,
    action: 'COMMIT',
    after: { version: result.version, committedAt: result.committedAt },
  });
  return result;
}

// Raise a Change Request to edit a committed charter.
export async function createChangeRequest(
  projectId: string,
  input: ChangeRequestInput,
  actorId: string,
) {
  const charter = await prisma.projectCharter.findUnique({ where: { projectId } });
  if (!charter) throw NotFound('Charter has not been created yet');
  if (!charter.locked) throw BadRequest('Charter is not committed; edit it directly instead');

  // Display type derived from the declared areas (behaviour keys on impactAreas now, not
  // this label). Previously hard-coded to 'CHARTER', which made every approved CR wrongly
  // bump the charter version even for a cost/schedule-only change.
  const areas = input.impactAreas;
  const type = areas.includes('CHARTER')
    ? 'CHARTER'
    : areas.includes('COST')
      ? 'COST_BASELINE'
      : areas.includes('SCHEDULE')
        ? 'SCHEDULE'
        : 'SCOPE';

  const cr = await prisma.changeRequest.create({
    data: {
      projectId,
      type,
      title: input.title,
      description: input.description,
      chargeable: input.chargeable,
      amountIdr: input.chargeable ? input.amountIdr ?? null : null,
      magnitude: input.magnitude,
      impactAreas: input.impactAreas,
      status: 'SUBMITTED',
      requestedBy: actorId,
    },
  });
  await writeAudit({ projectId, userId: actorId, entity: 'ChangeRequest', entityId: cr.id, action: 'CREATE', after: cr });

  // If an admin-configured approval workflow matches this CR, route it through the multi-step chain
  // instead of the legacy single-decider notification. Dynamic import keeps the module graph acyclic
  // (approval.service statically imports decideChangeRequest from here). Best-effort: a routing
  // failure must never block raising the CR — fall through to the legacy notification.
  try {
    const { startApprovalForCr } = await import('../approval/approval.service.js');
    const routed = await startApprovalForCr(cr, actorId);
    if (routed) {
      // The workflow owns the notifications now; mark the CR under review so the decider guard passes.
      const updated = await prisma.changeRequest.update({ where: { id: cr.id }, data: { status: 'UNDER_REVIEW' } });
      return updated;
    }
  } catch (err) {
    console.error('[approval] failed to route change request through a workflow', err);
  }

  // Legacy path — notify the approvers (ADMIN/PMO) that a change request awaits their decision.
  const [project, approvers] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { name: true, code: true } }),
    tenantMemberUserIds(['ADMIN', 'PMO'], { excludeUserId: actorId }),
  ]);
  // Notify all approvers concurrently (was serial).
  await Promise.all(
    approvers
      .map((id) =>
        createNotification({
          userId: id,
          type: 'CR_SUBMITTED',
          title: 'Change request awaits your decision',
          body: `"${input.title}" on "${project?.name ?? 'a project'}"${project?.code ? ` (${project.code})` : ''} needs approval.`,
          projectId,
        }),
      ),
  );
  return cr;
}

// PMO/ADMIN decision. Approval unlocks the charter and advances the version.
export async function decideChangeRequest(
  projectId: string,
  crId: string,
  decision: 'APPROVED' | 'REJECTED',
  actorId: string,
  applyToRevenue = false,
) {
  const cr = await prisma.changeRequest.findUnique({ where: { id: crId } });
  if (!cr || cr.projectId !== projectId) throw NotFound('Change Request not found');
  if (cr.status !== 'SUBMITTED' && cr.status !== 'UNDER_REVIEW') {
    throw Conflict('Change Request has already been decided');
  }

  // Only a chargeable CR carrying an agreed amount can be applied to revenue.
  const chargeAmount = cr.amountIdr == null ? 0 : Number(cr.amountIdr);
  const willApplyRevenue = decision === 'APPROVED' && applyToRevenue && cr.chargeable && chargeAmount > 0;

  // An approved change that touches cost or schedule is the sanctioned way to alter the
  // baseline: if the baseline is currently locked, approval opens it so the PM can apply
  // the change (they re-lock afterwards). This ties every baseline edit to an approved CR.
  const touchesBaseline =
    decision === 'APPROVED' && cr.impactAreas.some((a) => a === 'COST' || a === 'SCHEDULE');

  const { result, revenueChange, baselineUnlocked } = await prisma.$transaction(async (tx) => {
    const updatedCr = await tx.changeRequest.update({
      where: { id: crId },
      data: { status: decision, decidedBy: actorId, decidedAt: new Date() },
    });

    if (decision === 'APPROVED' && cr.impactAreas.includes('CHARTER')) {
      // The change affects the charter → unlock it for editing and bump the version so the
      // next commit snapshots a new version. (Keys on the declared CHARTER area now, so a
      // cost/schedule-only change no longer needlessly re-versions the charter.)
      await tx.projectCharter.update({
        where: { projectId },
        data: { locked: false, version: { increment: 1 } },
      });
    }

    let baselineUnlocked = false;
    if (touchesBaseline) {
      const p = await tx.project.findUnique({ where: { id: projectId }, select: { baselineLockedAt: true } });
      if (p?.baselineLockedAt) {
        await tx.project.update({ where: { id: projectId }, data: { baselineLockedAt: null, baselineLockedById: null } });
        baselineUnlocked = true;
      }
    }

    // Approved chargeable change order → raise the project's Total Revenue by the
    // agreed amount (the client-funded contract increase). Read-then-set so a null
    // starting revenue is treated as 0 (SQL NULL + x would stay NULL).
    let revenueChange: { before: number; after: number } | null = null;
    if (willApplyRevenue) {
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { totalRevenueIdr: true } });
      const before = project?.totalRevenueIdr == null ? 0 : Number(project.totalRevenueIdr);
      const after = before + chargeAmount;
      await tx.project.update({ where: { id: projectId }, data: { totalRevenueIdr: after } });
      revenueChange = { before, after };
    }
    return { result: updatedCr, revenueChange, baselineUnlocked };
  });

  await writeAudit({ projectId,
    userId: actorId,
    entity: 'ChangeRequest',
    entityId: crId,
    action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: result,
  });

  if (revenueChange) {
    await writeAudit({
      projectId,
      userId: actorId,
      entity: 'Project',
      entityId: projectId,
      action: 'UPDATE',
      before: { totalRevenueIdr: revenueChange.before },
      after: { totalRevenueIdr: revenueChange.after, reason: `Chargeable change "${cr.title}" (+${chargeAmount})` },
    });
  }

  if (baselineUnlocked) {
    await writeAudit({
      projectId,
      userId: actorId,
      entity: 'Project',
      entityId: projectId,
      action: 'UPDATE',
      before: { baselineLocked: true },
      after: { baselineLocked: false, reason: `Approved change "${cr.title}" (CR ${crId}) — baseline opened to apply the change` },
    });
  }

  // Notify the requester (the PM who raised it) of the decision — in-app + email. The in-app notice
  // deep-links to the CR's TARGET tab (e.g. a schedule change → Schedule), and when the approval
  // opened the baseline it reminds the PM to re-baseline & re-lock on Cost once the change is applied.
  // Skip self-decisions. (Owns the CR email for BOTH paths — the approval finalizer skips CHANGE_REQUEST.)
  if (cr.requestedBy && cr.requestedBy !== actorId) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, code: true } });
    const where = `on "${project?.name ?? 'a project'}"${project?.code ? ` (${project.code})` : ''}`;
    const approved = decision === 'APPROVED';
    const targetTab = crTargetTab(cr.impactAreas);
    const link = `/projects/${projectId}?tab=${encodeURIComponent(targetTab)}`;
    const reLock = approved && baselineUnlocked; // baseline was opened to apply this change
    const relockEn = ' The baseline was opened — apply the change, then re-baseline & lock it on the Cost tab.';
    await createNotification({
      userId: cr.requestedBy,
      type: approved ? 'CR_APPROVED' : 'CR_REJECTED',
      title: `Change request ${approved ? 'approved' : 'rejected'}`,
      body: `Your change request "${cr.title}" ${where} was ${approved ? 'approved' : 'rejected'}.${reLock ? relockEn : ''}`,
      projectId,
      link,
    });
    // Transactional email (Indonesian; approval category → honours the per-user opt-out). Best-effort.
    if (emailEnabled()) {
      const req = await prisma.user.findUnique({ where: { id: cr.requestedBy }, select: { email: true, notificationPrefs: true } });
      const prefs = (req?.notificationPrefs ?? null) as { email?: { approvals?: boolean } } | null;
      if (req?.email && prefs?.email?.approvals !== false) {
        const mail = crDecidedMail({
          title: cr.title,
          where: `pada proyek "${project?.name ?? 'sebuah proyek'}"${project?.code ? ` (${project.code})` : ''}`,
          outcome: approved ? 'APPROVED' : 'REJECTED',
          baselineOpened: reLock,
          url: `${appBaseUrl()}${link}`,
        });
        await sendMail({ to: req.email, subject: mail.subject, html: mail.html, text: mail.text });
      }
    }
  }
  if (decision === 'APPROVED') {
    await emitDomainEvent('change_request.approved', { projectId, changeRequestId: crId, title: cr.title });
  }
  return { changeRequest: result, baselineUnlocked };
}

export async function listCharterVersions(projectId: string) {
  return prisma.charterVersion.findMany({
    where: { projectId },
    orderBy: { version: 'desc' },
  });
}

export async function listChangeRequests(projectId: string) {
  return prisma.changeRequest.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    include: {
      requester: { select: { name: true } },
      reviewer: { select: { name: true } },
      decider: { select: { name: true } },
    },
  });
}

// Mark a submitted CR as under review (records who reviewed it and when). Idempotent
// once it has moved past SUBMITTED.
export async function reviewChangeRequest(projectId: string, crId: string, actorId: string) {
  const cr = await prisma.changeRequest.findUnique({ where: { id: crId } });
  if (!cr || cr.projectId !== projectId) throw NotFound('Change Request not found');
  if (cr.status === 'SUBMITTED') {
    await prisma.changeRequest.update({
      where: { id: crId },
      data: { status: 'UNDER_REVIEW', reviewedBy: actorId, reviewedAt: new Date() },
    });
    await writeAudit({ projectId, userId: actorId, entity: 'ChangeRequest', entityId: crId, action: 'UPDATE', before: { status: cr.status }, after: { status: 'UNDER_REVIEW' } });
  }
  return prisma.changeRequest.findUnique({
    where: { id: crId },
    include: { requester: { select: { name: true } }, reviewer: { select: { name: true } }, decider: { select: { name: true } } },
  });
}
