import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { aiEnabled } from '../../lib/ai.js';
import { createNotification } from '../notification/notification.service.js';
import { createRisk } from '../risk/risk.service.js';
import { setTaskProgress, applyAutoSchedule } from '../schedule/schedule.service.js';
import { createChangeRequest } from '../charter/charter.service.js';
import { startApproval, resolveWorkflow, createWorkflow } from '../approval/approval.service.js';
import { RISK_KINDS, RESPONSE_STRATEGIES } from '../risk/risk.schemas.js';
import { recordBaseline } from './aiActionOutcomes.service.js';
import { updateDirectLine } from '../cost/cost.service.js';

// =====================================================================
// Stage C — semi-autonomous AI actions.
//
// The AI DRAFTS a concrete, whitelisted write; it is persisted as an AiActionProposal and routed
// through the EXISTING approval engine (as an AI_ACTION entity). A human approver clears it, and
// only THEN does the real, audited service run — with the approver as the actor. The AI never
// touches the DB. Advisory + human-in-the-loop + dormant-by-default, exactly like the read-only AI
// features, but now the human's click EXECUTES rather than just informs.
//
// Gating is stronger than the other AI features: global env (ANTHROPIC_API_KEY) AND a SEPARATE
// per-tenant opt-in (Tenant.aiActionsEnabled) — a tenant must explicitly consent to AI-drafted
// change actions, distinct from enabling the narrative/advisory features (aiNarrativeEnabled).
// =====================================================================

export const AI_ACTION_TYPES = ['CREATE_RISK', 'UPDATE_TASK_PROGRESS', 'CREATE_CHANGE_REQUEST', 'TIDY_SCHEDULE', 'REASSIGN_MANPOWER'] as const;
export type AiActionType = (typeof AI_ACTION_TYPES)[number];

// Qualitative score (1-5) → probability fraction, mirroring the risk-suggest bulk-create mapping.
// EMV impact is left at 0 for the PM to refine (same as AiRiskSuggest); the score drives the matrix.
const SCORE_TO_PCT: Record<number, number> = { 1: 0.1, 2: 0.3, 3: 0.5, 4: 0.7, 5: 0.9 };

// ---- Per-action parameter schemas (narrow; the AI must fit inside these) -------------------------

const createRiskParams = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(4000).optional(),
  category: z.string().max(120).optional(),
  kind: z.enum(RISK_KINDS).default('THREAT'),
  probabilityScore: z.coerce.number().int().min(1).max(5),
  impactScore: z.coerce.number().int().min(1).max(5),
  responseStrategy: z.enum(RESPONSE_STRATEGIES).optional(),
});

const updateTaskProgressParams = z.object({
  taskId: z.string().uuid(),
  progressPct: z.coerce.number().min(0).max(100),
});

const createChangeRequestParams = z.object({
  title: z.string().min(3).max(160),
  description: z.string().min(5).max(4000),
  chargeable: z.boolean().default(false),
  amountIdr: z.coerce.number().nonnegative().optional(),
  magnitude: z.enum(['MINOR', 'MAJOR']).default('MINOR'),
  impactAreas: z.array(z.enum(['CHARTER', 'COST', 'SCHEDULE', 'RESOURCE', 'QUALITY', 'RISK'])).min(1),
}).refine((d) => !d.chargeable || (d.amountIdr != null && d.amountIdr > 0), {
  message: 'A chargeable change request needs an amount greater than zero',
});

const tidyScheduleParams = z.object({
  mode: z.enum(['push', 'asap']).default('push'),
});

// Reassign a task's manpower line from an over-allocated resource to a lighter-loaded one. Moves the
// capacity load AND recomputes cost from the new resource's rate (a budget edit → requires an
// unlocked baseline; on a locked project the executor fails cleanly with that message).
const reassignManpowerParams = z.object({
  costItemId: z.string().uuid(),
  toResourceId: z.string().uuid(),
});

// ---- The action registry: schema + human describe + audited executor -----------------------------

