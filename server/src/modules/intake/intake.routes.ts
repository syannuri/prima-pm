import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { upsertProposalSchema, scoreSchema, decisionSchema, convertSchema, weightsSchema, rankSchema } from './intake.schemas.js';
import * as svc from './intake.service.js';

// Project Intake & Portfolio Selection. Tenant-scoped (the Prisma extension scopes reads + stamps
// writes). Any member may read/submit ideas; ADMIN/PMO score, decide, convert, rank & set weights.
const router = Router();
router.use(requireAuth);

// Every corporate role is a "member"; GUEST (personal sandbox) is excluded from this corporate feature.
const member = requireRole('ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER');
const pmo = requireRole('ADMIN', 'PMO');
const listQuery = z.object({ status: z.string().optional(), includeArchived: z.coerce.boolean().optional() });

// ── Scoring weights (config) ──
router.get('/weights', member, asyncHandler(async (_req, res) => {
  res.json({ weights: await svc.getWeights() });
}));
router.put('/weights', pmo, validateBody(weightsSchema), asyncHandler(async (req, res) => {
  res.json({ weights: await svc.setWeights(req.body, req.user!.id) });
}));

// ── Ranking ──
router.post('/rank', pmo, validateBody(rankSchema), asyncHandler(async (req, res) => {
  await svc.setRank(req.body.order, req.user!.id);
  res.status(204).send();
}));

// ── List / read ──
router.get('/', member, asyncHandler(async (req, res) => {
  const { status, includeArchived } = listQuery.parse(req.query);
  const canArchive = req.user!.role === 'ADMIN' || req.user!.role === 'PMO';
  res.json({ proposals: await svc.listProposals({ status, includeArchived: canArchive && includeArchived }) });
}));
router.get('/:id', member, asyncHandler(async (req, res) => {
  res.json({ proposal: await svc.getProposal(req.params.id) });
}));

// ── Create / edit (requester or PMO — enforced in the service) ──
router.post('/', member, validateBody(upsertProposalSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ proposal: await svc.createProposal(req.body, req.user!.id) });
}));
router.put('/:id', member, validateBody(upsertProposalSchema), asyncHandler(async (req, res) => {
  res.json({ proposal: await svc.updateProposal(req.params.id, req.body, req.user!.id, req.user!.role) });
}));
router.post('/:id/submit', member, asyncHandler(async (req, res) => {
  res.json({ proposal: await svc.submitProposal(req.params.id, req.user!.id, req.user!.role) });
}));
router.delete('/:id', member, asyncHandler(async (req, res) => {
  await svc.deleteProposal(req.params.id, req.user!.id, req.user!.role);
  res.status(204).send();
}));

// ── PMO governance ──
router.post('/:id/score', pmo, validateBody(scoreSchema), asyncHandler(async (req, res) => {
  res.json({ proposal: await svc.scoreProposal(req.params.id, req.body, req.user!.id) });
}));
router.post('/:id/decision', pmo, validateBody(decisionSchema), asyncHandler(async (req, res) => {
  res.json({ proposal: await svc.decideProposal(req.params.id, req.body, req.user!.id) });
}));
router.post('/:id/convert', pmo, validateBody(convertSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.convertProposal(req.params.id, req.body.pmUserId ?? null, req.user!.id, req.user!.role));
}));
router.post('/:id/archive', pmo, asyncHandler(async (req, res) => {
  res.json({ proposal: await svc.archiveProposal(req.params.id, req.body?.archived !== false, req.user!.id) });
}));

export default router;
