-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "picResourceId" TEXT;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_picResourceId_fkey" FOREIGN KEY ("picResourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
