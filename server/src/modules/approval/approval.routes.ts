import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { Forbidden } from '../../lib/errors.js';
import * as service from './approval.service.js';

const roleEnum = z.enum(['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER']);
const magnitudeEnum = z.enum(['MINOR', 'MAJOR']);

const approverSchema = z.object({
  kind: z.enum(['ROLE', 'USER', 'PROJECT_PM']),
  role: roleEnum.optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
}).refine((a) => a.kind !== 'ROLE' || !!a.role, 'A ROLE approver needs a role')
  .refine((a) => a.kind !== 'USER' || !!a.userId, 'A USER approver needs a user');

const stepSchema = z.object({
  name: z.string().trim().min(1).max(80),
  mode: z.enum(['ANY', 'ALL']).default('ANY'),
  approvers: z.array(approverSchema).min(1, 'Each step needs at least one approver'),
});

const workflowSchema = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  condMagnitude: magnitudeEnum.optional().nullable(),
  condChargeable: z.boolean().optional().nullable(),
  condMinAmountIdr: z.number().nonnegative().optional().nullable(),
  steps: z.array(stepSchema).min(1, 'A workflow needs at least one step'),
});

// ---------------------------------------------------------------------------
// Admin: manage approval workflows. Tenant ADMIN only; never an API key.
// ---------------------------------------------------------------------------
export const workflowRouter = Router();

function denyApiKeyAuth(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.isApiKey) return next(Forbidden('API keys cannot manage approval workflows'));
  next();
}

workflowRouter.use(requireAuth, denyApiKeyAuth, requireRole('ADMIN'));

workflowRouter.get('/', asyncHandler(async (_req, res) => {
  res.json({ workflows: await service.listWorkflows() });
}));

workflowRouter.post('/', validateBody(workflowSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ workflow: await service.createWorkflow(req.body, req.user!.id) });
}));

workflowRouter.patch('/:id', validateBody(workflowSchema), asyncHandler(async (req, res) => {
  res.json({ workflow: await service.updateWorkflow(req.params.id, req.body, req.user!.id) });
}));

workflowRouter.delete('/:id', asyncHandler(async (req, res) => {
  res.json(await service.deleteWorkflow(req.params.id, req.user!.id));
}));

// ---------------------------------------------------------------------------
// Approver inbox: any signed-in user acts on approvals routed to them.
// ---------------------------------------------------------------------------
export const inboxRouter = Router();

const decideSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(500).optional().nullable(),
});

inboxRouter.use(requireAuth, denyApiKeyAuth);

inboxRouter.get('/mine', asyncHandler(async (req, res) => {
  res.json({ approvals: await service.listMyApprovals(req.user!.id) });
}));

inboxRouter.get('/mine/count', asyncHandler(async (req, res) => {
  res.json({ count: await service.countMyApprovals(req.user!.id) });
}));

inboxRouter.post('/:id/decide', validateBody(decideSchema), asyncHandler(async (req, res) => {
  res.json(await service.decideApproval(req.params.id, req.user!.id, req.body.decision, req.body.comment));
}));
