-- Phase 5: platform (super-admin) privilege — a global flag that transcends tenants, granting access
-- to the /admin/tenants provisioning API (create/suspend tenants, provision their first admin).
-- Additive; default false and NEVER auto-granted — an operator flips it deliberately, e.g.:
--   UPDATE "User" SET "isPlatformAdmin" = true WHERE email = 'you@example.com';
ALTER TABLE "User" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
