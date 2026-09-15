import type { ChangeMagnitude, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../../lib/errors.js';
import { createNotification } from '../notification/notification.service.js';
import { tenantMemberUserIds } from '../../lib/tenant/members.js';
import { getTenantStore, runAsSystem, runWithTenant } from '../../lib/tenant/context.js';
import { decideChangeRequest } from '../charter/charter.service.js';
import { emailEnabled, sendMail, appBaseUrl } from '../../lib/mailer.js';
import { approvalPendingMail, approvalDecidedMail, approvalUnderReviewMail, approvalOverdueMail, type RenderedMail } from '../../lib/mail/templates.js';

// Admin-configured, multi-step approval routing (Phase 1: Change Requests). A workflow is a chain
// of ordered steps; each step lists approvers (by ROLE / specific USER / the project's PM) and a
// mode (ANY = one approval clears it, ALL = every eligible approver must approve). A single reject
// closes the whole request. Approvers are resolved LIVE (never frozen into rows) so role/PM changes
// take effect immediately. See createChangeRequest for the legacy single-decider fallback.

// ---------------------------------------------------------------------------
// Workflow CRUD (tenant ADMIN)
// ---------------------------------------------------------------------------

export type ApproverKind = 'ROLE' | 'USER' | 'PROJECT_PM';
export interface ApproverInput { kind: ApproverKind; role?: Role | null; userId?: string | null }
export interface StepInput { name: string; mode: 'ANY' | 'ALL'; approvers: ApproverInput[]; slaHours?: number | null }
export interface WorkflowInput {
  name: string;
  appliesTo?: 'CHANGE_REQUEST' | 'COST_BASELINE' | 'BASELINE_UNLOCK' | 'PROJECT_CLOSURE' | 'AI_ACTION';
  enabled?: boolean;
  condMagnitude?: ChangeMagnitude | null;
  condChargeable?: boolean | null;
  condMinAmountIdr?: number | null;
  escalationUserId?: string | null;
  steps: StepInput[];
}

const stepsInclude = { steps: { orderBy: { order: 'asc' as const }, include: { approvers: true } } };

function stepData(steps: StepInput[]) {
  return steps.map((s, i) => ({
    order: i + 1,
    name: s.name,
    mode: s.mode,
    slaHours: s.slaHours ?? null,
    approvers: {
      create: s.approvers.map((a) => ({
        kind: a.kind,
        role: a.kind === 'ROLE' ? a.role ?? null : null,
        userId: a.kind === 'USER' ? a.userId ?? null : null,
      })),
    },
  }));
}

export async function listWorkflows() {
  return prisma.approvalWorkflow.findMany({
    orderBy: { createdAt: 'asc' },
    include: { ...stepsInclude, _count: { select: { requests: true } } },
  });
}

export async function createWorkflow(input: WorkflowInput, actorId: string) {
  const wf = await prisma.approvalWorkflow.create({
    data: {
      name: input.name,
      enabled: input.enabled ?? true,
      appliesTo: input.appliesTo ?? 'CHANGE_REQUEST',
      condMagnitude: input.condMagnitude ?? null,
      condChargeable: input.condChargeable ?? null,
      condMinAmountIdr: input.condMinAmountIdr ?? null,
      escalationUserId: input.escalationUserId ?? null,
      createdById: actorId,
      steps: { create: stepData(input.steps) },
    },
    include: stepsInclude,
  });
  await writeAudit({ userId: actorId, entity: 'ApprovalWorkflow', entityId: wf.id, action: 'CREATE', after: { name: wf.name } });
  return wf;
}

export async function updateWorkflow(id: string, input: WorkflowInput, actorId: string) {
  const existing = await prisma.approvalWorkflow.findUnique({ where: { id } });
  if (!existing) throw NotFound('Approval workflow not found');
  // The builder always posts the full config, so replace the step set wholesale (steps cascade to
  // their approvers). Scalars + fresh steps in one transaction.
  const wf = await prisma.$transaction(async (tx) => {
    await tx.approvalStep.deleteMany({ where: { workflowId: id } });
    return tx.approvalWorkflow.update({
      where: { id },
      data: {
        name: input.name,
        appliesTo: input.appliesTo ?? 'CHANGE_REQUEST',
        enabled: input.enabled ?? true,
        condMagnitude: input.condMagnitude ?? null,
        condChargeable: input.condChargeable ?? null,
        condMinAmountIdr: input.condMinAmountIdr ?? null,
        escalationUserId: input.escalationUserId ?? null,
        steps: { create: stepData(input.steps) },
      },
      include: stepsInclude,
    });
  });
  await writeAudit({ userId: actorId, entity: 'ApprovalWorkflow', entityId: id, action: 'UPDATE', after: { name: wf.name } });
  return wf;
}

export async function deleteWorkflow(id: string, actorId: string) {
  const existing = await prisma.approvalWorkflow.findUnique({ where: { id } });
  if (!existing) throw NotFound('Approval workflow not found');
  await prisma.approvalWorkflow.delete({ where: { id } });
  await writeAudit({ userId: actorId, entity: 'ApprovalWorkflow', entityId: id, action: 'DELETE', before: { name: existing.name } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

type EntityType = 'CHANGE_REQUEST' | 'COST_BASELINE' | 'BASELINE_UNLOCK' | 'PROJECT_CLOSURE' | 'AI_ACTION';
interface CrLike { id: string; projectId: string; magnitude: ChangeMagnitude; chargeable: boolean; amountIdr: unknown }
type WorkflowWithSteps = Awaited<ReturnType<typeof listWorkflows>>[number];
type StepWithApprovers = WorkflowWithSteps['steps'][number];
// A request under approval, identified enough to route, finalise and describe it.
interface EntityRef { id: string; entityType: EntityType; entityId: string; projectId: string }

// First enabled workflow (oldest first, so ordering is stable & predictable) that targets this
// entity type and — for Change Requests only — whose conditions all hold. Null → no match.
export async function resolveWorkflow(entityType: EntityType, matchCtx?: CrLike | null): Promise<WorkflowWithSteps | null> {
  const workflows = await listWorkflows();
  const amount = matchCtx?.amountIdr == null ? 0 : Number(matchCtx.amountIdr);
  const match = workflows.find((w) => {
    if (!w.enabled || w.appliesTo !== entityType || w.steps.length === 0) return false;
    // The magnitude/chargeable/amount conditions only make sense for a CR.
    if (entityType === 'CHANGE_REQUEST' && matchCtx) {
      if (w.condMagnitude && w.condMagnitude !== matchCtx.magnitude) return false;
      if (w.condChargeable != null && w.condChargeable !== matchCtx.chargeable) return false;
      if (w.condMinAmountIdr != null && amount < Number(w.condMinAmountIdr)) return false;
    }
    return true;
  });
  return match ?? null;
}

// Back-compat wrapper for the CR call-site.
export const resolveWorkflowForCr = (cr: CrLike) => resolveWorkflow('CHANGE_REQUEST', cr);

// Human label for the entity under approval — used in notifications and the inbox.
async function entityLabel(ref: Pick<EntityRef, 'entityType' | 'entityId'>): Promise<string> {
  if (ref.entityType === 'CHANGE_REQUEST') {
    const cr = await prisma.changeRequest.findUnique({ where: { id: ref.entityId }, select: { title: true } });
    return `change request "${cr?.title ?? ''}"`;
  }
  if (ref.entityType === 'COST_BASELINE') return 'a cost baseline lock';
  if (ref.entityType === 'BASELINE_UNLOCK') return 'a cost baseline unlock';
  if (ref.entityType === 'AI_ACTION') {
    // Describe the AI-proposed action from its stored registry key + params.
    const { describeProposal } = await import('../aiActions/aiActions.service.js');
    return describeProposal(ref.entityId);
  }
  return 'a project closure';
}

// ---------------------------------------------------------------------------
// Transactional approval emails (best-effort, dormant unless SMTP is configured). These ride
// ALONGSIDE the in-app notifications above — never replacing them — and carry a deep-link so the
// recipient can act in one click. Emails use English copy (Prismatix serves a global audience).
// ---------------------------------------------------------------------------

// Lowercase English noun-phrase for the item under approval — reuses the shared entityLabel.
const entityPhrase = (ref: Pick<EntityRef, 'entityType' | 'entityId'>): Promise<string> => entityLabel(ref);

// The project tab where a requester lands to see the decided/under-review entity.
function entityTab(entityType: EntityType): string {
  if (entityType === 'CHANGE_REQUEST') return 'Change Req';
  if (entityType === 'PROJECT_CLOSURE') return 'Closeout';
  if (entityType === 'AI_ACTION') return 'Overview'; // AI action lands the requester on the project Overview
  return 'Cost'; // COST_BASELINE / BASELINE_UNLOCK both live under the Cost tab
}

const entityUrl = (projectId: string, entityType: EntityType) =>
  `${appBaseUrl()}/projects/${projectId}?tab=${encodeURIComponent(entityTab(entityType))}`;
// The approvals inbox, focused on the specific request (client scrolls/highlights it).
const inboxUrl = (requestId: string) => `${appBaseUrl()}/approvals?focus=${encodeURIComponent(requestId)}`;
// Relative in-app path for the bell / notification-center deep-link (Notification.link) — so clicking
// an "Approval needed" notification lands the approver on the /approvals inbox, not the project tab.
const inboxPath = (requestId: string) => `/approvals?focus=${encodeURIComponent(requestId)}`;
// `on "Name" (CODE)` — the shared project-context phrase used across the emails.
const projectWhere = (project: { name: string | null; code: string | null } | null) =>
  `on "${project?.name ?? 'a project'}"${project?.code ? ` (${project.code})` : ''}`;

// Send one rendered mail to each of the given user ids (best-effort; skips inactive / no-email).
// All callers here are approval-category emails, so we honour the per-user opt-out
// notificationPrefs.email.approvals === false (default ON when the pref is absent).
async function emailUserIds(userIds: string[], mail: RenderedMail): Promise<void> {
  if (!emailEnabled() || userIds.length === 0) return;
  // User is a GLOBAL model (no tenant scoping) — safe to look up by id directly.
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, isActive: true, email: { not: '' } },
    select: { email: true, notificationPrefs: true },
  });
  const optedIn = users.filter((u) => {
    const prefs = (u.notificationPrefs ?? null) as { email?: { approvals?: boolean } } | null;
    return prefs?.email?.approvals !== false; // default ON
  });
  await Promise.all(optedIn.map((u) => sendMail({ to: u.email, subject: mail.subject, html: mail.html, text: mail.text })));
}

// Resolve a step's approvers to concrete, de-duplicated user ids for the CURRENT state of the tenant
// and project (roles → members holding them, USER → the id, PROJECT_PM → the project's PM).
async function resolveStepApproverIds(step: StepWithApprovers, projectId: string): Promise<string[]> {
  const ids = new Set<string>();
  const roles: Role[] = [];
  let needPm = false;
  for (const a of step.approvers) {
    if (a.kind === 'ROLE' && a.role) roles.push(a.role);
    else if (a.kind === 'USER' && a.userId) ids.add(a.userId);
    else if (a.kind === 'PROJECT_PM') needPm = true;
  }
  if (roles.length) (await tenantMemberUserIds(roles)).forEach((id) => ids.add(id));
  if (needPm) {
    const p = await prisma.project.findUnique({ where: { id: projectId }, select: { pmUserId: true } });
    if (p?.pmUserId) ids.add(p.pmUserId);
  }
  // Expand with active delegations (Phase 2b): anyone a resolved approver has delegated to may also
  // act on their behalf. One query over the base set; expired delegations are ignored.
  const base = [...ids];
  if (base.length) {
    const dels = await prisma.approvalDelegation.findMany({
      where: { fromUserId: { in: base }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { toUserId: true },
    });
    for (const d of dels) ids.add(d.toUserId);
  }
  return [...ids];
}

async function notifyStepApprovers(ref: EntityRef, step: StepWithApprovers, excludeUserId: string | null) {
  const ids = (await resolveStepApproverIds(step, ref.projectId)).filter((id) => id !== excludeUserId);
  if (!ids.length) return;
  const [project, label] = await Promise.all([
    prisma.project.findUnique({ where: { id: ref.projectId }, select: { name: true, code: true } }),
    entityLabel(ref),
  ]);
  const where = `on "${project?.name ?? 'a project'}"${project?.code ? ` (${project.code})` : ''}`;
  await Promise.all(ids.map((id) => createNotification({
    userId: id,
    type: 'APPROVAL_PENDING',
    title: 'Approval needed',
    body: `${cap(label)} ${where} needs your approval (step "${step.name}").`,
    projectId: ref.projectId,
    link: inboxPath(ref.id),
  })));
  // Transactional email alongside the in-app notice — deep-links to the focused inbox row.
  if (emailEnabled()) {
    const phrase = await entityPhrase(ref);
    await emailUserIds(ids, approvalPendingMail({ phrase, where: projectWhere(project), stepName: step.name, url: inboxUrl(ref.id) }));
  }
}

// Email the requester that their item was decided (all entity types) — additive to the in-app
// decision notice, which lives in charter.service (CR) / notifyRequester (baseline, closure).
// Best-effort; skips self-decisions and the SMTP-off case.
async function emailRequesterDecided(ref: EntityRef, payload: unknown, outcome: 'APPROVED' | 'REJECTED', actorId: string): Promise<void> {
  if (!emailEnabled()) return;
  const requesterId = ref.entityType === 'CHANGE_REQUEST'
    ? (await prisma.changeRequest.findUnique({ where: { id: ref.entityId }, select: { requestedBy: true } }))?.requestedBy
    : ((payload ?? {}) as { requestedById?: string }).requestedById;
  if (!requesterId || requesterId === actorId) return;
  const [project, phrase] = await Promise.all([
    prisma.project.findUnique({ where: { id: ref.projectId }, select: { name: true, code: true } }),
    entityPhrase(ref),
  ]);
  await emailUserIds([requesterId], approvalDecidedMail({ phrase, where: projectWhere(project), outcome, url: entityUrl(ref.projectId, ref.entityType) }));
}

// Advance the request to the first actionable step at/after `fromOrder` (auto-skipping steps that
// resolve to zero approvers so a misconfigured middle step never deadlocks the chain). When no
// actionable step remains, the chain is fully approved → finalize.
async function routeFrom(
  ref: EntityRef,
  workflow: { steps: StepWithApprovers[] },
  fromOrder: number,
  actorId: string,
  opts: FinalizeOpts = {},
  // Normally the person who triggered this routing (the requester on start, or the approver who
  // just cleared a step) is excluded from the "approval needed" notice — they either just acted or
  // are the requester and get their own receipt. For AI-proposed actions the requester IS the
  // human-in-the-loop approver, so on the initial routing we notify them too (they get no
  // separate receipt, and the whole point is that their click executes the AI's draft).
  includeActorInNotify = false,
): Promise<'PENDING' | 'APPROVED'> {
  for (const step of workflow.steps) {
    if (step.order < fromOrder) continue;
    const eligible = await resolveStepApproverIds(step, ref.projectId);
    if (eligible.length === 0) continue; // empty step → skip
    // Set (or clear) the SLA deadline for the new current step, and reset the escalation flag.
    const dueAt = step.slaHours ? new Date(Date.now() + step.slaHours * 3_600_000) : null;
    await prisma.approvalRequest.update({ where: { id: ref.id }, data: { currentOrder: step.order, dueAt, escalatedAt: null } });
    await notifyStepApprovers(ref, step, includeActorInNotify ? null : actorId);
    return 'PENDING';
  }
  await finalize(ref, 'APPROVED', actorId, opts);
  return 'APPROVED';
}

interface FinalizeOpts { applyToRevenue?: boolean }

// Close out a request and apply the pending action for its entity type. Change Requests reuse the
// existing decider (baseline unlock, revenue, charter versioning, notify, event). Cost-baseline and
// closure requests replay their stored payload; closure application lands in Phase 2b.
async function finalize(ref: EntityRef, outcome: 'APPROVED' | 'REJECTED', actorId: string, opts: FinalizeOpts = {}) {
  const row = await prisma.approvalRequest.update({ where: { id: ref.id }, data: { status: outcome } });
  await writeAudit({
    projectId: ref.projectId,
    userId: actorId,
    entity: 'ApprovalRequest',
    entityId: ref.id,
    action: outcome === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: { status: outcome, entityType: ref.entityType, entityId: ref.entityId },
  });

  // Requester decision email for baseline/closure. CHANGE_REQUEST is intentionally SKIPPED here —
  // decideChangeRequest owns the (richer, re-baseline-aware) CR email so it fires on BOTH the
  // workflow-finalize path and the legacy single-decider path, with no duplicate.
  if (ref.entityType !== 'CHANGE_REQUEST') await emailRequesterDecided(ref, row.payload, outcome, actorId);

  if (ref.entityType === 'CHANGE_REQUEST') {
    await decideChangeRequest(ref.projectId, ref.entityId, outcome, actorId, opts.applyToRevenue ?? false);
    return;
  }

  if (ref.entityType === 'COST_BASELINE') {
    const payload = (row.payload ?? {}) as { reason?: string; requestedById?: string };
    if (outcome === 'APPROVED') {
      // Dynamic import breaks the baseline.service ⇄ approval.service cycle (baseline calls startApproval).
      const { applyBaselineLock } = await import('../projects/baseline.service.js');
      await applyBaselineLock(ref.projectId, payload.reason, actorId);
    }
    await notifyRequester(payload.requestedById, actorId, ref.projectId, outcome, 'Cost baseline lock');
    return;
  }

  if (ref.entityType === 'BASELINE_UNLOCK') {
    const payload = (row.payload ?? {}) as { reason?: string; requestedById?: string };
    if (outcome === 'APPROVED') {
      // Approved unlock re-opens the PMB/BAC. Same dynamic import (cycle-break); locked=false unlocks.
      const { applyBaselineLock } = await import('../projects/baseline.service.js');
      await applyBaselineLock(ref.projectId, payload.reason, actorId, false);
    }
    await notifyRequester(payload.requestedById, actorId, ref.projectId, outcome, 'Cost baseline unlock');
    return;
  }

  if (ref.entityType === 'PROJECT_CLOSURE') {
    const payload = (row.payload ?? {}) as { closureNote?: string | null; forceClose?: boolean; requestedById?: string };
    if (outcome === 'APPROVED') {
      // Apply the closure through updateProject with the gate skipped so it doesn't re-route.
      const { updateProject } = await import('../projects/projects.service.js');
      await updateProject(
        ref.projectId,
        { status: 'CLOSED', closureNote: payload.closureNote ?? undefined, forceClose: payload.forceClose || undefined },
        actorId,
        { skipApprovalGate: true },
      );
    }
    await notifyRequester(payload.requestedById, actorId, ref.projectId, outcome, 'Project closure');
    return;
  }

  if (ref.entityType === 'AI_ACTION') {
    // Approved → run the whitelisted, audited write with the APPROVER as actor (AI never writes).
    // Rejected → mark the proposal declined. Dynamic import breaks the aiActions ⇄ approval cycle.
    const payload = (row.payload ?? {}) as { requestedById?: string };
    const { finalizeProposal } = await import('../aiActions/aiActions.service.js');
    await finalizeProposal(ref.entityId, ref.projectId, outcome, actorId);
    await notifyRequester(payload.requestedById, actorId, ref.projectId, outcome, 'AI-proposed action');
  }
}

async function notifyRequester(requesterId: string | undefined, actorId: string, projectId: string, outcome: 'APPROVED' | 'REJECTED', subject: string) {
  if (!requesterId || requesterId === actorId) return;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, code: true } });
  const where = `on "${project?.name ?? 'a project'}"${project?.code ? ` (${project.code})` : ''}`;
  await createNotification({
    userId: requesterId,
    type: outcome === 'APPROVED' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED',
    title: `${subject} ${outcome === 'APPROVED' ? 'approved' : 'rejected'}`,
    body: `Your ${subject.toLowerCase()} ${where} was ${outcome === 'APPROVED' ? 'approved' : 'rejected'}.`,
    projectId,
  });
}

