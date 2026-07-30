import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { Conflict, NotFound, BadRequest } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { strongPassword } from '../auth/auth.schemas.js';
import { multitenancyEnforced } from '../../lib/tenant/context.js';
import { DEFAULT_TENANT_SLUG } from '../../lib/tenant/constants.js';

const router = Router();

// Pooled multitenancy: user administration is scoped to a tenant. Directory/list only return the
// active tenant's members, mutations only touch members of the active tenant, and role changes /
// new users are mirrored into a Membership. `User` is a global identity model (not filtered by the
// Prisma extension), so this scoping is applied explicitly here.

// The tenant a membership should be attached to / filtered by: the active tenant from the token,
// else the default tenant (single-tenant). Undefined only if the default tenant is absent.
async function membershipTenantId(req: Request): Promise<string | undefined> {
  if (req.user?.tid) return req.user.tid;
  const t = await prisma.tenant.findUnique({ where: { slug: DEFAULT_TENANT_SLUG }, select: { id: true } });
  return t?.id;
}

// Restrict listing/mutation to the active tenant's members — but ONLY under enforcement, so
// single-tenant behaviour is byte-identical when the flag is off.
function activeScopeTenantId(req: Request): string | undefined {
  return multitenancyEnforced() ? req.user?.tid : undefined;
}

// Under enforcement, refuse to administer a user who is not a member of the caller's active tenant
// (an admin of tenant A must not touch tenant B's people).
async function assertInActiveTenant(req: Request, targetUserId: string): Promise<void> {
  const tid = activeScopeTenantId(req);
  if (!tid) return;
  const m = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: targetUserId, tenantId: tid } },
    select: { id: true },
  });
  if (!m) throw NotFound('User not found');
}

// Mirror a role change / new user into the active (or default) tenant's membership so per-tenant
// roles stay in sync with the legacy User.role (dual-write until User.role is dropped in 4c).
async function upsertMembershipRole(req: Request, userId: string, role: Role): Promise<void> {
  const tid = await membershipTenantId(req);
  if (!tid) return;
  await prisma.membership.upsert({
    where: { userId_tenantId: { userId, tenantId: tid } },
    update: { role },
    create: { userId, tenantId: tid, role },
  });
}

const roleEnum = z.enum([
  'ADMIN',
  'PMO',
  'PROJECT_MANAGER',
  'FINANCE',
  'RISK_OFFICER',
  'TEAM_MEMBER',
  'VIEWER',
]);

const updateRoleSchema = z.object({ role: roleEnum });
const setActiveSchema = z.object({ isActive: z.boolean() });
const createUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  role: roleEnum,
  password: strongPassword,
});
const resetPasswordSchema = z.object({ newPassword: strongPassword });
const editProfileSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    email: z.string().email().toLowerCase().optional(),
  })
  .refine((d) => d.name !== undefined || d.email !== undefined, {
    message: 'Provide a name or email to update',
  });

const PUBLIC_USER = { id: true, name: true, email: true, role: true, isActive: true, createdAt: true } as const;

router.use(requireAuth);

// Lightweight directory for assignment pickers (PM, PIC, risk owner). GUESTS are excluded from
// the results (their identities never surface in corporate pickers) AND a GUEST may not call it
// (they self-govern personal projects and never assign corporate people).
router.get(
  '/directory',
  requireRole('ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER'),
  asyncHandler(async (req, res) => {
    const tid = activeScopeTenantId(req);
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { not: 'GUEST' },
        ...(tid ? { memberships: { some: { tenantId: tid } } } : {}),
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json({ users });
  }),
);

// All remaining user-admin endpoints require ADMIN.
router.use(requireRole('ADMIN'));

// List users (full detail, admin only). Scoped to the active tenant's members under enforcement.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const tid = activeScopeTenantId(req);
    const users = await prisma.user.findMany({
      where: tid ? { memberships: { some: { tenantId: tid } } } : {},
      select: PUBLIC_USER,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ users });
  }),
);

// Create a user with an initial role + password.
router.post(
  '/',
  validateBody(createUserSchema),
  asyncHandler(async (req, res) => {
    const exists = await prisma.user.findUnique({ where: { email: req.body.email } });
    if (exists) throw Conflict('A user with that email already exists');

    const user = await prisma.user.create({
      data: {
        name: req.body.name,
        email: req.body.email,
        role: req.body.role,
        passwordHash: await hashPassword(req.body.password),
      },
      select: PUBLIC_USER,
    });
    // Admin-created users join the active (or default) tenant with the chosen role.
    await upsertMembershipRole(req, user.id, req.body.role);
    await writeAudit({ userId: req.user!.id, entity: 'User', entityId: user.id, action: 'CREATE', after: { email: user.email, role: user.role } });
    res.status(201).json({ user });
  }),
);

// Reset another user's password (admin). The target user must change it later via self-service.
router.patch(
  '/:id/password',
  validateBody(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw NotFound('User not found');
    await assertInActiveTenant(req, req.params.id);
    // Bump tokenVersion AND revoke the target's refresh tokens: an admin reset must
    // invalidate every existing session (access tokens die on tv mismatch, refresh rows here).
    await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash: await hashPassword(req.body.newPassword), tokenVersion: { increment: 1 } } });
    await prisma.refreshToken.updateMany({ where: { userId: req.params.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAudit({ userId: req.user!.id, entity: 'User', entityId: req.params.id, action: 'PASSWORD_CHANGE', after: { reset: true } });
    res.json({ ok: true });
  }),
);

