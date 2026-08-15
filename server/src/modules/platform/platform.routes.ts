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
import { assertValidSlug } from '../../lib/tenant/slug.js';
import { UPLOAD_DIR } from '../attachment/attachment.service.js';
import { Unauthorized, Forbidden, Conflict, BadRequest, NotFound } from '../../lib/errors.js';
import { strongPassword } from '../auth/auth.schemas.js';
import { DEFAULT_TENANT_SLUG } from '../../lib/tenant/constants.js';
import { blockIdentity, listBlocked, unblock } from '../auth/denylist.service.js';

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
        id: true, name: true, slug: true, status: true, plan: true, customDomain: true, isPersonal: true, createdAt: true, updatedAt: true,
        _count: { select: { memberships: true } },
      },
    });
    // Per-tenant active-project count and attachment storage, for the console's quota bars. Project
    // and Attachment are tenant-scoped by the Prisma extension, so aggregate under runAsSystem to see
    // across all tenants; then index by tenantId.
    const [projGroups, storageGroups] = await runAsSystem(() => Promise.all([
      prisma.project.groupBy({ by: ['tenantId'], where: { deletedAt: null }, _count: { _all: true } }),
      prisma.attachment.groupBy({ by: ['tenantId'], _sum: { sizeBytes: true } }),
    ]));
    const projByTenant = new Map(projGroups.map((g) => [g.tenantId, g._count._all]));
    const bytesByTenant = new Map(storageGroups.map((g) => [g.tenantId, g._sum.sizeBytes ?? 0]));
    res.json({
      tenants: tenants.map((t) => ({
        id: t.id, name: t.name, slug: t.slug, status: t.status, plan: t.plan, customDomain: t.customDomain, isPersonal: t.isPersonal,
        createdAt: t.createdAt, updatedAt: t.updatedAt, memberCount: t._count.memberships,
        projectCount: projByTenant.get(t.id) ?? 0,
        storageBytes: bytesByTenant.get(t.id) ?? 0,
      })),
    });
  }),
);

// GET /admin/tenants/activity — recent cross-tenant platform events (tenant lifecycle, guest mgmt,
// denylist) from the audit log, for the console's activity feed. Read under runAsSystem so events
// stamped with any admin's tenant are all visible; the client formats the human sentence.
router.get(
  '/activity',
  asyncHandler(async (_req, res) => {
    // Entity 'User' is shared with auth (LOGIN/LOGOUT) — restrict to guest-management writes only, so
    // the feed shows platform actions, not sign-ins. Over-fetch, then post-filter guest events by their
    // audit flag (after.guestMgmt / before.guest) and cap at 30.
    const rows = await runAsSystem(() =>
      prisma.auditLog.findMany({
        where: {
          OR: [
            { entity: 'Tenant' },
            { entity: 'BlockedIdentity' },
            { entity: 'User', action: { in: ['UPDATE', 'DELETE'] } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 60,
        select: { id: true, createdAt: true, action: true, entity: true, entityId: true, before: true, after: true, user: { select: { name: true, email: true } } },
      }),
    );
    const isGuestEvent = (o: unknown, k: string): boolean => !!(o && typeof o === 'object' && (o as Record<string, unknown>)[k]);
    const events = rows
      .filter((e) => e.entity !== 'User' || isGuestEvent(e.after, 'guestMgmt') || isGuestEvent(e.before, 'guest'))
      .slice(0, 30);
    // Resolve live tenant names for Tenant-entity events (deleted tenants fall back to before/after).
    const tenantIds = [...new Set(events.filter((e) => e.entity === 'Tenant').map((e) => e.entityId))];
    const names = tenantIds.length
      ? await runAsSystem(() => prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }))
      : [];
    const nameById = new Map(names.map((t) => [t.id, t.name]));
    const pick = (o: unknown, k: string): string | undefined => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] as string : undefined);
    res.json({
      activity: events.map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        action: e.action,
        entity: e.entity,
        actorName: e.user?.name ?? e.user?.email ?? null,
        targetName:
          e.entity === 'Tenant' ? (nameById.get(e.entityId) ?? pick(e.before, 'name') ?? pick(e.after, 'name') ?? pick(e.after, 'slug') ?? null)
          : pick(e.after, 'email') ?? pick(e.before, 'email') ?? null,
        before: e.before,
        after: e.after,
      })),
    });
  }),
);

