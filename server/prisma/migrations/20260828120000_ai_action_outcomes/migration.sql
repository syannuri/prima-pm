-- CreateEnum
CREATE TYPE "AiOutcomeVerdict" AS ENUM ('PENDING', 'IMPROVED', 'UNCHANGED', 'WORSENED', 'INCONCLUSIVE', 'ADVISORY');

-- CreateTable
CREATE TABLE "AiActionOutcome" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "projectId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "scored" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3) NOT NULL,
    "evalDueAt" TIMESTAMP(3) NOT NULL,
    "spiBefore" DOUBLE PRECISION,
    "cpiBefore" DOUBLE PRECISION,
    "progressBefore" DOUBLE PRECISION,
    "spiAfter" DOUBLE PRECISION,
    "cpiAfter" DOUBLE PRECISION,
    "progressAfter" DOUBLE PRECISION,
    "spiDelta" DOUBLE PRECISION,
    "measuredAt" TIMESTAMP(3),
    "verdict" "AiOutcomeVerdict" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiActionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiActionOutcome_proposalId_key" ON "AiActionOutcome"("proposalId");

-- CreateIndex
CREATE INDEX "AiActionOutcome_tenantId_idx" ON "AiActionOutcome"("tenantId");

-- CreateIndex
CREATE INDEX "AiActionOutcome_projectId_idx" ON "AiActionOutcome"("projectId");

-- CreateIndex
CREATE INDEX "AiActionOutcome_actionType_idx" ON "AiActionOutcome"("actionType");

-- CreateIndex
CREATE INDEX "AiActionOutcome_verdict_idx" ON "AiActionOutcome"("verdict");

-- AddForeignKey
ALTER TABLE "AiActionOutcome" ADD CONSTRAINT "AiActionOutcome_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionOutcome" ADD CONSTRAINT "AiActionOutcome_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionOutcome" ADD CONSTRAINT "AiActionOutcome_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "AiActionProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
