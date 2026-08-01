-- Phase 6 (subdomain / custom-domain routing): an optional vanity host per tenant. Unique across
-- tenants (Postgres unique index permits multiple NULLs). The tenant `slug` already yields a
-- subdomain acme.<APP_BASE_DOMAIN>; this maps a fully custom host (e.g. pm.acmecorp.com) → tenant.
ALTER TABLE "Tenant" ADD COLUMN "customDomain" TEXT;
CREATE UNIQUE INDEX "Tenant_customDomain_key" ON "Tenant"("customDomain");
