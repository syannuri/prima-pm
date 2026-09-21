-- Autopilot (multi-step) opt-in: a separate, stronger consent on top of aiActionsEnabled.
-- Default false ⇒ dormant-by-default; existing tenants are unaffected until they opt in.
ALTER TABLE "Tenant" ADD COLUMN "aiAutopilotEnabled" BOOLEAN NOT NULL DEFAULT false;
