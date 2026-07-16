-- Owner-scoped resource pool & rate cards: personalOwnerId ties a Resource/RateCard to a
-- guest's private workspace (NULL = corporate). Corporate (roleName, level) uniqueness moves
-- to the application layer (enforced per-owner) so a guest may reuse a corporate role/level name.
-- DropIndex
DROP INDEX "RateCard_roleName_level_key";

-- AlterTable
ALTER TABLE "RateCard" ADD COLUMN     "personalOwnerId" TEXT;

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "personalOwnerId" TEXT;

-- CreateIndex
CREATE INDEX "RateCard_personalOwnerId_idx" ON "RateCard"("personalOwnerId");

-- CreateIndex
CREATE INDEX "Resource_personalOwnerId_idx" ON "Resource"("personalOwnerId");
