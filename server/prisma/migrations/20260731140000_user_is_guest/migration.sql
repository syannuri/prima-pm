-- Phase 4c: add a global account-TYPE flag `User.isGuest` (guest sandbox vs staff), distinct from
-- the per-tenant Membership.role. Corporate features gate on this once the legacy global `User.role`
-- is retired. Additive + backfilled from the existing role so behaviour is unchanged.
ALTER TABLE "User" ADD COLUMN "isGuest" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "isGuest" = true WHERE "role" = 'GUEST';
