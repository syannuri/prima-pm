-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "scheduleBaselinedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "baselineFinish" TIMESTAMP(3),
ADD COLUMN     "baselineStart" TIMESTAMP(3);