// Route an entity into a matching workflow. Returns the created request, or null when no workflow
// matches OR the whole workflow has no resolvable approvers (→ caller applies its default path so
// the action is never left un-actionable).
export async function startApproval(
  ref: { entityType: EntityType; entityId: string; projectId: string; payload?: Record<string, unknown> | null; matchCtx?: CrLike | null },
  actorId: string,
) {
  const workflow = await resolveWorkflow(ref.entityType, ref.matchCtx ?? null);
  if (!workflow) return null;
  let anyActionable = false;
  for (const s of workflow.steps) {
    if ((await resolveStepApproverIds(s, ref.projectId)).length) { anyActionable = true; break; }
  }
  if (!anyActionable) return null;
  const req = await prisma.approvalRequest.create({
    data: {
      workflowId: workflow.id,
      entityType: ref.entityType,
      entityId: ref.entityId,
      projectId: ref.projectId,
      payload: (ref.payload ?? undefined) as never,
      currentOrder: 1,
    },
  });
  await writeAudit({ projectId: ref.projectId, userId: actorId, entity: 'ApprovalRequest', entityId: req.id, action: 'CREATE', after: { workflow: workflow.name, entityType: ref.entityType, entityId: ref.entityId } });
  const entityRef: EntityRef = { id: req.id, entityType: ref.entityType, entityId: ref.entityId, projectId: ref.projectId };
  // AI actions: the requester is also the intended approver, so include them in the "approval
  // needed" notice — otherwise a self-proposed action lands silently and looks like nothing happened.
  const status = await routeFrom(entityRef, workflow, 1, actorId, {}, ref.entityType === 'AI_ACTION');
  // Receipt to the requester that their item is now under review (only if it didn't auto-approve).
  if (status === 'PENDING') await emailRequesterUnderReview(entityRef, actorId);
  return req;
}

