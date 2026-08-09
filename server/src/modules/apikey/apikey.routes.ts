import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { Forbidden } from '../../lib/errors.js';
import * as service from './apikey.service.js';

// Public REST API key management (T3.1) for the ACTIVE tenant. Tenant ADMIN only. Managed from a
// real session — never by an API key itself (keys are read-only, and this hardens it explicitly).
const router = Router();

// A key must not manage keys (privilege escalation guard) — belt-and-braces on top of read-only.
function denyApiKeyAuth(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.isApiKey) return next(Forbidden('API keys cannot manage API keys'));
  next();
}

router.use(requireAuth, denyApiKeyAuth, requireRole('ADMIN'));

// The role a key acts as within its tenant. Read-only for now, but the role still scopes what data
// the key can read. Default VIEWER (least privilege).
const roleEnum = z.enum(['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER']);
const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: roleEnum.default('VIEWER'),
  // Optional ISO expiry; must be in the future.
  expiresAt: z.string().datetime().optional().transform((s) => (s ? new Date(s) : undefined))
    .refine((d) => !d || d.getTime() > Date.now(), 'expiresAt must be in the future'),
});

router.get('/', asyncHandler(async (_req, res) => {
  res.json({ keys: await service.listApiKeys() });
}));

router.post('/', validateBody(createSchema), asyncHandler(async (req, res) => {
  const created = await service.createApiKey(req.body, req.user!.id);
  res.status(201).json(created); // includes the plaintext `key` — shown once
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await service.revokeApiKey(req.params.id, req.user!.id);
  res.json({ ok: true });
}));

export default router;
