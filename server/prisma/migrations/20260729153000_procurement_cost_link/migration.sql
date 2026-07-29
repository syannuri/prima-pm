-- Committed-cost link: attribute a contract/PO to one budget line (direct XOR indirect).
ALTER TABLE "Procurement" ADD COLUMN "costDirectLineId" TEXT;
ALTER TABLE "Procurement" ADD COLUMN "costIndirectLineId" TEXT;
ALTER TABLE "Procurement" ADD CONSTRAINT "Procurement_costDirectLineId_fkey" FOREIGN KEY ("costDirectLineId") REFERENCES "CostItemDirect"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Procurement" ADD CONSTRAINT "Procurement_costIndirectLineId_fkey" FOREIGN KEY ("costIndirectLineId") REFERENCES "CostItemIndirect"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Procurement_costDirectLineId_idx" ON "Procurement"("costDirectLineId");
CREATE INDEX "Procurement_costIndirectLineId_idx" ON "Procurement"("costIndirectLineId");
