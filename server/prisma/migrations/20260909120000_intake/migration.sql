-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DEFERRED', 'CONVERTED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "intakeWeights" JSONB;

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "requestedByUserId" TEXT,
    "sponsor" TEXT,
    "clientName" TEXT,
    "category" "ProjectCategory",
    "categoryOther" TEXT,
    "deliveryApproach" "DeliveryApproach" NOT NULL DEFAULT 'PREDICTIVE',
    "estCostIdr" DECIMAL(18,2),
    "estRevenueIdr" DECIMAL(18,2),
    "targetStart" TIMESTAMP(3),
    "targetFinish" TIMESTAMP(3),
    "programId" TEXT,
    "scoreStrategic" INTEGER,
    "scoreValue" INTEGER,
    "scoreRisk" INTEGER,
    "scoreCost" INTEGER,
    "scoreUrgency" INTEGER,
    "weightedScore" DECIMAL(8,2),
    "priorityRank" INTEGER,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "convertedProjectId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_convertedProjectId_key" ON "Proposal"("convertedProjectId");

-- CreateIndex
CREATE INDEX "Proposal_tenantId_idx" ON "Proposal"("tenantId");

-- CreateIndex
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");
