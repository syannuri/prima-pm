import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireProjectAccess } from '../../middleware/rbac.js';
import { getPendingBriefing, listMyBriefings, resolveBriefing } from './proactive.service.js';

// Per-project briefing router — mounted at /projects/:projectId/ai-briefing. Drives the Reports
// banner (latest PENDING) and the apply/dismiss review actions.
export const projectBriefingRoutes = Router({ mergeParams: true });

// Latest PENDING briefing for this project (or null). Read access = any project member.
projectBriefingRoutes.get(
  '/',
  requireProjectAccess(),
  asyncHandler(async (req, res) => {
    res.json(await getPendingBriefing(req.params.projectId));
  }),
);

// Mark the briefing APPLIED (the PM has saved the commentary from the draft). Write access.
projectBriefingRoutes.post(
  '/:briefingId/apply',
  requireProjectAccess({ write: true }),
  asyncHandler(async (req, res) => {
    const reviewer = { id: req.user!.id, name: req.user!.email };
    res.json(await resolveBriefing(req.params.projectId, req.params.briefingId, 'APPLIED', reviewer));
  }),
);

// Dismiss the briefing (the PM does not want it). Write access.
projectBriefingRoutes.post(
  '/:briefingId/dismiss',
  requireProjectAccess({ write: true }),
  asyncHandler(async (req, res) => {
    const reviewer = { id: req.user!.id, name: req.user!.email };
    res.json(await resolveBriefing(req.params.projectId, req.params.briefingId, 'DISMISSED', reviewer));
  }),
);

// Portfolio inbox router — mounted at /ai-briefings. The caller's PENDING briefings across the
// projects they can access.
export const briefingInboxRoutes = Router();
briefingInboxRoutes.use(requireAuth);
briefingInboxRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ briefings: await listMyBriefings(req.user!.id, req.user!.role) });
  }),
);
