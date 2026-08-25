import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { prisma } from '../../lib/prisma.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { aiEnabled } from '../../lib/ai.js';
import { BadRequest } from '../../lib/errors.js';

// Per-tenant AI Status Narrative opt-in — self-serve for the tenant's own ADMIN (distinct from the
// deployment-global /settings, which is super-admin only). `configured` reflects the global env gate
// (ANTHROPIC_API_KEY); `enabled` is this workspace's Tenant.aiNarrativeEnabled opt-in.
const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

async function currentFlags(): Promise<{ enabled: boolean; actionsEnabled: boolean }> {
  const tid = getTenantStore()?.tenantId;
  if (!tid) return { enabled: false, actionsEnabled: false };
  const t = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiNarrativeEnabled: true, aiActionsEnabled: true } });
  return { enabled: t?.aiNarrativeEnabled ?? false, actionsEnabled: t?.aiActionsEnabled ?? false };
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ configured: aiEnabled(), ...(await currentFlags()) });
  }),
);

// `enabled` = narrative/advisory opt-in (aiNarrativeEnabled). `actionsEnabled` = Stage C AI-proposed
// actions opt-in (aiActionsEnabled) — a SEPARATE, stronger consent. Either may be sent.
router.patch(
  '/',
  validateBody(z.object({ enabled: z.boolean().optional(), actionsEnabled: z.boolean().optional() })
    .refine((b) => b.enabled !== undefined || b.actionsEnabled !== undefined, { message: 'Nothing to update' })),
  asyncHandler(async (req, res) => {
    const tid = getTenantStore()?.tenantId;
    if (!tid) throw BadRequest('No active workspace to configure.');
    await prisma.tenant.update({
      where: { id: tid },
      data: {
        ...(req.body.enabled !== undefined ? { aiNarrativeEnabled: req.body.enabled } : {}),
        ...(req.body.actionsEnabled !== undefined ? { aiActionsEnabled: req.body.actionsEnabled } : {}),
      },
    });
    res.json({ configured: aiEnabled(), ...(await currentFlags()) });
  }),
);

export default router;