interface ActionDef<P> {
  schema: z.ZodType<P>;
  // Short human phrase for the inbox / notifications (embedded as "{describe} on <project> …").
  describe: (params: P) => Promise<string>;
  // Runs the REAL write via the existing audited service, with the approver as actor.
  execute: (projectId: string, params: P, actorId: string) => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY: Record<AiActionType, ActionDef<any>> = {
  CREATE_RISK: {
    schema: createRiskParams,
    describe: async (p: z.infer<typeof createRiskParams>) =>
      `an AI-proposed action (create risk "${p.title}", P${p.probabilityScore}×I${p.impactScore})`,
    execute: async (projectId, p: z.infer<typeof createRiskParams>, actorId) => {
      await createRisk(projectId, {
        title: p.title,
        description: p.description,
        category: p.category,
        kind: p.kind,
        status: 'IDENTIFIED',
        probabilityScore: p.probabilityScore,
        impactScore: p.impactScore,
        probabilityPct: SCORE_TO_PCT[p.probabilityScore] ?? 0.5,
        impactCostIdr: 0,
        responseStrategy: p.responseStrategy,
        includeInReserve: true,
      }, actorId);
    },
  },
  UPDATE_TASK_PROGRESS: {
    schema: updateTaskProgressParams,
    describe: async (p: z.infer<typeof updateTaskProgressParams>) => {
      const task = await prisma.task.findFirst({ where: { id: p.taskId }, select: { name: true } });
      return `an AI-proposed action (set "${task?.name ?? 'a task'}" progress to ${p.progressPct}%)`;
    },
    execute: async (projectId, p: z.infer<typeof updateTaskProgressParams>, actorId) => {
      await setTaskProgress(projectId, p.taskId, p.progressPct, actorId);
    },
  },
  CREATE_CHANGE_REQUEST: {
    schema: createChangeRequestParams,
    describe: async (p: z.infer<typeof createChangeRequestParams>) =>
      `an AI-proposed action (draft change request "${p.title}")`,
    execute: async (projectId, p: z.infer<typeof createChangeRequestParams>, actorId) => {
      await createChangeRequest(projectId, {
        title: p.title,
        description: p.description,
        chargeable: p.chargeable,
        amountIdr: p.amountIdr,
        magnitude: p.magnitude,
        impactAreas: p.impactAreas,
      }, actorId);
    },
  },
  TIDY_SCHEDULE: {
    schema: tidyScheduleParams,
    describe: async (p: z.infer<typeof tidyScheduleParams>) =>
      `an AI-proposed action (tidy the schedule, ${p.mode === 'asap' ? 'compact/ASAP' : 'push-only'})`,
    execute: async (projectId, p: z.infer<typeof tidyScheduleParams>, actorId) => {
      await applyAutoSchedule(projectId, { dryRun: false, actorId, mode: p.mode });
    },
  },
  REASSIGN_MANPOWER: {
    schema: reassignManpowerParams,
    describe: async (p: z.infer<typeof reassignManpowerParams>) => {
      const line = await prisma.costItemDirect.findFirst({ where: { id: p.costItemId }, select: { label: true, task: { select: { name: true } } } });
      const res = await prisma.resource.findFirst({ where: { id: p.toResourceId }, select: { name: true } });
      return `an AI-proposed action (reassign "${line?.task?.name ?? line?.label ?? 'manpower'}" to ${res?.name ?? 'a resource'})`;
    },
    execute: async (projectId, p: z.infer<typeof reassignManpowerParams>, actorId) => {
      const line = await prisma.costItemDirect.findFirst({
        where: { id: p.costItemId, projectId, type: 'MANPOWER' },
        select: { id: true, planMandays: true, taskId: true },
      });
      if (!line) throw BadRequest('Manpower line not found on this project');
      const res = await prisma.resource.findFirst({ where: { id: p.toResourceId }, select: { id: true } });
      if (!res) throw BadRequest('Target resource not found');
      // resourceId given → the server fills role/rate/label; preserve mandays + task link.
      await updateDirectLine(projectId, line.id, {
        type: 'MANPOWER', resourceId: p.toResourceId, planMandays: Number(line.planMandays), taskId: line.taskId ?? undefined,
      }, actorId);
    },
  },
};

function actionDef(actionType: string): ActionDef<unknown> {
  const def = REGISTRY[actionType as AiActionType];
  if (!def) throw BadRequest(`Unknown AI action type "${actionType}"`);
  return def;
}

// A DB-free human label for a stored proposal — used for list surfaces where doing per-row name
// lookups (as the richer REGISTRY.describe does) would fan out into many queries. Best-effort: an
// unrecognised type or bad params degrades to a generic phrase.
function describeRow(actionType: string, params: unknown): string {
  const def = REGISTRY[actionType as AiActionType];
  const parsed = def?.schema.safeParse(params);
  if (!def || !parsed?.success) return 'an AI-proposed action';
  const p = parsed.data as Record<string, unknown>;
  switch (actionType as AiActionType) {
    case 'CREATE_RISK': return `create risk "${p.title}" (P${p.probabilityScore}×I${p.impactScore})`;
    case 'UPDATE_TASK_PROGRESS': return `set a task's progress to ${p.progressPct}%`;
    case 'CREATE_CHANGE_REQUEST': return `draft change request "${p.title}"`;
    case 'TIDY_SCHEDULE': return `tidy the schedule (${p.mode === 'asap' ? 'compact/ASAP' : 'push-only'})`;
    case 'REASSIGN_MANPOWER': return 'reassign a task\'s manpower to another resource';
    default: return 'an AI-proposed action';
  }
}

// ---- Gating -------------------------------------------------------------------------------------

// Env + per-tenant aiActionsEnabled. Drives the client's show/hide of the propose buttons.
export async function aiActionsAvailableForProject(projectId: string): Promise<boolean> {
  if (!aiEnabled()) return false;
  const proj = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { tenantId: true, tenant: { select: { aiActionsEnabled: true } } },
  });
  if (!proj) return false;
  const hasTenant = Boolean(getTenantStore()?.tenantId || proj.tenantId);
  return hasTenant ? proj.tenant?.aiActionsEnabled === true : true;
}

