import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { prisma } from '../../lib/prisma.js';
import { assertValidSlug } from '../../lib/tenant/slug.js';
import { DEFAULT_TENANT_SLUG } from '../../lib/tenant/constants.js';
import { NotFound, BadRequest } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';

// Tenant self-service workspace settings — a tenant ADMIN manages their own org's name + subdomain.
// Distinct from the platform console (super-admin, cross-tenant). Gated to the active tenant's ADMIN.
const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

async function activeTenantId(req: Request): Promise<string> {
  if (req.user?.tid) return req.user.tid;
  const t = await prisma.tenant.findUnique({ where: { slug: DEFAULT_TENANT_SLUG }, select: { id: true } });
  if (!t) throw NotFound('No active tenant');
  return t.id;
}

// GET /workspace — the active tenant's name + subdomain (+ custom domain / plan for display).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const id = await activeTenantId(req);
    const t = await prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true, slug: true, customDomain: true, plan: true, isPersonal: true } });
    if (!t) throw NotFound('Tenant not found');
    res.json({ tenant: t });
  }),
);

const patchSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    slug: z.string().min(2).max(40).optional(),
  })
  .refine((b) => b.name !== undefined || b.slug !== undefined, 'Provide a name and/or subdomain to update');

// PATCH /workspace — rename the org and/or change its subdomain. Changing the subdomain MOVES the
// workspace URL: the old <slug>.<base> stops resolving (the client redirects to the new address).
router.patch(
  '/',
  validateBody(patchSchema),
  asyncHandler(async (req, res) => {
    const id = await activeTenantId(req);
    const t = await prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true, slug: true, isPersonal: true } });
    if (!t) throw NotFound('Tenant not found');
    if (t.isPersonal) throw BadRequest('Personal sandboxes have no editable subdomain.');
    const data: { name?: string; slug?: string } = {};
    if (req.body.name !== undefined) data.name = String(req.body.name).trim();
    if (req.body.slug !== undefined) {
      if (t.slug === DEFAULT_TENANT_SLUG) throw BadRequest('The primary workspace subdomain cannot be changed here.');
      data.slug = await assertValidSlug(req.body.slug, t.id);
    }
    const updated = await prisma.tenant.update({ where: { id }, data, select: { id: true, name: true, slug: true, customDomain: true, plan: true } });
    await writeAudit({ userId: req.user!.id, entity: 'Tenant', entityId: id, action: 'UPDATE', before: { name: t.name, slug: t.slug }, after: { name: updated.name, slug: updated.slug, self: true } });
    res.json({ tenant: updated });
  }),
);

export default router;