// GET /admin/tenants/geo — free-vs-subscriber segmentation by country (from User.country, captured
// from Cloudflare CF-IPCountry). Users: subscriber = member of an ACTIVE paid tenant, else free.
// Tenants: grouped by the owner's (earliest ADMIN's) country, FREE vs paid. All under runAsSystem.
const PAID_PLANS = new Set(['PRO', 'ENTERPRISE']);
router.get(
  '/geo',
  asyncHandler(async (_req, res) => {
    const [memberships, users, corpTenants, adminMemberships] = await runAsSystem(() => Promise.all([
      prisma.membership.findMany({ select: { userId: true, tenant: { select: { plan: true, status: true, isPersonal: true } } } }),
      prisma.user.findMany({ where: { country: { not: null } }, select: { id: true, country: true } }),
      prisma.tenant.findMany({ where: { isPersonal: false }, select: { id: true, plan: true } }),
      prisma.membership.findMany({ where: { role: 'ADMIN', tenant: { isPersonal: false } }, orderBy: { createdAt: 'asc' }, select: { tenantId: true, user: { select: { country: true } } } }),
    ]));
    // Users who belong to at least one ACTIVE paid tenant are "subscribers".
    const subscriberUsers = new Set<string>();
    for (const m of memberships) if (!m.tenant.isPersonal && m.tenant.status === 'ACTIVE' && PAID_PLANS.has(m.tenant.plan)) subscriberUsers.add(m.userId);
    // Each corporate tenant's country = its earliest ADMIN (owner) country.
    const tenantCountry = new Map<string, string>();
    for (const m of adminMemberships) if (m.user.country && !tenantCountry.has(m.tenantId)) tenantCountry.set(m.tenantId, m.user.country);

    type Row = { country: string; freeUsers: number; subscriberUsers: number; freeTenants: number; paidTenants: number };
    const rows = new Map<string, Row>();
    const row = (c: string): Row => { let r = rows.get(c); if (!r) { r = { country: c, freeUsers: 0, subscriberUsers: 0, freeTenants: 0, paidTenants: 0 }; rows.set(c, r); } return r; };
    for (const u of users) { if (!u.country) continue; const r = row(u.country); if (subscriberUsers.has(u.id)) r.subscriberUsers++; else r.freeUsers++; }
    for (const t of corpTenants) { const c = tenantCountry.get(t.id); if (!c) continue; const r = row(c); if (PAID_PLANS.has(t.plan)) r.paidTenants++; else r.freeTenants++; }
    const byCountry = [...rows.values()].sort((a, b) => (b.freeUsers + b.subscriberUsers) - (a.freeUsers + a.subscriberUsers));
    res.json({ byCountry });
  }),
);

// GET /admin/tenants/:id/detail — a tenant's member roster + recent projects, for the drill-down.
router.get(
  '/:id/detail',
  asyncHandler(async (req, res) => {
    const tenantId = req.params.id;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw NotFound('Tenant not found');
    // Membership is a GLOBAL model (not auto-scoped) → filter by tenantId directly.
    const members = await prisma.membership.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, user: { select: { id: true, name: true, email: true } } },
    });
    // Project is tenant-scoped by the extension → read this tenant's rows under runAsSystem.
    const projects = await runAsSystem(() =>
      prisma.project.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 8,
        select: { id: true, name: true, status: true, updatedAt: true },
      }),
    );
    res.json({
      members: members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, role: m.role })),
      projects,
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

// A fully-qualified hostname (lowercased), e.g. pm.acmecorp.com. Empty string clears the custom domain.
const hostnameRule = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine((v) => v === '' || /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(v), 'Enter a valid domain, e.g. pm.acmecorp.com (or blank to clear)');

const patchSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    name: z.string().min(2).max(120).optional(),
    slug: z.string().min(2).max(40).optional(),
    plan: z.enum(['FREE', 'PRO', 'ENTERPRISE']).optional(),
    customDomain: hostnameRule.optional(),
    // AI Status Narrative per-tenant opt-in (the self-serve tenant-ADMIN toggle lands in Phase 2).
    aiNarrativeEnabled: z.boolean().optional(),
  })
  .refine(
    (b) => b.status !== undefined || b.name !== undefined || b.slug !== undefined || b.plan !== undefined || b.customDomain !== undefined || b.aiNarrativeEnabled !== undefined,
    'Provide a status, name, slug, plan, custom domain and/or AI narrative flag to update',
  );

// PATCH /admin/tenants/:id — suspend/reactivate, rename, change the SaaS plan, or set/clear the custom
// domain. The DEFAULT tenant can't be suspended (it owns all pre-existing data + the platform admins);
// personal (guest) tenants aren't managed here.
router.patch(
  '/:id',
  validateBody(patchSchema),
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, slug: true, status: true, plan: true, customDomain: true, isPersonal: true },
    });
    if (!tenant) throw NotFound('Tenant not found');
    if (tenant.isPersonal) throw BadRequest('Personal (guest) tenants are not managed here.');
    if (req.body.status === 'SUSPENDED' && tenant.slug === DEFAULT_TENANT_SLUG) {
      throw BadRequest('The default tenant cannot be suspended.');
    }
    // Empty string clears the custom domain (→ null); a value must be unique across tenants.
    let customDomainData: { customDomain?: string | null } = {};
    if (req.body.customDomain !== undefined) {
      const cd = req.body.customDomain === '' ? null : req.body.customDomain;
      if (cd) {
        const clash = await prisma.tenant.findFirst({ where: { customDomain: cd, id: { not: tenant.id } }, select: { id: true } });
        if (clash) throw Conflict(`The domain "${cd}" is already mapped to another tenant.`);
      }
      customDomainData = { customDomain: cd };
    }
    // Change the subdomain (slug) — validated (format / reserved / unique). The default tenant's
    // slug is locked so the primary host can't be moved out from under everyone.
    let slugData: { slug?: string } = {};
    if (req.body.slug !== undefined && req.body.slug !== tenant.slug) {
      if (tenant.slug === DEFAULT_TENANT_SLUG) throw BadRequest('The default tenant subdomain cannot be changed.');
      slugData = { slug: await assertValidSlug(req.body.slug, tenant.id) };
    }
    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        ...(req.body.status ? { status: req.body.status } : {}),
        ...(req.body.name ? { name: req.body.name } : {}),
        ...(req.body.plan ? { plan: req.body.plan } : {}),
        ...(req.body.aiNarrativeEnabled !== undefined ? { aiNarrativeEnabled: req.body.aiNarrativeEnabled } : {}),
        ...customDomainData,
        ...slugData,
      },
    });
    await writeAudit({
      userId: req.user!.id, entity: 'Tenant', entityId: tenant.id, action: 'UPDATE',
      before: { status: tenant.status, name: tenant.name, slug: tenant.slug, plan: tenant.plan, customDomain: tenant.customDomain },
      after: { status: updated.status, name: updated.name, slug: updated.slug, plan: updated.plan, customDomain: updated.customDomain },
    });
    res.json({ tenant: { id: updated.id, name: updated.name, slug: updated.slug, status: updated.status, plan: updated.plan, customDomain: updated.customDomain } });
  }),
);

// POST /admin/tenants/:id/approve — approve a self-serve org signup (option C): PENDING → ACTIVE, so
// its owner can finally sign in. Only PENDING tenants qualify; personal (guest) tenants never reach
// this queue. Audited against the platform admin.
router.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, slug: true, status: true, isPersonal: true } });
    if (!tenant) throw NotFound('Tenant not found');
    if (tenant.isPersonal) throw BadRequest('Personal (guest) tenants are not managed here.');
    if (tenant.status !== 'PENDING') throw BadRequest(`Only a PENDING signup can be approved (this one is ${tenant.status}).`);
    const updated = await prisma.tenant.update({ where: { id: tenant.id }, data: { status: 'ACTIVE' } });
    await writeAudit({ userId: req.user!.id, entity: 'Tenant', entityId: tenant.id, action: 'UPDATE', before: { status: tenant.status }, after: { status: updated.status, approved: true } });
    res.json({ tenant: { id: updated.id, name: updated.name, slug: updated.slug, status: updated.status } });
  }),
);