// Throw the right status when actions are off: 503 (env unset) or 403 (tenant not opted in).
async function assertActionsEnabled(projectId: string): Promise<void> {
  if (!aiEnabled()) throw new AppError(503, 'Fitur AI belum dikonfigurasi di server.', 'AI_DISABLED');
  const proj = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { tenantId: true, tenant: { select: { aiActionsEnabled: true } } },
  });
  if (!proj) throw NotFound('Project not found');
  const hasTenant = Boolean(getTenantStore()?.tenantId || proj.tenantId);
  if (hasTenant && proj.tenant?.aiActionsEnabled !== true) {
    throw Forbidden('Aksi AI belum diaktifkan untuk workspace ini.');
  }
}

// ---- Default routing ----------------------------------------------------------------------------

// If no AI_ACTION workflow is configured, seed a sensible default so proposals are usable out of the
// box WITHOUT ever auto-applying: one ANY step to the Project PM + any ADMIN. Admins can later edit
// or replace it in Settings → Governance (it's a normal workflow row).
async function ensureAiActionWorkflow(actorId: string): Promise<void> {
  const existing = await resolveWorkflow('AI_ACTION');
  if (existing) return;
  await createWorkflow({
    name: 'Default AI action approval',
    appliesTo: 'AI_ACTION',
    enabled: true,
    steps: [{
      name: 'Review AI action',
      mode: 'ANY',
      approvers: [{ kind: 'PROJECT_PM' }, { kind: 'ROLE', role: 'ADMIN' }],
    }],
  }, actorId);
}

// ---- Propose ------------------------------------------------------------------------------------

export interface ProposeInput { projectId: string; actionType: string; params: unknown; rationale?: string | null; confidence?: string | null }

// Validate + persist a proposal, then route it into the approval engine. Returns the proposal id and
// whether it landed in an approver's inbox (routed=false ⇒ no approver resolvable — proposal stays
// PENDING and a human must configure a workflow with a reachable approver).
export async function proposeAction(input: ProposeInput, actorId: string): Promise<{ id: string; routed: boolean }> {
  await assertActionsEnabled(input.projectId);
  const def = actionDef(input.actionType);
  const parsed = def.schema.safeParse(input.params);
  if (!parsed.success) throw BadRequest('AI action parameters are invalid', parsed.error.flatten());

  const proposal = await prisma.aiActionProposal.create({
    data: {
      projectId: input.projectId,
      actionType: input.actionType,
      params: parsed.data as object,
      rationale: input.rationale ?? null,
      confidence: input.confidence ?? null,
      proposedById: actorId,
      status: 'PENDING',
    },
  });

  const payload = { actionType: input.actionType, params: parsed.data, rationale: input.rationale ?? null, requestedById: actorId };
  let started = await startApproval({ entityType: 'AI_ACTION', entityId: proposal.id, projectId: input.projectId, payload }, actorId);
  if (!started) {
    // No AI_ACTION workflow matched → seed the default and route once more.
    await ensureAiActionWorkflow(actorId);
    started = await startApproval({ entityType: 'AI_ACTION', entityId: proposal.id, projectId: input.projectId, payload }, actorId);
  }
  return { id: proposal.id, routed: Boolean(started) };
}

