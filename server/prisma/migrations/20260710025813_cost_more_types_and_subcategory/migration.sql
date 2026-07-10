-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DirectCostType" ADD VALUE 'SUBCONTRACTOR';
ALTER TYPE "DirectCostType" ADD VALUE 'TRAINING_CERTIFICATION';
ALTER TYPE "DirectCostType" ADD VALUE 'SUPPORT_MAINTENANCE';
ALTER TYPE "DirectCostType" ADD VALUE 'HARDWARE_EQUIPMENT';
ALTER TYPE "DirectCostType" ADD VALUE 'OTHER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IndirectCostType" ADD VALUE 'MEALS_PERDIEM';
ALTER TYPE "IndirectCostType" ADD VALUE 'COMMUNICATION';
ALTER TYPE "IndirectCostType" ADD VALUE 'OFFICE_SUPPLIES';
ALTER TYPE "IndirectCostType" ADD VALUE 'MEETING_VENUE';
ALTER TYPE "IndirectCostType" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "CostItemDirect" ADD COLUMN     "subCategory" TEXT;

-- AlterTable
ALTER TABLE "CostItemIndirect" ADD COLUMN     "subCategory" TEXT;
