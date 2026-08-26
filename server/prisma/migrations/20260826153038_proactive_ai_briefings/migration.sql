-- CreateEnum
CREATE TYPE "AiBriefingStatus" AS ENUM ('PENDING', 'APPLIED', 'DISMISSED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "aiProactiveEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AiBriefing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "projectId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "status" "AiBriefingStatus" NOT NULL DEFAULT 'PENDING',
    "execSummary" TEXT,
    "highlights" TEXT,
    "lowlights" TEXT,
    "nextFocus" TEXT,
    "slipLevel" TEXT,
    "slipScore" INTEGER,
    "overrunLevel" TEXT,
    "overrunScore" INTEGER,
    "model" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiBriefing_tenantId_idx" ON "AiBriefing"("tenantId");

-- CreateIndex
CREATE INDEX "AiBriefing_projectId_status_idx" ON "AiBriefing"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiBriefing_projectId_period_periodKey_key" ON "AiBriefing"("projectId", "period", "periodKey");

-- AddForeignKey
ALTER TABLE "AiBriefing" ADD CONSTRAINT "AiBriefing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBriefing" ADD CONSTRAINT "AiBriefing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