// Recent proposals for a project (any status) — drives a small "AI actions" history/status surface.
export async function listProjectProposals(projectId: string) {
  return prisma.aiActionProposal.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, actionType: true, params: true, rationale: true, confidence: true, status: true, failureNote: true, createdAt: true, appliedAt: true },
  });
}

// The proposals the current user RAISED (via Anett), across every project they can access — the
// requester's own tracking surface on the approvals page. AiActionProposal is tenant-scoped, so this
// is auto-bounded to the active workspace. Human label is derived from the row (no extra query).
export async function listMyRaisedProposals(userId: string) {
  const rows = await prisma.aiActionProposal.findMany({
    where: { proposedById: userId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true, actionType: true, params: true, rationale: true, status: true, failureNote: true,
      createdAt: true, appliedAt: true,
      project: { select: { id: true, name: true, code: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    actionType: r.actionType,
    label: describeRow(r.actionType, r.params),
    rationale: r.rationale,
    status: r.status,
    failureNote: r.failureNote,
    createdAt: r.createdAt,
    appliedAt: r.appliedAt,
    project: r.project,
  }));
}

// ---- Finalize (called by approval.finalize on the terminal decision) ----------------------------

// Approved → run the executor with the approver as actor; mark APPLIED, or FAILED if it throws (no
// effect is left half-applied — each executor is a single audited service call/transaction).
// Rejected → mark the proposal declined. Idempotent-ish: only acts on a still-PENDING proposal.
export async function finalizeProposal(
  proposalId: string,
  projectId: string,
  outcome: 'APPROVED' | 'REJECTED',
  actorId: string,
): Promise<void> {
  const proposal = await prisma.aiActionProposal.findFirst({ where: { id: proposalId, projectId } });
  if (!proposal || proposal.status !== 'PENDING') return;

  if (outcome === 'REJECTED') {
    await prisma.aiActionProposal.update({ where: { id: proposalId }, data: { status: 'REJECTED' } });
    return;
  }

  const def = actionDef(proposal.actionType);
  const parsed = def.schema.safeParse(proposal.params);
  if (!parsed.success) {
    await prisma.aiActionProposal.update({ where: { id: proposalId }, data: { status: 'FAILED', failureNote: 'stored parameters no longer valid' } });
    return;
  }
  try {
    await def.execute(projectId, parsed.data, actorId);
    const appliedAt = new Date();
    await prisma.aiActionProposal.update({ where: { id: proposalId }, data: { status: 'APPLIED', appliedAt } });
    // Outcome learning — stamp a baseline + schedule measurement. Best-effort; never breaks finalize.
    await recordBaseline({ id: proposalId, actionType: proposal.actionType, projectId }, appliedAt);
  } catch (err) {
    const note = err instanceof Error ? err.message : 'execution failed';
    await prisma.aiActionProposal.update({ where: { id: proposalId }, data: { status: 'FAILED', failureNote: note.slice(0, 500) } });
    // Best-effort heads-up to the proposer that the approved action could not be applied.
    if (proposal.proposedById) {
      await createNotification({
        userId: proposal.proposedById,
        type: 'APPROVAL_APPROVED',
        title: 'AI action could not be applied',
        body: `The approved AI action failed to apply: ${note.slice(0, 200)}`,
        projectId,
      }).catch(() => undefined);
    }
  }
}

// ---- Describe (for the approval engine's entityLabel + the inbox) -------------------------------

// Human phrase for a proposal, resilient to malformed stored params (best-effort).
export async function describeProposal(proposalId: string): Promise<string> {
  const proposal = await prisma.aiActionProposal.findFirst({ where: { id: proposalId } });
  if (!proposal) return 'an AI-proposed action';
  const def = REGISTRY[proposal.actionType as AiActionType];
  if (!def) return 'an AI-proposed action';
  const parsed = def.schema.safeParse(proposal.params);
  if (!parsed.success) return 'an AI-proposed action';
  try {
    return await def.describe(parsed.data);
  } catch {
    return 'an AI-proposed action';
  }
}
