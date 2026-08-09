import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { Forbidden } from '../../lib/errors.js';
import * as service from './automation.service.js';
import { WEBHOOK_EVENTS } from '../webhook/webhook.service.js';

// No-code automation rules for the ACTIVE tenant. Tenant ADMIN only; never an API key.
const router = Router();

function denyApiKeyAuth(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.isApiKey) return next(Forbidden('API keys cannot manage automations'));
  next();
}

router.use(requireAuth, denyApiKeyAuth, requireRole('ADMIN'));

const roleEnum = z.enum(['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER']);
const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  event: z.enum([...WEBHOOK_EVENTS] as [string, ...string[]]),
  conditionField: z.string().trim().max(60).optional().nullable(),
  conditionEquals: z.string().trim().max(200).optional().nullable(),
  notifyPm: z.boolean().default(false),
  notifyRole: roleEnum.optional().nullable(),
  messageTemplate: z.string().trim().max(200).optional().nullable(),
}).refine((r) => r.notifyPm || r.notifyRole, 'Pick at least one recipient (PM or a role).');

router.get('/events', asyncHandler(async (_req, res) => {
  res.json({ events: WEBHOOK_EVENTS });
}));

router.get('/', asyncHandler(async (_req, res) => {
  res.json({ rules: await service.listRules() });
}));

router.post('/', validateBody(createSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await service.createRule(req.body, req.user!.id));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await service.deleteRule(req.params.id, req.user!.id);
  res.json({ ok: true });
}));

export default router;