// POST /admin/tenants/:id/reject — reject a self-serve org signup (option C): PENDING → REJECTED. Soft:
// the tenant is kept (locked out) for review/audit and can be hard-deleted later. Owner cannot sign in.
router.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, slug: true, status: true, isPersonal: true } });
    if (!tenant) throw NotFound('Tenant not found');
    if (tenant.isPersonal) throw BadRequest('Personal (guest) tenants are not managed here.');
    if (tenant.status !== 'PENDING') throw BadRequest(`Only a PENDING signup can be rejected (this one is ${tenant.status}).`);
    const updated = await prisma.tenant.update({ where: { id: tenant.id }, data: { status: 'REJECTED' } });
    await writeAudit({ userId: req.user!.id, entity: 'Tenant', entityId: tenant.id, action: 'UPDATE', before: { status: tenant.status }, after: { status: updated.status, rejected: true } });
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
      // Sprint & BacklogItem are RESTRICT on projectId (not Cascade) — clear the agile stream first
      // (SprintSnapshot cascades off Sprint) so the project delete below doesn't trip the FK.
      const projs = await tx.project.findMany({ where: { tenantId }, select: { id: true } });
      const pids = projs.map((p) => p.id);
      if (pids.length) {
        await tx.backlogItem.deleteMany({ where: { projectId: { in: pids } } });
        await tx.sprint.deleteMany({ where: { projectId: { in: pids } } });
      }
      // Projects cascade all their other children (charter/cost/risk/task/CR/…) via onDelete: Cascade.
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

// ---------------------------------------------------------------------------
// Guest / Google-user management. Guests (self-signup or Google) are role GUEST,
// each sandboxed in their OWN personal tenant — so they never appear in a tenant's
// Admin → Users. This platform view lists them across all personal tenants and lets
// an admin deactivate/reactivate or delete them (+ their sandbox).
// ---------------------------------------------------------------------------

