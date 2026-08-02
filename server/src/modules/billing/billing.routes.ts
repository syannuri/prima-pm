import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound, BadRequest, Conflict } from '../../lib/errors.js';
import { billingEnabled } from '../../config/env.js';
import { DEFAULT_TENANT_SLUG } from '../../lib/tenant/constants.js';
import { createCheckoutUrl, getPortalUrl } from './billing.service.js';

// Self-serve billing for the ACTIVE tenant. A tenant ADMIN starts a Lemon Squeezy checkout to buy
// PRO/ENTERPRISE and manages the subscription via the LS customer portal; any member can read the
// current plan/status. The webhook (mounted separately) is what actually flips Tenant.plan.
const router = Router();

const checkoutSchema = z.object({ plan: z.enum(['PRO', 'ENTERPRISE']) });

// The active tenant (from the token) or the default tenant on single-tenant deploys. Tenant is a
// global model, so no tenant context is needed to read it.
async function activeTenant(req: Request) {
  const id = req.user?.tid;
  const t = id
    ? await prisma.tenant.findUnique({ where: { id } })
    : await prisma.tenant.findUnique({ where: { slug: DEFAULT_TENANT_SLUG } });
  if (!t) throw NotFound('No active tenant');
  return t;
}

function assertBillingEnabled() {
  if (!billingEnabled()) throw new AppError(503, 'Billing is not configured on this deployment.', 'BILLING_UNCONFIGURED');
}

router.use(requireAuth);

// Current plan + subscription status for the active tenant (any member can read).
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const t = await activeTenant(req);
    res.json({
      plan: t.plan,
      subscriptionStatus: t.subscriptionStatus,
      renewsAt: t.renewsAt,
      endsAt: t.endsAt,
      hasSubscription: Boolean(t.lsSubscriptionId),
      billingEnabled: billingEnabled(),
    });
  }),
);

// Start a checkout for a paid plan → returns the LS hosted checkout URL for the client to redirect to.
router.post(
  '/checkout',
  requireRole('ADMIN'),
  validateBody(checkoutSchema),
  asyncHandler(async (req, res) => {
    assertBillingEnabled();
    const t = await activeTenant(req);
    if (t.isPersonal) throw BadRequest('Personal sandboxes cannot be upgraded.');
    const url = await createCheckoutUrl(req.body.plan, t.id, req.user!.email);
    res.json({ url });
  }),
);

// Get the LS customer-portal URL (update card / cancel) for the active subscription.
router.get(
  '/portal',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    assertBillingEnabled();
    const t = await activeTenant(req);
    if (!t.lsSubscriptionId) throw Conflict('No active subscription to manage.');
    const url = await getPortalUrl(t.lsSubscriptionId);
    res.json({ url });
  }),
);

export default router;
