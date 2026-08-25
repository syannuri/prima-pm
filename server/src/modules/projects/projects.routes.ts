import { Router } from 'express';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole, requireProjectAccess, requireProjectGovernance } from '../../middleware/rbac.js';
import { createProjectSchema, updateProjectSchema, reassignPmSchema } from './projects.schemas.js';
import { z } from 'zod';
import * as svc from './projects.service.js';
import { setBaselineLock, listBaselineVersions, getBaselineVersion, restoreBaselineVersion } from './baseline.service.js';
import { getClosureReadiness } from './closure.js';
import { getActivationReadiness, getActivationReview, notifyActivationReady } from './activation.js';
import { getNextSteps } from './nextsteps.js';
import { aiAvailableForProject } from '../charter/crImpact.service.js';
import { extractFromNotes } from '../dataextract/dataExtract.service.js';
import { getProjectPredictive } from '../predictive/predictive.service.js';
import { aiActionsAvailableForProject, proposeAction, listProjectProposals, AI_ACTION_TYPES } from '../aiActions/aiActions.service.js';
import { aiEnabled } from '../../lib/ai.js';
import { BadRequest } from '../../lib/errors.js';
import charterRoutes from '../charter/charter.routes.js';
import costRoutes from '../cost/cost.routes.js';
import riskRoutes from '../risk/risk.routes.js';
import issueRoutes from '../issue/issue.routes.js';
import stakeholderRoutes from '../stakeholder/stakeholder.routes.js';
import requirementRoutes from '../requirement/requirement.routes.js';
import procurementRoutes from '../procurement/procurement.routes.js';
import raidRoutes from '../raid/raid.routes.js';
import uatRoutes from '../uat/uat.routes.js';
import kickoffRoutes from '../kickoff/kickoff.routes.js';
import forecastRoutes from '../forecast/forecast.routes.js';
import reportRoutes from '../report/report.routes.js';
import scheduleRoutes from '../schedule/schedule.routes.js';
import exportRoutes from '../export/export.routes.js';
import attachmentRoutes from '../attachment/attachment.routes.js';
import auditRoutes from '../audit/audit.routes.js';
import projectNotificationRoutes from '../notification/notification.project.routes.js';
import agileRoutes from '../agile/agile.routes.js';
import timesheetRoutes from '../timesheet/timesheet.routes.js';
import closeoutRoutes from '../closeout/closeout.routes.js';
import evmRoutes from '../evm/evm.routes.js';

const router = Router();
router.use(requireAuth);

// List (scoped by role) & create.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projects = await svc.listProjects(req.user!.id, req.user!.role);
    res.json({ projects });
  }),
);

// ADMIN/PMO create corporate projects (assigning a PM). A GUEST may also create — but only a
// PERSONAL project owned by themselves (the service forces personalOwnerId = pmUserId = self).
router.post(
  '/',
  requireRole('ADMIN', 'PMO', 'GUEST'),
  validateBody(createProjectSchema),
  asyncHandler(async (req, res) => {
    const project = await svc.createProject(req.body, req.user!.id, req.user!.role);
    res.status(201).json({ project });
  }),
);

// ADMIN/PMO "Project Database": the full corporate project list (or the Archive), with optional
// status / year / PM filters. Registered before '/:id' so "admin" isn't read as a project id.
router.get(
  '/admin/database',
  requireRole('ADMIN', 'PMO'),
  asyncHandler(async (req, res) => {
    const q = req.query;
    const yearNum = q.year ? Number(q.year) : undefined;
    const projects = await svc.listProjectDatabase({
      archived: q.archived === 'true',
      status: typeof q.status === 'string' && q.status ? (q.status as any) : undefined,
      year: Number.isFinite(yearNum) ? yearNum : undefined,
      pmUserId: typeof q.pmUserId === 'string' && q.pmUserId ? q.pmUserId : undefined,
    });
    res.json({ projects });
  }),
);

// Single project (access-checked).
router.get(
  '/:id',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const project = await svc.getProject(req.params.id);
    res.json({ project });
  }),
);

// Closure readiness checklist (blockers + advisory warnings) — shown before closing.
router.get(
  '/:id/closure-readiness',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const readiness = await getClosureReadiness(req.params.id);
    res.json({ readiness });
  }),
);

// Activation readiness checklist (baseline blockers + advisory warnings) — shown before
// starting execution (CHARTERED → IN_PROGRESS).
router.get(
  '/:id/activation-readiness',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const readiness = await getActivationReadiness(req.params.id);
    res.json({ readiness });
  }),
);

// Rich activation-review summary (Scope / Budget / Schedule + readiness + review state) for
// the PMO decision card. Any project member may view it.
router.get(
  '/:id/activation-review',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const review = await getActivationReview(req.params.id);
    res.json({ review });
  }),
);

