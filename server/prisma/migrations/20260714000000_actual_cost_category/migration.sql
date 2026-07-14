-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('DIRECT', 'INDIRECT');

-- AlterTable
-- Additive: existing rows (and any without an explicit value) default to DIRECT —
-- labour-from-timesheet and legacy actuals (Servers, License, …) are direct spend.
ALTER TABLE "ActualCostEntry" ADD COLUMN     "category" "CostCategory" NOT NULL DEFAULT 'DIRECT';
