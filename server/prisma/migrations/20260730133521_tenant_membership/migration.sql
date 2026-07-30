-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Membership_tenantId_idx" ON "Membership"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_tenantId_key" ON "Membership"("userId", "tenantId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- Phase-1 data backfill (see docs/MULTITENANCY-POOLED-PLAN.md, lib/tenant/constants.ts):
-- seed the ONE default tenant that owns all existing data, and give every existing user a
-- Membership carrying their current global User.role. Idempotent (ON CONFLICT DO NOTHING via
-- the unique slug + unique (userId, tenantId)) so re-running is a no-op. Non-enforcing: no
-- query filters by tenant yet, so single-tenant behaviour is unchanged.
-- =====================================================================
INSERT INTO "Tenant" ("id", "name", "slug", "status", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'PRIMA', 'default', 'ACTIVE', now(), now())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "Membership" ("id", "userId", "tenantId", "role", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."id", t."id", u."role", now(), now()
FROM "User" u
CROSS JOIN "Tenant" t
WHERE t."slug" = 'default'
ON CONFLICT ("userId", "tenantId") DO NOTHING;
