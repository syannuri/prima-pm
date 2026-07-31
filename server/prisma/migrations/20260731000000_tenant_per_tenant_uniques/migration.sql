-- Phase 3c (partial): per-tenant uniqueness. Project.code is now unique PER TENANT
-- (@@unique([tenantId, code])) so different orgs can reuse a code; AppSetting is one row per
-- tenant. Safe with nullable tenantId: under enforcement every row is stamped, and Postgres
-- treats NULLs as distinct. The tenantId NOT NULL flip is DEFERRED — making the Prisma field
-- required breaks ~99 create-sites (the extension injects tenantId at runtime, which TS can't
-- see); the fail-closed extension already guarantees non-null on real inserts.

-- DropIndex
DROP INDEX "Project_code_key";

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_tenantId_key" ON "AppSetting"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenantId_code_key" ON "Project"("tenantId", "code");