// Email the requester that their submitted item is now awaiting approval. Best-effort; dormant off.
async function emailRequesterUnderReview(ref: EntityRef, requesterId: string): Promise<void> {
  if (!emailEnabled() || !requesterId) return;
  const [project, phrase] = await Promise.all([
    prisma.project.findUnique({ where: { id: ref.projectId }, select: { name: true, code: true } }),
    entityPhrase(ref),
  ]);
  await emailUserIds([requesterId], approvalUnderReviewMail({ phrase, where: projectWhere(project), url: entityUrl(ref.projectId, ref.entityType) }));
}

// Back-compat wrapper for the CR call-site.
export const startApprovalForCr = (cr: CrLike, actorId: string) =>
  startApproval({ entityType: 'CHANGE_REQUEST', entityId: cr.id, projectId: cr.projectId, matchCtx: cr }, actorId);

// One approver casts a decision on the request's current step.
export async function decideApproval(
  requestId: string,
  approverId: string,
  decision: 'APPROVED' | 'REJECTED',
  comment?: string | null,
  opts: FinalizeOpts = {},
) {
  const req = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: { workflow: { include: stepsInclude } },
  });
  if (!req) throw NotFound('Approval request not found');
  if (req.status !== 'PENDING') throw Conflict('This approval is already closed');
  const step = req.workflow.steps.find((s) => s.order === req.currentOrder);
  if (!step) throw Conflict('Approval step is missing — the workflow was changed');

  const eligible = await resolveStepApproverIds(step, req.projectId);
  if (!eligible.includes(approverId)) throw Forbidden('You are not an approver for this step');
  const dup = await prisma.approvalDecision.findFirst({ where: { requestId, stepOrder: step.order, approverId } });
  if (dup) throw Conflict('You have already decided on this step');

  await prisma.approvalDecision.create({
    data: { requestId, stepId: step.id, stepOrder: step.order, approverId, decision, comment: comment ?? null },
  });

  const ref: EntityRef = { id: req.id, projectId: req.projectId, entityType: req.entityType, entityId: req.entityId };

  if (decision === 'REJECTED') {
    await finalize(ref, 'REJECTED', approverId, opts);
    return { status: 'REJECTED' as const };
  }

  // Evaluate whether this APPROVE clears the step.
  const decisions = await prisma.approvalDecision.findMany({ where: { requestId, stepOrder: step.order } });
  const approvals = decisions.filter((d) => d.decision === 'APPROVED').map((d) => d.approverId);
  const passed = step.mode === 'ALL' ? eligible.every((id) => approvals.includes(id)) : approvals.length >= 1;
  if (!passed) return { status: 'PENDING' as const, step: step.order };

  const outcome = await routeFrom(ref, req.workflow, step.order + 1, approverId, opts);
  return { status: outcome };
}

