-- Email activation / verification (hard wall, armed only when SMTP is configured).
-- See docs/EMAIL-ACTIVATION-PLAN.md.

-- 1. Email-token purpose enum (extensible: password reset etc. later).
CREATE TYPE "EmailTokenPurpose" AS ENUM ('VERIFY_EMAIL');

-- 2. Verification timestamp on User. NULL = unverified.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- 3. CRITICAL — do NOT lock out anyone who already has an account: every existing user is
--    grandfathered in as verified (only accounts created AFTER this deploy face the wall).
UPDATE "User" SET "emailVerifiedAt" = COALESCE("createdAt", now()) WHERE "emailVerifiedAt" IS NULL;

-- 4. Single-use, hashed, expiring token store.
CREATE TABLE "EmailToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "EmailTokenPurpose" NOT NULL DEFAULT 'VERIFY_EMAIL',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailToken_tokenHash_key" ON "EmailToken"("tokenHash");
CREATE INDEX "EmailToken_userId_idx" ON "EmailToken"("userId");

ALTER TABLE "EmailToken" ADD CONSTRAINT "EmailToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
