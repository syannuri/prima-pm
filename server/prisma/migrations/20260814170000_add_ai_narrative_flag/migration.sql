-- AI Status Narrative: per-tenant opt-in flag. Feature is also gated globally by ANTHROPIC_API_KEY.
ALTER TABLE "Tenant" ADD COLUMN "aiNarrativeEnabled" BOOLEAN NOT NULL DEFAULT false;
