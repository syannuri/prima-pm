-- AlterTable
ALTER TABLE "CostItemDirect" ADD COLUMN     "resourceId" TEXT;

-- AddForeignKey
ALTER TABLE "CostItemDirect" ADD CONSTRAINT "CostItemDirect_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
