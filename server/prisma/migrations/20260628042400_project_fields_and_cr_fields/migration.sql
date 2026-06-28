-- CreateEnum
CREATE TYPE "ChangeMagnitude" AS ENUM ('MINOR', 'MAJOR');

-- CreateEnum
CREATE TYPE "ChangeImpact" AS ENUM ('COST', 'SCHEDULE', 'RESOURCE', 'QUALITY', 'RISK');

-- AlterTable
ALTER TABLE "ChangeRequest" ADD COLUMN     "chargeable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "impactAreas" "ChangeImpact"[],
ADD COLUMN     "magnitude" "ChangeMagnitude" NOT NULL DEFAULT 'MINOR';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "category" "ProjectCategory",
ADD COLUMN     "costBaselineIdr" DECIMAL(18,2),
ADD COLUMN     "totalRevenueIdr" DECIMAL(18,2);