// The active user's pending approvals — requests whose CURRENT step lists them as an eligible
// approver. Auto tenant-scoped (ApprovalRequest is a scoped model).
export async function listMyApprovals(userId: string) {
  const reqs = await prisma.approvalRequest.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    include: { workflow: { include: stepsInclude } },
  });
  const out = [];
  for (const r of reqs) {
    const step = r.workflow.steps.find((s) => s.order === r.currentOrder);
    if (!step) continue;
    const eligible = await resolveStepApproverIds(step, r.projectId);
    if (!eligible.includes(userId)) continue;
    const [voted, cr, project] = await Promise.all([
      prisma.approvalDecision.findFirst({ where: { requestId: r.id, stepOrder: step.order, approverId: userId } }),
      r.entityType === 'CHANGE_REQUEST'
        ? prisma.changeRequest.findUnique({ where: { id: r.entityId }, select: { title: true, description: true, magnitude: true, chargeable: true, amountIdr: true } })
        : Promise.resolve(null),
      prisma.project.findUnique({ where: { id: r.projectId }, select: { id: true, name: true, code: true } }),
    ]);
    const payload = (r.payload ?? null) as { reason?: string; actionType?: string; rationale?: string | null } | null;
    out.push({
      id: r.id,
      entityType: r.entityType,
      actionLabel: cap(await entityLabel({ entityType: r.entityType, entityId: r.entityId })),
      reason: payload?.reason ?? null,
      // Stage C — the AI-proposed action's kind + rationale so the inbox can render a badge + note.
      aiAction: r.entityType === 'AI_ACTION' ? { actionType: payload?.actionType ?? null, rationale: payload?.rationale ?? null } : null,
      workflowName: r.workflow.name,
      stepName: step.name,
      stepOrder: step.order,
      totalSteps: r.workflow.steps.length,
      mode: step.mode,
      alreadyVoted: !!voted,
      createdAt: r.createdAt,
      dueAt: r.dueAt,
      project,
      changeRequest: cr ? { ...cr, amountIdr: cr.amountIdr == null ? null : Number(cr.amountIdr) } : null,
    });
  }
  return out;
}

