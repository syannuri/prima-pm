import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePlatformAdmin } from '../../middleware/platformAdmin.js';
import { prisma } from '../../lib/prisma.js';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { writeAudit } from '../../lib/audit.js';
import { runAsSystem } from '../../lib/tenant/context.js';
import { UPLOAD_DIR } from '../attachment/attachment.service.js';
import { Unauthorized, Forbidden, Conflict, BadRequest, NotFound } from '../../lib/errors.js';
import { strongPassword } from '../auth/auth.schemas.js';
import { DEFAULT_TENANT_SLUG } from '../../lib/tenant/constants.js';

// Platform (super-admin) console — tenant provisioning & lifecycle (Phase 5). Operates ACROSS tenants
// on the GLOBAL models (Tenant / User / Membership), so nothing here is tenant-scoped; the security
// boundary is the platform-admin gate. Corporate tenants only — personal (guest) sandboxes are
// created by guest signup and are not managed here.
const router = Router();
router.use(requireAuth);
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

// POST /admin/tenants/:id/impersonate — mint a short-lived access token that lets the platform admin
// ACT INSIDE this tenant as ADMIN (to support/debug), without being a member. No refresh token, so it
// self-expires (impersonation ends); requireAuth re-verifies platform-admin on every request. Audited
// against the real platform admin. Corporate tenants only.
router.post(
  '/:id/impersonate',
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, slug: true, isPersonal: true } });
    if (!tenant) throw NotFound('Tenant not found');
    if (tenant.isPersonal) throw BadRequest('Personal (guest) tenants cannot be impersonated.');
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { email: true, tokenVersion: true } });
    const accessToken = signAccessToken({ sub: req.user!.id, role: 'ADMIN', email: me.email, tv: me.tokenVersion, tid: tenant.id, imp: true });
    await writeAudit({ userId: req.user!.id, entity: 'Tenant', entityId: tenant.id, action: 'IMPERSONATE', after: { tenant: tenant.slug } });
    res.json({ accessToken, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } });
  }),
);

// GET /admin/tenants/:id/export — GDPR data portability: download a tenant's business data as one
// JSON bundle (tenant + members + projects with every child + resources + rate cards). Read-only;
// runs as system to reach across the caller's tenant scope. Attachment *metadata* is included (the
// binary files aren't — they live under uploads/<tenantId>/ and are backed up separately).
router.get(
  '/:id/export',
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, slug: true, status: true, isPersonal: true, createdAt: true },
    });
    if (!tenant) throw NotFound('Tenant not found');

    const bundle = await runAsSystem(async () => {
      const tenantId = tenant.id;
      const [members, projects, resources, rateCards] = await Promise.all([
        prisma.membership.findMany({
          where: { tenantId },
          select: { role: true, createdAt: true, user: { select: { id: true, name: true, email: true, isGuest: true } } },
        }),
        prisma.project.findMany({
          where: { tenantId },
          include: {
            charter: true, charterVersions: true, directCosts: true, indirectCosts: true, risks: true,
            issues: true, tasks: true, costBaseline: true, changeRequests: true, attachments: true,
            actualCosts: true, sprints: true, backlogItems: true, mandayEntries: true, lessons: true,
            acceptances: true, stakeholders: true, procurements: true, assumptions: true, dependencies: true,
            evmSnapshots: true, uatTestCases: true, kickoffMeeting: true, requirements: true,
          },
        }),
        prisma.resource.findMany({ where: { tenantId } }),
        prisma.rateCard.findMany({ where: { tenantId } }),
      ]);
      return { members, projects, resources, rateCards };
    });

    await writeAudit({ userId: req.user!.id, entity: 'Tenant', entityId: tenant.id, action: 'EXPORT', after: { slug: tenant.slug, projects: bundle.projects.length } });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tenant-${tenant.slug}-export.json"`);
    res.send(JSON.stringify({ exportedAt: new Date().toISOString(), tenant, ...bundle }, null, 2));
  }),
);

// DELETE /admin/tenants/:id — HARD-DELETE a corporate tenant and ALL its data (GDPR / offboarding).
// IRREVERSIBLE. Guards: never the default tenant; not a personal (guest) tenant (those go via user
// delete); the body must echo the tenant's slug (type-to-confirm). Deletes every tenant-scoped row
// (as system, bypassing the caller's tenant scope) then the tenant, and removes its upload files.
// User accounts stay (global identity — a person may belong to other tenants); only memberships go.
const deleteTenantSchema = z.object({ confirmSlug: z.string() });
router.delete(
  '/:id',
  validateBody(deleteTenantSchema),
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, slug: true, isPersonal: true } });
    if (!tenant) throw NotFound('Tenant not found');
    if (tenant.slug === DEFAULT_TENANT_SLUG) throw BadRequest('The default tenant cannot be deleted.');
    if (tenant.isPersonal) throw BadRequest('Personal (guest) tenants are deleted via the user account.');
    if (req.body.confirmSlug !== tenant.slug) throw BadRequest(`Type the tenant slug "${tenant.slug}" to confirm deletion.`);

    const tenantId = tenant.id;
    await runAsSystem(() => prisma.$transaction(async (tx) => {
      // Messaging (leaf → root), then attachments (Project delete SET-NULLs but doesn't remove them).
      await tx.messageReaction.deleteMany({ where: { tenantId } });
      await tx.message.deleteMany({ where: { tenantId } });
      await tx.conversationMember.deleteMany({ where: { tenantId } });
      await tx.conversation.deleteMany({ where: { tenantId } });
      await tx.pushSubscription.deleteMany({ where: { tenantId } });
      await tx.attachment.deleteMany({ where: { tenantId } });
      // Projects cascade all their children (charter/cost/risk/task/CR/…) via onDelete: Cascade.
      await tx.project.deleteMany({ where: { tenantId } });
      // Standalone roots (Resource before RateCard: Resource.rateCardId → RateCard).
      await tx.resource.deleteMany({ where: { tenantId } });
      await tx.rateCard.deleteMany({ where: { tenantId } });
      await tx.notification.deleteMany({ where: { tenantId } });
      await tx.projectBookmark.deleteMany({ where: { tenantId } });
      await tx.auditLog.deleteMany({ where: { tenantId } });
      await tx.appSetting.deleteMany({ where: { tenantId } });
      await tx.membership.deleteMany({ where: { tenantId } });
      await tx.tenant.delete({ where: { id: tenantId } });
    }));
    // Remove the tenant's uploaded files (best-effort).
    try { fs.rmSync(path.join(UPLOAD_DIR, tenantId), { recursive: true, force: true }); } catch { /* */ }
    await writeAudit({ userId: req.user!.id, entity: 'Tenant', entityId: tenantId, action: 'DELETE', before: { name: tenant.name, slug: tenant.slug } });
    res.status(204).send();
  }),
);

export default router;
