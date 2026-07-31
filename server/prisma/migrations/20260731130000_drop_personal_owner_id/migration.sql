-- Phase 5 / de-scatter CONTRACT (final step): drop the legacy `personalOwnerId` column from
-- Project, RateCard and Resource. Guest sandboxes are now isolated AND self-governed purely by their
-- PERSONAL TENANT (Tenant.isPersonal + the Prisma tenant-scope extension). No app code reads or
-- writes personalOwnerId any longer (verified before this ran).
--
-- Recoverability: the owner is NOT truly lost — each personal tenant's slug is 'guest-<userId>', so
-- a project's former personalOwnerId = the userId embedded in its (personal) tenant's slug.
DROP INDEX IF EXISTS "Project_personalOwnerId_idx";
DROP INDEX IF EXISTS "RateCard_personalOwnerId_idx";
DROP INDEX IF EXISTS "Resource_personalOwnerId_idx";
ALTER TABLE "Project"  DROP COLUMN IF EXISTS "personalOwnerId";
ALTER TABLE "RateCard" DROP COLUMN IF EXISTS "personalOwnerId";
ALTER TABLE "Resource" DROP COLUMN IF EXISTS "personalOwnerId";
