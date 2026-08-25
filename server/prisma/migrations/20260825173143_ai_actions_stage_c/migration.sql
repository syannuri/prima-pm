-- CreateEnum
CREATE TYPE "AiActionStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'FAILED');

-- AlterEnum
ALTER TYPE "ApprovalAppliesTo" ADD VALUE 'AI_ACTION';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "aiActionsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AiActionProposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "projectId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "rationale" TEXT,
    "confidence" TEXT,
    "status" "AiActionStatus" NOT NULL DEFAULT 'PENDING',
    "proposedById" TEXT,
    "failureNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "AiActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiActionProposal_tenantId_idx" ON "AiActionProposal"("tenantId");

-- CreateIndex
CREATE INDEX "AiActionProposal_projectId_idx" ON "AiActionProposal"("projectId");

-- CreateIndex
CREATE INDEX "AiActionProposal_status_idx" ON "AiActionProposal"("status");

-- AddForeignKey
ALTER TABLE "AiActionProposal" ADD CONSTRAINT "AiActionProposal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionProposal" ADD CONSTRAINT "AiActionProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