// PMO activation decision: APPROVE activates; REJECT / NEEDS_REVISION send the project back to
// the PM with a mandatory reason. ADMIN/PMO only (matches the activation gate).
const activationDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'NEEDS_REVISION']),
  reason: z.string().trim().max(1000).optional(),
  force: z.boolean().optional(),
});
router.post(
  '/:id/activation/decide',
  requireProjectAccess(),
  requireRole('ADMIN', 'PMO'),
  validateBody(activationDecisionSchema),
  asyncHandler(async (req, res) => {
    const project = await svc.decideActivation(req.params.id, req.body.decision, req.user!.id, { reason: req.body.reason, force: req.body.force });
    res.json({ project });
  }),
);

// PM (or ADMIN/PMO) resubmits a returned project for activation review.
router.post(
  '/:id/activation/resubmit',
  requireProjectAccess({ write: true }),
  asyncHandler(async (req, res) => {
    const project = await svc.resubmitActivation(req.params.id, req.user!.id);
    res.json({ project });
  }),
);

// Guided next-step cues — an ordered list of recommended actions for the project's
// current lifecycle stage (charter → baseline → activate → track → close).
router.get(
  '/:id/next-steps',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const nextSteps = await getNextSteps(req.params.id, req.user!.role);
    res.json({ nextSteps });
  }),
);

// Project-level details (identity, financials, methodology, status) are a
// portfolio/governance decision — ADMIN/PMO only. PMs manage execution via the
// charter (while draft) and Change Requests, not top-level project edits.
router.patch(
  '/:id',
  requireProjectGovernance('ADMIN', 'PMO'),
  validateBody(updateProjectSchema),
  asyncHandler(async (req, res) => {
    const project = await svc.updateProject(req.params.id, req.body, req.user!.id);
    // A closure may be routed for approval instead of applied — surface that to the client.
    const { approvalPending } = project as typeof project & { approvalPending?: boolean };
    res.json({ project, approvalPending: approvalPending ?? false });
  }),
);

// Lock / unlock the cost & schedule baseline (PMB/BAC freeze). The owning PM builds
// the cost breakdown, so the PM (plus ADMIN/PMO) may lock AND unlock it; unlocking
// requires a reason (audited). requireProjectAccess enforces ownership for a PM
// (ADMIN/PMO bypass as global roles) and blocks VIEWER / CLOSED projects. It does NOT
// check the lock state itself — that is enforced service-side on cost/schedule
// mutations (assertBaselineUnlocked) — so unlocking is not deadlocked here.
const baselineLockSchema = z.object({ locked: z.boolean(), reason: z.string().trim().max(500).optional() });
router.patch(
  '/:id/baseline-lock',
  requireProjectAccess({ write: true }),
  requireProjectGovernance('ADMIN', 'PMO', 'PROJECT_MANAGER'),
  validateBody(baselineLockSchema),
  asyncHandler(async (req, res) => {
    const { project, approvalPending } = await setBaselineLock(req.params.id, req.body.locked, req.body.reason, req.user!.id);
    // Locking a baseline may complete the set → tell ADMIN/PMO it's ready to activate (once). Skip
    // when the lock is only pending approval (it hasn't actually locked yet).
    if (req.body.locked && !approvalPending) await notifyActivationReady(req.params.id, req.user!.id);
    res.json({ project, approvalPending });
  }),
);

// Baseline revision history (schedule + cost snapshots captured at each lock). Read-only, any
// project member — mirrors the other project reads. List is a light summary; :version is the full
// snapshot (per-task schedule + cost) for the viewer / compare.
router.get(
  '/:id/baseline/versions',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const versions = await listBaselineVersions(req.params.id);
    res.json({ versions });
  }),
);
router.get(
  '/:id/baseline/versions/:version',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    const n = Number(req.params.version);
    if (!Number.isInteger(n) || n < 1) throw BadRequest('Invalid version');
    const version = await getBaselineVersion(req.params.id, n);
    res.json({ version });
  }),
);
// Restore/adopt a prior baseline revision (Fase 4) — ADMIN/PMO governance. Writes the snapshot back
// into the live baseline (Task.baseline* + CostBaseline) and appends a new "Restored from Bn"
// version. Single locked→locked op; audited (RESTORE_BASELINE). requireProjectAccess (no write:true
// so it isn't blocked by the baseline-locked freeze — restore is a governance action).
const restoreBaselineSchema = z.object({ reason: z.string().trim().max(500).optional() });
router.post(
  '/:id/baseline/versions/:version/restore',
  requireProjectAccess(),
  requireProjectGovernance('ADMIN', 'PMO'),
  validateBody(restoreBaselineSchema),
  asyncHandler(async (req, res) => {
    const n = Number(req.params.version);
    if (!Number.isInteger(n) || n < 1) throw BadRequest('Invalid version');
    const result = await restoreBaselineVersion(req.params.id, n, req.body.reason, req.user!.id);
    res.json(result);
  }),
);

// Reassign the project's PM — ADMIN/PMO only.
router.patch(
  '/:id/pm',
  requireRole('ADMIN', 'PMO'),
  validateBody(reassignPmSchema),
  asyncHandler(async (req, res) => {
    const project = await svc.reassignPm(req.params.id, req.body.pmUserId, req.user!.id);
    res.json({ project });
  }),
);

