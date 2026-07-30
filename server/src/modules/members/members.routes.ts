import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { NotFound, Conflict, BadRequest } from '../../lib/errors.js';
import { DEFAULT_TENANT_SLUG } from '../../lib/tenant/constants.js';

// Membership management for the ACTIVE tenant (pooled multitenancy). Lets a tenant ADMIN add an
// existing user to their org, change a member's per-tenant role, and remove a member — WITHOUT
// touching the global User identity (that's /users). This is the tenant-centric view: the same
// person can be a member of several tenants with a different role in each.
const router = Router();

// The 7 corporate roles — GUEST is a self-service sandbox identity, never assigned as a membership.
const roleEnum = z.enum(['ADMIN', 'PMO', 'PROJECT_MANAGER', 'FINANCE', 'RISK_OFFICER', 'TEAM_MEMBER', 'VIEWER']);
const addMemberSchema = z.object({ email: z.string().email().toLowerCase(), role: roleEnum });
const setRoleSchema = z.object({ role: roleEnum });

// The tenant these operations act on: the active tenant from the token, else the default tenant
// (single-tenant deploys). Both Membership and Tenant are global models, so no tenant context is
// needed to read them.
async function activeTenantId(req: Request): Promise<string> {
  if (req.user?.tid) return req.user.tid;
  const t = await prisma.tenant.findUnique({ where: { slug: DEFAULT_TENANT_SLUG }, select: { id: true } });
  if (!t) throw NotFound('No active tenant');
  return t.id;
}

// Refuse to remove/demote the tenant's LAST active admin (never lock an org out of administration).
async function assertNotLastAdmin(tenantId: string, userId: string): Promise<void> {
  const admins = await prisma.membership.findMany({
    where: { tenantId, role: 'ADMIN' },
    select: { userId: true },
  });
  if (admins.length <= 1 && admins.some((m) => m.userId === userId)) {
    throw BadRequest('Cannot remove or demote the tenant’s last admin.');
  }
}

router.use(requireAuth, requireRole('ADMIN'));

// List the active tenant's members with their per-tenant role.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const tenantId = await activeTenantId(req);
    const rows = await prisma.membership.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, createdAt: true, user: { select: { id: true, name: true, email: true, isActive: true } } },
    });
    const members = rows.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email, isActive: m.user.isActive, role: m.role, since: m.createdAt }));
    res.json({ members });
  }),
);

// Add an EXISTING user (by email) to the active tenant with a role. Creating a brand-new account is
// /users' job; here we only grant membership (the cross-tenant "invite a colleague" path).
router.post(
  '/',
  validateBody(addMemberSchema),
  asyncHandler(async (req, res) => {
    const tenantId = await activeTenantId(req);
    const user = await prisma.user.findUnique({ where: { email: req.body.email }, select: { id: true, role: true } });
    if (!user) throw NotFound('No user with that email. Create the account first, then add them.');
    if (user.role === 'GUEST') throw BadRequest('Guest accounts cannot be added as tenant members.');
    const existing = await prisma.membership.findUnique({ where: { userId_tenantId: { userId: user.id, tenantId } }, select: { id: true } });
    if (existing) throw Conflict('That user is already a member of this tenant.');

    const membership = await prisma.membership.create({ data: { userId: user.id, tenantId, role: req.body.role } });
    await writeAudit({ userId: req.user!.id, entity: 'Membership', entityId: membership.id, action: 'CREATE', after: { userId: user.id, tenantId, role: req.body.role } });
    res.status(201).json({ member: { id: user.id, role: membership.role } });
  }),
);

// Change a member's per-tenant role.
router.patch(
  '/:userId',
  validateBody(setRoleSchema),
  asyncHandler(async (req, res) => {
    const tenantId = await activeTenantId(req);
    const before = await prisma.membership.findUnique({ where: { userId_tenantId: { userId: req.params.userId, tenantId } }, select: { id: true, role: true } });
    if (!before) throw NotFound('That user is not a member of this tenant.');
    if (req.body.role !== 'ADMIN') await assertNotLastAdmin(tenantId, req.params.userId);

    const membership = await prisma.membership.update({ where: { id: before.id }, data: { role: req.body.role }, select: { role: true } });
    await writeAudit({ userId: req.user!.id, entity: 'Membership', entityId: before.id, action: 'UPDATE', before: { role: before.role }, after: { role: membership.role } });
    res.json({ member: { id: req.params.userId, role: membership.role } });
  }),
);

// Remove a member from the active tenant (the global User account is untouched).
router.delete(
  '/:userId',
  asyncHandler(async (req, res) => {
    const tenantId = await activeTenantId(req);
    if (req.params.userId === req.user!.id) throw BadRequest('You cannot remove your own membership.');
    const membership = await prisma.membership.findUnique({ where: { userId_tenantId: { userId: req.params.userId, tenantId } }, select: { id: true, role: true } });
    if (!membership) throw NotFound('That user is not a member of this tenant.');
    await assertNotLastAdmin(tenantId, req.params.userId);

    await prisma.membership.delete({ where: { id: membership.id } });
    await writeAudit({ userId: req.user!.id, entity: 'Membership', entityId: membership.id, action: 'DELETE', before: { userId: req.params.userId, tenantId, role: membership.role } });
    res.status(204).send();
  }),
);

export default router;
