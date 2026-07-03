-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "closureNote" TEXT;