// Count only — for the inbox badge.
export async function countMyApprovals(userId: string) {
  return (await listMyApprovals(userId)).length;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ---------------------------------------------------------------------------
// Delegation (Phase 2b) — "while I'm away, X approves on my behalf".
// ---------------------------------------------------------------------------

export async function getMyDelegation(userId: string) {
  const d = await prisma.approvalDelegation.findFirst({ where: { fromUserId: userId }, orderBy: { createdAt: 'desc' } });
  if (!d) return null;
  const to = await prisma.user.findUnique({ where: { id: d.toUserId }, select: { id: true, name: true, email: true } });
  return { ...d, toUser: to };
}

export async function setDelegation(fromUserId: string, toUserId: string, opts: { expiresAt?: Date | null; note?: string | null } = {}) {
  if (toUserId === fromUserId) throw BadRequest('You cannot delegate to yourself');
  const target = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true } });
  if (!target) throw NotFound('User not found');
  // A user has at most one active delegation — replace any existing one.
  await prisma.approvalDelegation.deleteMany({ where: { fromUserId } });
  const row = await prisma.approvalDelegation.create({ data: { fromUserId, toUserId, expiresAt: opts.expiresAt ?? null, note: opts.note ?? null } });
  await writeAudit({ userId: fromUserId, entity: 'ApprovalDelegation', entityId: row.id, action: 'CREATE', after: { toUserId, expiresAt: row.expiresAt } });
  return row;
}

