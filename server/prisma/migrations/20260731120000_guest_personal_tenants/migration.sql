-- Phase 5 (guests) / de-scatter prerequisite: give every GUEST sandbox its own PERSONAL tenant, so
-- the Prisma tenant extension isolates guests natively and the legacy `personalOwnerId` filters can
-- later be retired (Phase 3d). See docs/MULTITENANCY-POOLED-PLAN.md.
--
-- Additive & idempotent: guarded so re-running (migrate deploy) is a no-op. Moves guest-owned data
-- OUT of the shared `default` tenant into a per-guest personal tenant. Corporate data is untouched
-- (its rows have personalOwnerId = NULL and non-GUEST owners).

-- 1) Marker column.
ALTER TABLE "Tenant" ADD COLUMN "isPersonal" BOOLEAN NOT NULL DEFAULT false;

-- 2) One personal tenant per existing GUEST user (slug 'guest-<userId>' — immutable, unique, and the
--    idempotency key).
INSERT INTO "Tenant" ("id", "name", "slug", "status", "isPersonal", "createdAt", "updatedAt")
SELECT gen_random_uuid(),
       COALESCE(NULLIF(u."name", ''), u."email") || ' (personal)',
       'guest-' || u."id",
       'ACTIVE', true, now(), now()
FROM "User" u
WHERE u."role" = 'GUEST'
  AND NOT EXISTS (SELECT 1 FROM "Tenant" t WHERE t."slug" = 'guest-' || u."id");

-- 3) Move each guest's membership from the shared default tenant to their personal tenant.
UPDATE "Membership" m
SET "tenantId" = t."id"
FROM "Tenant" t, "User" u
WHERE m."userId" = u."id" AND u."role" = 'GUEST'
  AND t."slug" = 'guest-' || u."id"
  AND m."tenantId" <> t."id";

-- 4) Re-stamp the guest's sandbox ROOTS to their personal tenant.
--    a) Owned via personalOwnerId (the sandbox marker on these three models).
UPDATE "Project" x  SET "tenantId" = t."id" FROM "Tenant" t WHERE x."personalOwnerId" IS NOT NULL AND t."slug" = 'guest-' || x."personalOwnerId" AND x."tenantId" <> t."id";
UPDATE "RateCard" x SET "tenantId" = t."id" FROM "Tenant" t WHERE x."personalOwnerId" IS NOT NULL AND t."slug" = 'guest-' || x."personalOwnerId" AND x."tenantId" <> t."id";
UPDATE "Resource" x SET "tenantId" = t."id" FROM "Tenant" t WHERE x."personalOwnerId" IS NOT NULL AND t."slug" = 'guest-' || x."personalOwnerId" AND x."tenantId" <> t."id";
--    b) Owned by the guest USER directly (their own bookmarks / notifications / audit trail).
UPDATE "ProjectBookmark" x SET "tenantId" = t."id" FROM "Tenant" t, "User" u WHERE x."userId" = u."id" AND u."role" = 'GUEST' AND t."slug" = 'guest-' || u."id" AND x."tenantId" <> t."id";
UPDATE "Notification" x    SET "tenantId" = t."id" FROM "Tenant" t, "User" u WHERE x."userId" = u."id" AND u."role" = 'GUEST' AND t."slug" = 'guest-' || u."id" AND x."tenantId" <> t."id";
UPDATE "AuditLog" x        SET "tenantId" = t."id" FROM "Tenant" t, "User" u WHERE x."userId" = u."id" AND u."role" = 'GUEST' AND t."slug" = 'guest-' || u."id" AND x."tenantId" <> t."id";

-- 5) Reconcile every project-CHILD to its (now-moved) parent project. Universal rule — a child's
--    tenant must equal its parent's — so corporate rows (parent didn't move) are a no-op.
UPDATE "ProjectCharter" x    SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "CharterVersion" x    SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "CostItemDirect" x    SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "CostItemIndirect" x  SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "CostBaseline" x      SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "ActualCostEntry" x   SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "MandayEntry" x       SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "Risk" x              SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "Issue" x             SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "Stakeholder" x       SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "Procurement" x       SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "Assumption" x        SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "ProjectDependency" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "Task" x              SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "ChangeRequest" x     SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "Sprint" x            SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "EvmSnapshot" x       SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "BacklogItem" x       SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "LessonLearned" x     SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "AcceptanceSignoff" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "UatTestCase" x       SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "KickoffMeeting" x    SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";
UPDATE "Requirement" x       SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS DISTINCT FROM p."tenantId";

-- 6) Reconcile GRANDCHILDREN to their (now-moved) parents. Runs after step 5 so the parent tables
--    already carry the personal tenant.
UPDATE "TaskDependency" x      SET "tenantId" = q."tenantId" FROM "Task" q          WHERE x."predecessorId" = q."id" AND x."tenantId" IS DISTINCT FROM q."tenantId";
UPDATE "Attachment" x          SET "tenantId" = q."tenantId" FROM "Project" q       WHERE x."projectRelId" = q."id"  AND x."tenantId" IS DISTINCT FROM q."tenantId";
UPDATE "SprintSnapshot" x      SET "tenantId" = q."tenantId" FROM "Sprint" q        WHERE x."sprintId" = q."id"      AND x."tenantId" IS DISTINCT FROM q."tenantId";
UPDATE "KickoffAttendee" x     SET "tenantId" = q."tenantId" FROM "KickoffMeeting" q WHERE x."meetingId" = q."id"     AND x."tenantId" IS DISTINCT FROM q."tenantId";
UPDATE "KickoffActionItem" x   SET "tenantId" = q."tenantId" FROM "KickoffMeeting" q WHERE x."meetingId" = q."id"     AND x."tenantId" IS DISTINCT FROM q."tenantId";
UPDATE "RequirementTaskLink" x SET "tenantId" = q."tenantId" FROM "Requirement" q   WHERE x."requirementId" = q."id" AND x."tenantId" IS DISTINCT FROM q."tenantId";