router.delete(
  '/:id',
  requireProjectGovernance('ADMIN', 'PMO'),
  requireProjectAccess({ write: true }),
  asyncHandler(async (req, res) => {
    await svc.softDeleteProject(req.params.id, req.user!.id);
    res.status(204).send();
  }),
);

// Archive (reversible hide) / restore — ADMIN/PMO governance only (NOT requireProjectAccess:
// archiving a CLOSED project is the main use case, and that write-guard freezes CLOSED projects).
router.post(
  '/:id/archive',
  requireProjectGovernance('ADMIN', 'PMO'),
  asyncHandler(async (req, res) => {
    const project = await svc.archiveProject(req.params.id, req.user!.id);
    res.json({ project });
  }),
);
router.post(
  '/:id/unarchive',
  requireProjectGovernance('ADMIN', 'PMO'),
  asyncHandler(async (req, res) => {
    const project = await svc.unarchiveProject(req.params.id, req.user!.id);
    res.json({ project });
  }),
);

// Nested module routes under a project.
// Lightweight AI-availability probe (env gate + per-tenant opt-in) — drives the client's show/hide
// of AI buttons without computing a full report. Any project member with access.
router.get(
  '/:projectId/ai-available',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    res.json({ aiAvailable: await aiAvailableForProject(req.params.projectId) });
  }),
);

// Stage A — extract structured updates (task progress + issues) from free-text notes. Advisory,
// ephemeral (returns a draft only; the client applies each item via the existing write endpoints).
// Write access (PM/PMO/ADMIN). Gated globally by ANTHROPIC_API_KEY (503) + per-tenant opt-in (403).
router.post(
  '/:projectId/data-extract/ai-draft',
  requireProjectAccess({ write: true }),
  validateBody(z.object({ text: z.string().min(1).max(20000) })),
  asyncHandler(async (req, res) => {
    if (!aiEnabled()) {
      res.status(503).json({ error: { code: 'AI_DISABLED', message: 'Fitur AI belum dikonfigurasi.' } });
      return;
    }
    res.json(await extractFromNotes(req.params.projectId, req.body.text));
  }),
);

// Predictive slip/overrun signals (deterministic EVM heuristic — always on, no AI key needed).
router.get(
  '/:projectId/predictive',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    res.json(await getProjectPredictive(req.params.projectId));
  }),
);

// Stage C — semi-autonomous AI actions. The AI drafts a whitelisted write; it is routed through the
// approval engine and only executes on human approval. STRONGER gate than the other AI features:
// env (503) + a SEPARATE per-tenant opt-in Tenant.aiActionsEnabled (403 in the service).
router.get(
  '/:projectId/ai-actions/available',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    res.json({ aiActionsAvailable: await aiActionsAvailableForProject(req.params.projectId) });
  }),
);

// Recent AI-action proposals for the project (any status) — a small history/status surface.
router.get(
  '/:projectId/ai-actions',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    res.json({ proposals: await listProjectProposals(req.params.projectId) });
  }),
);

// Stage a proposal (write access). The AI-drafted params arrive in the body; the service validates
// them against the per-action schema and routes the proposal for approval. Nothing is applied here.
router.post(
  '/:projectId/ai-actions/propose',
  requireProjectAccess({ write: true }),
  validateBody(z.object({
    actionType: z.enum(AI_ACTION_TYPES),
    params: z.unknown(),
    rationale: z.string().max(2000).optional(),
    confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  })),
  asyncHandler(async (req, res) => {
    const result = await proposeAction({
      projectId: req.params.projectId,
      actionType: req.body.actionType,
      params: req.body.params,
      rationale: req.body.rationale ?? null,
      confidence: req.body.confidence ?? null,
    }, req.user!.id);
    res.status(201).json(result);
  }),
);

router.use('/:projectId/charter', charterRoutes);
router.use('/:projectId/cost', costRoutes);
router.use('/:projectId/risk', riskRoutes);
router.use('/:projectId/issues', issueRoutes);
router.use('/:projectId/stakeholders', stakeholderRoutes);
router.use('/:projectId/requirements', requirementRoutes);
router.use('/:projectId/procurements', procurementRoutes);
router.use('/:projectId/raid', raidRoutes);
router.use('/:projectId/uat', uatRoutes);
router.use('/:projectId/kickoff', kickoffRoutes);
router.use('/:projectId/forecast', forecastRoutes);
router.use('/:projectId/report', reportRoutes);
router.use('/:projectId/schedule', scheduleRoutes);
router.use('/:projectId/export', exportRoutes);
router.use('/:projectId/attachments', attachmentRoutes);
router.use('/:projectId/audit', auditRoutes);
router.use('/:projectId/notifications', projectNotificationRoutes);
router.use('/:projectId/agile', agileRoutes);
router.use('/:projectId/timesheet', timesheetRoutes);
router.use('/:projectId/closeout', closeoutRoutes);
router.use('/:projectId/evm', evmRoutes);

export default router;
