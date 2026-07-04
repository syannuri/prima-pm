-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "baselineLockedAt" TIMESTAMP(3),
ADD COLUMN     "baselineLockedById" TEXT;
