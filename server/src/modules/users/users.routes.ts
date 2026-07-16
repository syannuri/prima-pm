import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { Conflict, NotFound, BadRequest } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { strongPassword } from '../auth/auth.schemas.js';

const router = Router();

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
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      where: { isActive: true, role: { not: 'GUEST' } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json({ users });
  }),
);

// All remaining user-admin endpoints require ADMIN.
router.use(requireRole('ADMIN'));

// List users (full detail, admin only).
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ select: PUBLIC_USER, orderBy: { createdAt: 'desc' } });
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
    // Guard against an admin locking themselves out of admin.
    if (req.params.id === req.user!.id && req.body.role !== 'ADMIN')
      throw BadRequest('You cannot change your own admin role');

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role: req.body.role },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
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

// Hard-delete a GUEST account and PURGE its entire self-service sandbox (personal projects with
// all nested data, private resource pool & rate cards, notifications, bookmarks, sessions). The
// audit trail is preserved but ANONYMISED (its userId is nulled) so the record of what happened
// survives. Corporate accounts are never hard-deletable here — deactivate them instead.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!target) throw NotFound('User not found');
    if (target.role !== 'GUEST') throw BadRequest('Only guest accounts can be deleted. Deactivate other users instead.');
    if (target.id === req.user!.id) throw BadRequest('You cannot delete your own account');

    await prisma.$transaction(async (tx) => {
      // Personal projects cascade all their nested data (charter, WBS, cost, risk, CRs, timesheets…).
      await tx.project.deleteMany({ where: { personalOwnerId: target.id } });
      // Then the guest's private pool (now unreferenced — their cost lines went with the projects).
      await tx.resource.deleteMany({ where: { personalOwnerId: target.id } });
      await tx.rateCard.deleteMany({ where: { personalOwnerId: target.id } });
      // Account-scoped rows that reference the user directly.
      await tx.notification.deleteMany({ where: { userId: target.id } });
      await tx.projectBookmark.deleteMany({ where: { userId: target.id } });
      // Preserve the audit trail but detach the deleted actor.
      await tx.auditLog.updateMany({ where: { userId: target.id }, data: { userId: null } });
      await tx.user.delete({ where: { id: target.id } }); // cascades refresh tokens
    });

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