export async function clearDelegation(fromUserId: string) {
  await prisma.approvalDelegation.deleteMany({ where: { fromUserId } });
  return { ok: true };
}

// Active members of the current tenant a user can delegate to (id + name). Available to any signed-in
// user (unlike the ADMIN-only /members), so an approver can pick a delegate. Mirrors the off-mode
// fallback used by tenantMemberUserIds.
export async function listDelegatableMembers(excludeUserId: string) {
  const tenantId = getTenantStore()?.tenantId;
  if (!tenantId) {
    return prisma.user.findMany({
      where: { isActive: true, role: { not: 'GUEST' }, id: { not: excludeUserId } },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }
  const ms = await prisma.membership.findMany({
    where: { tenantId, user: { isActive: true, id: { not: excludeUserId } } },
    select: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { user: { name: 'asc' } },
  });
  return ms.map((m) => m.user);
}

// SLA escalation sweep (Phase 2b) — called on a timer. Finds every PENDING request whose current
// step has blown its deadline and hasn't been escalated yet, notifies the escalation target (the
// workflow's escalationUserId, else the tenant's ADMINs) and stamps escalatedAt so it fires once.
// Reads across ALL tenants (runAsSystem) then acts inside each request's own tenant scope.
export async function escalateOverdueApprovals(now = new Date()) {
  const due = await runAsSystem(() =>
    prisma.approvalRequest.findMany({
      where: { status: 'PENDING', escalatedAt: null, dueAt: { not: null, lt: now } },
      include: { workflow: { include: stepsInclude } },
    }),
  );
  let escalated = 0;
  for (const r of due) {
    const act = async () => {
      const step = r.workflow.steps.find((s) => s.order === r.currentOrder);
      const targets = r.workflow.escalationUserId ? [r.workflow.escalationUserId] : await tenantMemberUserIds(['ADMIN']);
      if (targets.length) {
        const [project, label] = await Promise.all([
          prisma.project.findUnique({ where: { id: r.projectId }, select: { name: true, code: true } }),
          entityLabel({ entityType: r.entityType, entityId: r.entityId }),
        ]);
        const where = `on "${project?.name ?? 'a project'}"${project?.code ? ` (${project.code})` : ''}`;
        await Promise.all(targets.map((id) => createNotification({
          userId: id,
          type: 'APPROVAL_OVERDUE',
          title: 'Approval overdue',
          body: `${cap(label)} ${where} is past its deadline at step "${step?.name ?? ''}".`,
          projectId: r.projectId,
          link: inboxPath(r.id),
        })));
        // Transactional email to the escalation target(s) — deep-links to the focused inbox row.
        if (emailEnabled()) {
          const phrase = await entityPhrase({ entityType: r.entityType, entityId: r.entityId });
          await emailUserIds(targets, approvalOverdueMail({ phrase, where: projectWhere(project), stepName: step?.name ?? '', url: inboxUrl(r.id) }));
        }
      }
      await prisma.approvalRequest.update({ where: { id: r.id }, data: { escalatedAt: now } });
    };
    // Act inside the request's tenant so notifications/queries are correctly scoped. Rows with no
    // tenant (enforcement off / single-tenant) act directly.
    if (r.tenantId) await runWithTenant(r.tenantId, act);
    else await act();
    escalated++;
  }
  return { escalated, checked: due.length };
}
