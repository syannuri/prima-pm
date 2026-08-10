import type { ChangeMagnitude, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { Conflict, Forbidden, NotFound } from '../../lib/errors.js';
import { createNotification } from '../notification/notification.service.js';
import { tenantMemberUserIds } from '../../lib/tenant/members.js';
import { decideChangeRequest } from '../charter/charter.service.js';

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
export interface StepInput { name: string; mode: 'ANY' | 'ALL'; approvers: ApproverInput[] }
export interface WorkflowInput {
  name: string;
  enabled?: boolean;
  condMagnitude?: ChangeMagnitude | null;
  condChargeable?: boolean | null;
  condMinAmountIdr?: number | null;
  steps: StepInput[];
}

const stepsInclude = { steps: { orderBy: { order: 'asc' as const }, include: { approvers: true } } };

function stepData(steps: StepInput[]) {
  return steps.map((s, i) => ({
    order: i + 1,
    name: s.name,
    mode: s.mode,
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
      appliesTo: 'CHANGE_REQUEST',
      condMagnitude: input.condMagnitude ?? null,
      condChargeable: input.condChargeable ?? null,
      condMinAmountIdr: input.condMinAmountIdr ?? null,
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
        enabled: input.enabled ?? true,
        condMagnitude: input.condMagnitude ?? null,
        condChargeable: input.condChargeable ?? null,
        condMinAmountIdr: input.condMinAmountIdr ?? null,
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

interface CrLike { id: string; projectId: string; magnitude: ChangeMagnitude; chargeable: boolean; amountIdr: unknown }
type WorkflowWithSteps = Awaited<ReturnType<typeof listWorkflows>>[number];
type StepWithApprovers = WorkflowWithSteps['steps'][number];

// First enabled workflow (oldest first, so ordering is stable & predictable) whose conditions all
// hold for this CR. Every set condition must match; NULL conditions mean "any". Null → no match.
export async function resolveWorkflowForCr(cr: CrLike): Promise<WorkflowWithSteps | null> {
  const workflows = await listWorkflows();
  const amount = cr.amountIdr == null ? 0 : Number(cr.amountIdr);
  const match = workflows.find((w) => {
    if (!w.enabled || w.appliesTo !== 'CHANGE_REQUEST' || w.steps.length === 0) return false;
    if (w.condMagnitude && w.condMagnitude !== cr.magnitude) return false;
    if (w.condChargeable != null && w.condChargeable !== cr.chargeable) return false;
    if (w.condMinAmountIdr != null && amount < Number(w.condMinAmountIdr)) return false;
    return true;
  });
  return match ?? null;
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
  return [...ids];
}

async function notifyStepApprovers(req: { projectId: string; entityId: string }, step: StepWithApprovers, excludeUserId: string | null) {
  const ids = (await resolveStepApproverIds(step, req.projectId)).filter((id) => id !== excludeUserId);
  if (!ids.length) return;
  const [project, cr] = await Promise.all([
    prisma.project.findUnique({ where: { id: req.projectId }, select: { name: true, code: true } }),
    prisma.changeRequest.findUnique({ where: { id: req.entityId }, select: { title: true } }),
  ]);
  const where = `on "${project?.name ?? 'a project'}"${project?.code ? ` (${project.code})` : ''}`;
  await Promise.all(ids.map((id) => createNotification({
    userId: id,
    type: 'APPROVAL_PENDING',
    title: 'Approval needed',
    body: `Change request "${cr?.title ?? ''}" ${where} needs your approval (step "${step.name}").`,
    projectId: req.projectId,
  })));
}

// Advance the request to the first actionable step at/after `fromOrder` (auto-skipping steps that
// resolve to zero approvers so a misconfigured middle step never deadlocks the chain). When no
// actionable step remains, the chain is fully approved → finalize.
async function routeFrom(
  req: { id: string; projectId: string; entityType: 'CHANGE_REQUEST'; entityId: string },
  workflow: { steps: StepWithApprovers[] },
  fromOrder: number,
  actorId: string,
): Promise<'PENDING' | 'APPROVED'> {
  for (const step of workflow.steps) {
    if (step.order < fromOrder) continue;
    const eligible = await resolveStepApproverIds(step, req.projectId);
    if (eligible.length === 0) continue; // empty step → skip
    await prisma.approvalRequest.update({ where: { id: req.id }, data: { currentOrder: step.order } });
    await notifyStepApprovers(req, step, actorId);
    return 'PENDING';
  }
  await finalize(req, 'APPROVED', actorId);
  return 'APPROVED';
}

async function finalize(
  req: { id: string; projectId: string; entityType: 'CHANGE_REQUEST'; entityId: string },
  outcome: 'APPROVED' | 'REJECTED',
  actorId: string,
) {
  await prisma.approvalRequest.update({ where: { id: req.id }, data: { status: outcome } });
  await writeAudit({
    projectId: req.projectId,
    userId: actorId,
    entity: 'ApprovalRequest',
    entityId: req.id,
    action: outcome === 'APPROVED' ? 'APPROVE' : 'REJECT',
    after: { status: outcome, entityId: req.entityId },
  });
  // Apply the entity side-effects through the existing decider (baseline unlock, revenue, charter
  // versioning, requester notification, domain event) — no duplication of that battle-tested logic.
  if (req.entityType === 'CHANGE_REQUEST') {
    await decideChangeRequest(req.projectId, req.entityId, outcome, actorId);
  }
}

// Route a freshly-submitted CR into a matching workflow. Returns the created request, or null when
// no workflow matches OR the whole workflow has no resolvable approvers (→ caller uses the legacy
// single-decider path so the CR is never left un-actionable).
export async function startApprovalForCr(cr: CrLike, actorId: string) {
  const workflow = await resolveWorkflowForCr(cr);
  if (!workflow) return null;
  let anyActionable = false;
  for (const s of workflow.steps) {
    if ((await resolveStepApproverIds(s, cr.projectId)).length) { anyActionable = true; break; }
  }
  if (!anyActionable) return null;
  const req = await prisma.approvalRequest.create({
    data: { workflowId: workflow.id, entityType: 'CHANGE_REQUEST', entityId: cr.id, projectId: cr.projectId, currentOrder: 1 },
  });
  await writeAudit({ projectId: cr.projectId, userId: actorId, entity: 'ApprovalRequest', entityId: req.id, action: 'CREATE', after: { workflow: workflow.name, entityId: cr.id } });
  await routeFrom({ id: req.id, projectId: cr.projectId, entityType: 'CHANGE_REQUEST', entityId: cr.id }, workflow, 1, actorId);
  return req;
}

// One approver casts a decision on the request's current step.
export async function decideApproval(requestId: string, approverId: string, decision: 'APPROVED' | 'REJECTED', comment?: string | null) {
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

  const ctx = { id: req.id, projectId: req.projectId, entityType: req.entityType, entityId: req.entityId } as const;

  if (decision === 'REJECTED') {
    await finalize(ctx, 'REJECTED', approverId);
    return { status: 'REJECTED' as const };
  }

  // Evaluate whether this APPROVE clears the step.
  const decisions = await prisma.approvalDecision.findMany({ where: { requestId, stepOrder: step.order } });
  const approvals = decisions.filter((d) => d.decision === 'APPROVED').map((d) => d.approverId);
  const passed = step.mode === 'ALL' ? eligible.every((id) => approvals.includes(id)) : approvals.length >= 1;
  if (!passed) return { status: 'PENDING' as const, step: step.order };

  const outcome = await routeFrom(ctx, req.workflow, step.order + 1, approverId);
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
      prisma.changeRequest.findUnique({ where: { id: r.entityId }, select: { title: true, description: true, magnitude: true, chargeable: true, amountIdr: true } }),
      prisma.project.findUnique({ where: { id: r.projectId }, select: { id: true, name: true, code: true } }),
    ]);
    out.push({
      id: r.id,
      workflowName: r.workflow.name,
      stepName: step.name,
      stepOrder: step.order,
      totalSteps: r.workflow.steps.length,
      mode: step.mode,
      alreadyVoted: !!voted,
      createdAt: r.createdAt,
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
