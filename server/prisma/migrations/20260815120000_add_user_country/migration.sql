-- Geo analytics: per-user country (ISO-3166-1 alpha-2) from Cloudflare CF-IPCountry. Nullable —
-- unknown / off-Cloudflare users stay NULL.
ALTER TABLE "User" ADD COLUMN "country" TEXT;
