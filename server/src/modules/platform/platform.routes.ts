import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { writeAudit } from '../../lib/audit.js';
import { Unauthorized, Forbidden, Conflict, BadRequest, NotFound } from '../../lib/errors.js';
import { strongPassword } from '../auth/auth.schemas.js';
import { DEFAULT_TENANT_SLUG } from '../../lib/tenant/constants.js';

// Platform (super-admin) console — tenant provisioning & lifecycle (Phase 5). Operates ACROSS tenants
// on the GLOBAL models (Tenant / User / Membership), so nothing here is tenant-scoped; the security
// boundary is the platform-admin gate. Corporate tenants only — personal (guest) sandboxes are
// created by guest signup and are not managed here.
const router = Router();
router.use(requireAuth);

// Global platform privilege, resolved FRESH from the DB (never trusted from the token) — like the
// per-tenant role. A revoked flag takes effect immediately.
async function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw Unauthorized();
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { isPlatformAdmin: true } });
    if (!u?.isPlatformAdmin) throw Forbidden('Platform administrators only');
    next();
  } catch (e) {
    next(e);
  }
}
router.use(requirePlatformAdmin);

const slugRule = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Slug must be lowercase letters, digits and single hyphens');

const createTenantSchema = z.object({
  name: z.string().min(2).max(120),
  slug: slugRule,
  adminEmail: z.string().email().toLowerCase(),
  adminName: z.string().min(1).max(120).optional(),
  adminPassword: strongPassword.optional(),
});

// GET /admin/tenants — every tenant with its member count.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const tenants = await prisma.tenant.findMany({
      orderBy: [{ isPersonal: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, name: true, slug: true, status: true, isPersonal: true, createdAt: true,
        _count: { select: { memberships: true } },
      },
    });
    res.json({
      tenants: tenants.map((t) => ({
        id: t.id, name: t.name, slug: t.slug, status: t.status, isPersonal: t.isPersonal,
        createdAt: t.createdAt, memberCount: t._count.memberships,
      })),
    });
  }),
);

// POST /admin/tenants — create a CORPORATE tenant + its first ADMIN. Attaches an existing STAFF user
// by email; if none exists, creates one (adminName + adminPassword required in that case).
router.post(
  '/',
  validateBody(createTenantSchema),
  asyncHandler(async (req, res) => {
    const { name, slug, adminEmail, adminName, adminPassword } = req.body as z.infer<typeof createTenantSchema>;
    if (await prisma.tenant.findUnique({ where: { slug }, select: { id: true } })) {
      throw Conflict(`A tenant with slug "${slug}" already exists`);
    }

    let admin = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true, isGuest: true } });
    if (admin?.isGuest) throw BadRequest('That email belongs to a guest account — pick a staff email.');
    if (!admin) {
      if (!adminName || !adminPassword) throw BadRequest('adminName and adminPassword are required to create a new admin user.');
      admin = await prisma.user.create({
        data: { name: adminName, email: adminEmail, role: 'ADMIN', isGuest: false, passwordHash: await hashPassword(adminPassword) },
        select: { id: true, isGuest: true },
      });
    }

    const tenant = await prisma.tenant.create({ data: { name, slug, isPersonal: false, status: 'ACTIVE' } });
    await prisma.membership.create({ data: { userId: admin.id, tenantId: tenant.id, role: 'ADMIN' } });
    await writeAudit({ userId: req.user!.id, entity: 'Tenant', entityId: tenant.id, action: 'CREATE', after: { name, slug, adminEmail } });
    res.status(201).json({ tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status } });
  }),
);

const patchSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    name: z.string().min(2).max(120).optional(),
  })
  .refine((b) => b.status !== undefined || b.name !== undefined, 'Provide a status and/or name to update');

// PATCH /admin/tenants/:id — suspend/reactivate or rename. The DEFAULT tenant can't be suspended (it
// owns all pre-existing data + the platform admins); personal (guest) tenants aren't managed here.
router.patch(
  '/:id',
  validateBody(patchSchema),
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, slug: true, status: true, isPersonal: true },
    });
    if (!tenant) throw NotFound('Tenant not found');
    if (tenant.isPersonal) throw BadRequest('Personal (guest) tenants are not managed here.');
    if (req.body.status === 'SUSPENDED' && tenant.slug === DEFAULT_TENANT_SLUG) {
      throw BadRequest('The default tenant cannot be suspended.');
    }
    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { ...(req.body.status ? { status: req.body.status } : {}), ...(req.body.name ? { name: req.body.name } : {}) },
    });
    await writeAudit({
      userId: req.user!.id, entity: 'Tenant', entityId: tenant.id, action: 'UPDATE',
      before: { status: tenant.status, name: tenant.name }, after: { status: updated.status, name: updated.name },
    });
    res.json({ tenant: { id: updated.id, name: updated.name, slug: updated.slug, status: updated.status } });
  }),
);

export default router;
