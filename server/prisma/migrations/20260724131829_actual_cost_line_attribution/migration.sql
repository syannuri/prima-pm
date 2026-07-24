-- AlterTable
ALTER TABLE "ActualCostEntry" ADD COLUMN     "directLineId" TEXT,
ADD COLUMN     "indirectLineId" TEXT;

-- CreateIndex
CREATE INDEX "ActualCostEntry_directLineId_idx" ON "ActualCostEntry"("directLineId");

-- CreateIndex
CREATE INDEX "ActualCostEntry_indirectLineId_idx" ON "ActualCostEntry"("indirectLineId");

-- AddForeignKey
ALTER TABLE "ActualCostEntry" ADD CONSTRAINT "ActualCostEntry_directLineId_fkey" FOREIGN KEY ("directLineId") REFERENCES "CostItemDirect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActualCostEntry" ADD CONSTRAINT "ActualCostEntry_indirectLineId_fkey" FOREIGN KEY ("indirectLineId") REFERENCES "CostItemIndirect"("id") ON DELETE SET NULL ON UPDATE CASCADE;