// GET /admin/tenants/guests — every guest / Google-linked account (User is a global model).
router.get(
  '/guests',
  asyncHandler(async (_req, res) => {
    const guests = await prisma.user.findMany({
      where: { OR: [{ isGuest: true }, { googleSub: { not: null } }] },
      select: { id: true, name: true, email: true, isActive: true, createdAt: true, googleSub: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      guests: guests.map((g) => ({
        id: g.id, name: g.name, email: g.email, isActive: g.isActive,
        createdAt: g.createdAt, viaGoogle: !!g.googleSub,
      })),
    });
  }),
);

// PATCH /admin/tenants/guests/:id — deactivate/reactivate. Deactivating bumps tokenVersion +
// revokes refresh tokens so the guest is signed out immediately and can't sign back in.
router.patch(
  '/guests/:id',
  validateBody(z.object({ isActive: z.boolean() })),
  asyncHandler(async (req, res) => {
    const g = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, isGuest: true, googleSub: true, isPlatformAdmin: true } });
    if (!g || (!g.isGuest && !g.googleSub)) throw NotFound('Guest not found');
    if (g.isPlatformAdmin) throw Forbidden('Cannot modify a platform admin here');
    const active = req.body.isActive as boolean;
    await prisma.user.update({ where: { id: g.id }, data: { isActive: active, ...(active ? {} : { tokenVersion: { increment: 1 } }) } });
    if (!active) await prisma.refreshToken.updateMany({ where: { userId: g.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAudit({ userId: req.user!.id, entity: 'User', entityId: g.id, action: 'UPDATE', after: { isActive: active, guestMgmt: true } });
    res.json({ ok: true });
  }),
);

// DELETE /admin/tenants/guests/:id — remove the guest AND their sandbox. Order matters (Project.tenant
// is SetNull, not Cascade): delete their personal-tenant projects → the personal tenants → the user.
router.delete(
  '/guests/:id',
  validateBody(z.object({ block: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const g = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true, isGuest: true, googleSub: true, isPlatformAdmin: true } });
    if (!g || (!g.isGuest && !g.googleSub)) throw NotFound('Guest not found');
    if (g.isPlatformAdmin) throw Forbidden('Cannot delete a platform admin');
    if (g.id === req.user!.id) throw BadRequest('You cannot delete yourself');
    const personal = await prisma.membership.findMany({ where: { userId: g.id, tenant: { isPersonal: true } }, select: { tenantId: true } });
    const tids = personal.map((m) => m.tenantId);
    await runAsSystem(() => prisma.$transaction(async (tx) => {
      if (tids.length) {
        // Sprint & BacklogItem are RESTRICT on projectId (not Cascade) — clear the agile stream first
        // (SprintSnapshot cascades off Sprint) or project.deleteMany trips the FK. Guests always get an
        // agile sample project, so every guest has these rows.
        const projs = await tx.project.findMany({ where: { tenantId: { in: tids } }, select: { id: true } });
        const pids = projs.map((p) => p.id);
        if (pids.length) {
          await tx.backlogItem.deleteMany({ where: { projectId: { in: pids } } });
          await tx.sprint.deleteMany({ where: { projectId: { in: pids } } });
        }
        await tx.project.deleteMany({ where: { tenantId: { in: tids } } });   // Project is tenant-scoped
        await tx.tenant.deleteMany({ where: { id: { in: tids } } });          // cascades memberships
      }
      await tx.user.delete({ where: { id: g.id } });                          // cascades tokens; audit userId → null
    }));
    // Optional permanent ban: delete only wipes data, so open Google/guest sign-up would let them
    // re-register — record the identity on the denylist to keep them out for good.
    if (req.body.block) {
      await blockIdentity({ email: g.email, googleSub: g.googleSub, reason: 'Blocked on guest deletion', createdById: req.user!.id });
    }
    await writeAudit({ userId: req.user!.id, entity: 'User', entityId: g.id, action: 'DELETE', before: { email: g.email, guest: true, blocked: !!req.body.block } });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Denylist — identities (email / Google account) barred from self-service sign-up.
// A guest can be deleted+blocked (above), or an admin can block/unblock manually here.
// ---------------------------------------------------------------------------

// GET /admin/tenants/denylist — all blocked identities.
router.get(
  '/denylist',
  asyncHandler(async (_req, res) => {
    const entries = await listBlocked();
    res.json({ entries });
  }),
);

// POST /admin/tenants/denylist — block an email and/or Google subject manually.
router.post(
  '/denylist',
  validateBody(z.object({
    email: z.string().email().optional(),
    googleSub: z.string().min(1).optional(),
    reason: z.string().max(500).optional(),
  }).refine((d) => !!d.email || !!d.googleSub, { message: 'Provide an email or a Google account' })),
  asyncHandler(async (req, res) => {
    const entry = await blockIdentity({ email: req.body.email, googleSub: req.body.googleSub, reason: req.body.reason, createdById: req.user!.id });
    await writeAudit({ userId: req.user!.id, entity: 'BlockedIdentity', entityId: entry.id, action: 'CREATE', after: { email: entry.email, googleSub: !!entry.googleSub } });
    res.status(201).json({ entry });
  }),
);

// DELETE /admin/tenants/denylist/:id — unblock (removes the entry).
router.delete(
  '/denylist/:id',
  asyncHandler(async (req, res) => {
    const removed = await unblock(req.params.id);
    if (removed.count === 0) throw NotFound('Blocked identity not found');
    await writeAudit({ userId: req.user!.id, entity: 'BlockedIdentity', entityId: req.params.id, action: 'DELETE' });
    res.json({ ok: true });
  }),
);

export default router;
