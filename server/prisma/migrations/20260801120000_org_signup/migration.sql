-- Phase 6 (SaaS): deployment-level toggle for self-serve ORGANIZATION signup — anyone may create a
-- new corporate tenant + its owner. Additive; off by default (admin flips it, like guest/Google).
ALTER TABLE "AppSetting" ADD COLUMN "orgSignupEnabled" BOOLEAN NOT NULL DEFAULT false;
