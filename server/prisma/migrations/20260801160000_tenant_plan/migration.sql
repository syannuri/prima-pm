-- Phase 6 (SaaS): per-tenant subscription plan gating quotas (max projects/members/storage).
-- Additive; every existing + new tenant defaults to FREE. Limits live in lib/tenant/plans.ts; a
-- platform admin changes a tenant's plan via PATCH /admin/tenants/:id { plan }.
CREATE TYPE "TenantPlan" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');
ALTER TABLE "Tenant" ADD COLUMN "plan" "TenantPlan" NOT NULL DEFAULT 'FREE';
-- The default tenant holds all pre-existing (single-tenant) data — never quota-cap it.
UPDATE "Tenant" SET "plan" = 'ENTERPRISE' WHERE "slug" = 'default';
