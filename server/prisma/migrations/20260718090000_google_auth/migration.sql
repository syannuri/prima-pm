-- Google sign-in support:
--   * passwordHash becomes nullable — Google-provisioned GUEST accounts have no local password.
--   * googleSub binds an account to its stable Google identity (unique; null for password users).
ALTER TABLE "User" ADD COLUMN     "googleSub" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
