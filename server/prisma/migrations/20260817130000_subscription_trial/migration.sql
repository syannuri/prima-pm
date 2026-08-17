-- Subscription plans: replace the perpetual FREE tier with a 60-day TRIAL.
-- See docs/SUBSCRIPTION-PLANS-PLAN.md.

-- Rename the FREE plan value to TRIAL in place (existing FREE rows become TRIAL; the column
-- default follows the rename automatically).
ALTER TYPE "TenantPlan" RENAME VALUE 'FREE' TO 'TRIAL';

-- Make the intent explicit for future migrate diffs.
ALTER TABLE "Tenant" ALTER COLUMN "plan" SET DEFAULT 'TRIAL';

-- Trial expiry timestamp. Null = not on a trial (a paid tenant, or exempt personal tenant).
ALTER TABLE "Tenant" ADD COLUMN "trialEndsAt" TIMESTAMP(3);

-- Don't lock out any existing CORPORATE trial tenant on deploy: grant a fresh 60-day trial.
-- Personal (guest) tenants are exempt from plan gating, so leave their trialEndsAt null.
UPDATE "Tenant"
  SET "trialEndsAt" = now() + interval '60 days'
  WHERE "plan" = 'TRIAL' AND "isPersonal" = false AND "trialEndsAt" IS NULL;
