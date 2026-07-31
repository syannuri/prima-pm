import type { Db } from '../prisma.js';
import { DEFAULT_TENANT_SLUG, DEFAULT_TENANT_NAME } from './constants.js';
import { runAsSystem } from './context.js';

// Programmatic mirror of the Phase-1 seed embedded in the tenant_membership migration:
// ensure the single default tenant exists and every user has a membership in it carrying
// their current global role. Idempotent (upsert on slug + skipDuplicates on the
// (userId, tenantId) unique), so it is safe to run repeatedly — used by tests to assert the
// invariant, and available to ops if a re-backfill is ever needed. Phase 2 extends this to
// stamp tenantId onto the denormalized rows.
export async function backfillDefaultTenant(prisma: Db): Promise<{ tenantId: string; memberships: number }> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEFAULT_TENANT_SLUG },
    update: {},
    create: { slug: DEFAULT_TENANT_SLUG, name: DEFAULT_TENANT_NAME },
  });

  const users = await prisma.user.findMany({ select: { id: true, role: true } });
  const { count } = await prisma.membership.createMany({
    data: users.map((u) => ({ userId: u.id, tenantId: tenant.id, role: u.role })),
    skipDuplicates: true,
  });

  return { tenantId: tenant.id, memberships: count };
}

// Project-CHILD tables (each carries a direct `projectId`) and GRANDCHILD tables (via an
// intermediate parent) — the denormalized-tenantId topology, mirrored from the tenant_id_columns
// migration. Used to reconcile a child's tenant to its (possibly moved) parent's.
const PROJECT_CHILDREN: ReadonlyArray<readonly [table: string, fk: string]> = [
  ['ProjectCharter', 'projectId'], ['CharterVersion', 'projectId'], ['CostItemDirect', 'projectId'],
  ['CostItemIndirect', 'projectId'], ['CostBaseline', 'projectId'], ['ActualCostEntry', 'projectId'],
  ['MandayEntry', 'projectId'], ['Risk', 'projectId'], ['Issue', 'projectId'], ['Stakeholder', 'projectId'],
  ['Procurement', 'projectId'], ['Assumption', 'projectId'], ['ProjectDependency', 'projectId'],
  ['Task', 'projectId'], ['ChangeRequest', 'projectId'], ['Sprint', 'projectId'], ['EvmSnapshot', 'projectId'],
  ['BacklogItem', 'projectId'], ['LessonLearned', 'projectId'], ['AcceptanceSignoff', 'projectId'],
  ['UatTestCase', 'projectId'], ['KickoffMeeting', 'projectId'], ['Requirement', 'projectId'],
];
const GRANDCHILDREN: ReadonlyArray<readonly [table: string, fk: string, parent: string]> = [
  ['TaskDependency', 'predecessorId', 'Task'], ['Attachment', 'projectRelId', 'Project'],
  ['SprintSnapshot', 'sprintId', 'Sprint'], ['KickoffAttendee', 'meetingId', 'KickoffMeeting'],
  ['KickoffActionItem', 'meetingId', 'KickoffMeeting'], ['RequirementTaskLink', 'requirementId', 'Requirement'],
];

// Programmatic mirror of the 20260731120000_guest_personal_tenants migration: move every GUEST
// user's sandbox out of the shared `default` tenant into a per-guest PERSONAL tenant, so the Prisma
// extension isolates guests natively (the tenant-native replacement for `personalOwnerId`).
// Idempotent — slug `guest-<userId>` is the stable key and every step is guarded by `tenantId <>
// target`, so a re-run is a no-op. Runs under `runAsSystem` because it re-stamps SCOPED models
// ACROSS tenants (the extension must not inject a scope). Kept in sync with the migration SQL; used
// by tests to assert the isolation invariant and available to ops for a re-backfill.
export async function backfillGuestTenants(prisma: Db): Promise<{ guests: number; movedProjects: number }> {
  return runAsSystem(async () => {
    const guests = await prisma.user.findMany({ where: { role: 'GUEST' }, select: { id: true, name: true, email: true } });
    let movedProjects = 0;
    for (const g of guests) {
      const tenant = await prisma.tenant.upsert({
        where: { slug: `guest-${g.id}` },
        update: {},
        create: { slug: `guest-${g.id}`, name: `${g.name || g.email} (personal)`, isPersonal: true },
        select: { id: true },
      });
      // Move the guest's membership + their user-owned roots + personalOwnerId-owned roots. The
      // `tenantId: { not }` guard makes each a true no-op on re-run and the count reflects REAL moves
      // (updateMany otherwise returns matched, not modified, rows).
      const notPersonal = { not: tenant.id };
      await prisma.membership.updateMany({ where: { userId: g.id, tenantId: notPersonal }, data: { tenantId: tenant.id } });
      const proj = await prisma.project.updateMany({ where: { personalOwnerId: g.id, tenantId: notPersonal }, data: { tenantId: tenant.id } });
      movedProjects += proj.count;
      await prisma.rateCard.updateMany({ where: { personalOwnerId: g.id, tenantId: notPersonal }, data: { tenantId: tenant.id } });
      await prisma.resource.updateMany({ where: { personalOwnerId: g.id, tenantId: notPersonal }, data: { tenantId: tenant.id } });
      await prisma.projectBookmark.updateMany({ where: { userId: g.id, tenantId: notPersonal }, data: { tenantId: tenant.id } });
      await prisma.notification.updateMany({ where: { userId: g.id, tenantId: notPersonal }, data: { tenantId: tenant.id } });
      await prisma.auditLog.updateMany({ where: { userId: g.id, tenantId: notPersonal }, data: { tenantId: tenant.id } });
    }
    // Reconcile children then grandchildren to their (now-moved) parents. Table/column names are
    // fixed constants above (not user input), so the raw UPDATE...FROM is safe. No-op for corporate
    // rows whose parent didn't move.
    for (const [table, fk] of PROJECT_CHILDREN) {
      await prisma.$executeRawUnsafe(`UPDATE "${table}" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."${fk}" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId"`);
    }
    for (const [table, fk, parent] of GRANDCHILDREN) {
      await prisma.$executeRawUnsafe(`UPDATE "${table}" x SET "tenantId" = q."tenantId" FROM "${parent}" q WHERE x."${fk}" = q."id" AND x."tenantId" IS DISTINCT FROM q."tenantId"`);
    }
    return { guests: guests.length, movedProjects };
  });
}