// Edit a user's name and/or email.
router.patch(
  '/:id/profile',
  validateBody(editProfileSchema),
  asyncHandler(async (req, res) => {
    const before = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!before) throw NotFound('User not found');
    await assertInActiveTenant(req, req.params.id);
    // Email is unique — block clashes with a different account.
    if (req.body.email && req.body.email !== before.email) {
      const clash = await prisma.user.findUnique({ where: { email: req.body.email } });
      if (clash) throw Conflict('A user with that email already exists');
    }
    const data: { name?: string; email?: string } = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.email !== undefined) data.email = req.body.email;

    const user = await prisma.user.update({ where: { id: req.params.id }, data, select: PUBLIC_USER });
    await writeAudit({
      userId: req.user!.id,
      entity: 'User',
      entityId: user.id,
      action: 'UPDATE',
      before: { name: before.name, email: before.email },
      after: { name: user.name, email: user.email },
    });
    res.json({ user });
  }),
);

// Elevate / change a user's role.
router.patch(
  '/:id/role',
  validateBody(updateRoleSchema),
  asyncHandler(async (req, res) => {
    const before = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!before) throw NotFound('User not found');
    await assertInActiveTenant(req, req.params.id);
    // Guard against an admin locking themselves out of admin.
    if (req.params.id === req.user!.id && req.body.role !== 'ADMIN')
      throw BadRequest('You cannot change your own admin role');

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role: req.body.role },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    // Mirror into the active tenant's membership — the per-tenant role is authoritative under
    // enforcement (Phase 4). User.role is kept dual-written until it's dropped (4c).
    await upsertMembershipRole(req, user.id, req.body.role);
    await writeAudit({
      userId: req.user!.id,
      entity: 'User',
      entityId: user.id,
      action: 'UPDATE',
      before: { role: before.role },
      after: { role: user.role },
    });
    res.json({ user });
  }),
);

// Activate / deactivate a user.
router.patch(
  '/:id/active',
  validateBody(setActiveSchema),
  asyncHandler(async (req, res) => {
    // Guard against an admin deactivating their own account.
    if (req.params.id === req.user!.id && !req.body.isActive)
      throw BadRequest('You cannot deactivate your own account');
    await assertInActiveTenant(req, req.params.id);
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: req.body.isActive },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    await writeAudit({
      userId: req.user!.id,
      entity: 'User',
      entityId: user.id,
      action: 'UPDATE',
      after: { isActive: user.isActive },
    });
    res.json({ user });
  }),
);

// Hard-delete an account. GUEST → PURGE the whole self-service sandbox (personal projects with all
// nested data, private resource pool & rate cards, notifications, bookmarks, sessions). CORPORATE →
// remove the account only: corporate projects/data are SHARED and kept; the account is deletable
// ONLY when it isn't still managing work (blocked if it manages a project/charter or raised change
// requests — reassign or deactivate first). Either way the audit trail is preserved but ANONYMISED
// (AuditLog.userId is SET NULL by the DB) and the deletion is itself audited by the admin.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    if (!target) throw NotFound('User not found');
    await assertInActiveTenant(req, req.params.id);
    if (target.id === req.user!.id) throw BadRequest('You cannot delete your own account');

    if (target.role === 'GUEST') {
      await prisma.$transaction(async (tx) => {
        // Personal projects cascade all nested data (charter, WBS, cost, risk, CRs, timesheets…).
        await tx.project.deleteMany({ where: { personalOwnerId: target.id } });
        await tx.resource.deleteMany({ where: { personalOwnerId: target.id } });
        await tx.rateCard.deleteMany({ where: { personalOwnerId: target.id } });
        await tx.notification.deleteMany({ where: { userId: target.id } });
        await tx.projectBookmark.deleteMany({ where: { userId: target.id } });
        await tx.user.delete({ where: { id: target.id } }); // cascades refresh tokens; audit SET NULL
      });
    } else {
      // Never lock the org out: keep at least one active admin.
      if (target.role === 'ADMIN' && target.isActive) {
        const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
        if (activeAdmins <= 1) throw BadRequest('Cannot delete the last active admin.');
      }
      // Block while the account still manages work — those references represent real ownership
      // (and two of them are hard FK constraints). Reassign / deactivate first.
      const [pmActive, charterPm, crs] = await Promise.all([
        prisma.project.count({ where: { pmUserId: target.id, deletedAt: null } }),
        prisma.projectCharter.count({ where: { pmUserId: target.id } }),
        prisma.changeRequest.count({ where: { requestedBy: target.id } }),
      ]);
      if (pmActive + charterPm + crs > 0) {
        throw Conflict('This account still manages projects (as a project or charter manager) or raised change requests. Reassign their projects and/or deactivate the account instead.');
      }
      await prisma.$transaction(async (tx) => {
        // Notifications hard-block the delete (RESTRICT); clear them + bookmarks. Everything else
        // referencing the user (project PM of soft-deleted, task PIC, risk/issue owners, audit,
        // resource link, refresh tokens) is SET NULL / CASCADE by the DB on delete.
        await tx.notification.deleteMany({ where: { userId: target.id } });
        await tx.projectBookmark.deleteMany({ where: { userId: target.id } });
        await tx.user.delete({ where: { id: target.id } });
      });
    }

    await writeAudit({
      userId: req.user!.id,
      entity: 'User',
      entityId: target.id,
      action: 'DELETE',
      before: { name: target.name, email: target.email, role: target.role },
    });
    res.status(204).send();
  }),
);

export default router;
