import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { prisma } from '../../lib/prisma.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { aiEnabled } from '../../lib/ai.js';
import { BadRequest } from '../../lib/errors.js';
import { getActionEffectiveness, listRecentOutcomes } from '../aiActions/aiActionOutcomes.service.js';

// Per-tenant AI Status Narrative opt-in — self-serve for the tenant's own ADMIN (distinct from the
// deployment-global /settings, which is super-admin only). `configured` reflects the global env gate
// (ANTHROPIC_API_KEY); `enabled` is this workspace's Tenant.aiNarrativeEnabled opt-in.
const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

async function currentFlags(): Promise<{ enabled: boolean; actionsEnabled: boolean; proactiveEnabled: boolean; memoryEnabled: boolean; voiceEnabled: boolean }> {
  const tid = getTenantStore()?.tenantId;
  if (!tid) return { enabled: false, actionsEnabled: false, proactiveEnabled: false, memoryEnabled: false, voiceEnabled: false };
  const t = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiNarrativeEnabled: true, aiActionsEnabled: true, aiProactiveEnabled: true, aiMemoryEnabled: true, aiVoiceEnabled: true } });
  return { enabled: t?.aiNarrativeEnabled ?? false, actionsEnabled: t?.aiActionsEnabled ?? false, proactiveEnabled: t?.aiProactiveEnabled ?? false, memoryEnabled: t?.aiMemoryEnabled ?? false, voiceEnabled: t?.aiVoiceEnabled ?? false };
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
  validateBody(z.object({ enabled: z.boolean().optional(), actionsEnabled: z.boolean().optional(), proactiveEnabled: z.boolean().optional(), memoryEnabled: z.boolean().optional(), voiceEnabled: z.boolean().optional() })
    .refine((b) => b.enabled !== undefined || b.actionsEnabled !== undefined || b.proactiveEnabled !== undefined || b.memoryEnabled !== undefined || b.voiceEnabled !== undefined, { message: 'Nothing to update' })),
  asyncHandler(async (req, res) => {
    const tid = getTenantStore()?.tenantId;
    if (!tid) throw BadRequest('No active workspace to configure.');
    await prisma.tenant.update({
      where: { id: tid },
      data: {
        ...(req.body.enabled !== undefined ? { aiNarrativeEnabled: req.body.enabled } : {}),
        ...(req.body.actionsEnabled !== undefined ? { aiActionsEnabled: req.body.actionsEnabled } : {}),
        ...(req.body.proactiveEnabled !== undefined ? { aiProactiveEnabled: req.body.proactiveEnabled } : {}),
        ...(req.body.memoryEnabled !== undefined ? { aiMemoryEnabled: req.body.memoryEnabled } : {}),
        ...(req.body.voiceEnabled !== undefined ? { aiVoiceEnabled: req.body.voiceEnabled } : {}),
      },
    });
    res.json({ configured: aiEnabled(), ...(await currentFlags()) });
  }),
);

// Outcome learning — workspace-wide track record for the Settings → Governance "AI action outcomes"
// card. Tenant-scoped (auto via the Prisma extension). Correlational, not causal.
router.get(
  '/action-outcomes',
  asyncHandler(async (_req, res) => {
    res.json({ stats: await getActionEffectiveness() });
  }),
);

router.get(
  '/action-outcomes/recent',
  asyncHandler(async (req, res) => {
    const take = Math.min(Math.max(Number(req.query.take) || 20, 1), 100);
    res.json({ outcomes: await listRecentOutcomes({ take }) });
  }),
);

export default router;
