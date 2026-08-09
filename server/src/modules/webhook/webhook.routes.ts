import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { Forbidden } from '../../lib/errors.js';
import * as service from './webhook.service.js';
import { WEBHOOK_EVENTS } from './webhook.service.js';

// Outbound webhook management (T3.3) for the ACTIVE tenant. Tenant ADMIN only; never an API key.
const router = Router();

function denyApiKeyAuth(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.isApiKey) return next(Forbidden('API keys cannot manage webhooks'));
  next();
}

router.use(requireAuth, denyApiKeyAuth, requireRole('ADMIN'));

const eventEnum = z.enum([...WEBHOOK_EVENTS, '*'] as [string, ...string[]]);
const createSchema = z.object({
  url: z.string().url().refine((u) => u.startsWith('https://'), 'URL must be https'),
  events: z.array(eventEnum).min(1),
});

// The event catalogue, so the UI can render the available choices without hardcoding them.
router.get('/events', asyncHandler(async (_req, res) => {
  res.json({ events: WEBHOOK_EVENTS });
}));

router.get('/', asyncHandler(async (_req, res) => {
  res.json({ subscriptions: await service.listSubscriptions() });
}));

router.post('/', validateBody(createSchema), asyncHandler(async (req, res) => {
  const created = await service.createSubscription(req.body, req.user!.id);
  res.status(201).json(created); // includes the signing `secret` — shown once
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await service.deleteSubscription(req.params.id, req.user!.id);
  res.json({ ok: true });
}));

// Recent delivery log (the retry queue doubles as the log).
router.get('/deliveries', asyncHandler(async (_req, res) => {
  res.json({ deliveries: await service.listDeliveries() });
}));

export default router;
