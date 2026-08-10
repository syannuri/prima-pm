-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "escalatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ApprovalStep" ADD COLUMN     "slaHours" INTEGER;

-- AlterTable
ALTER TABLE "ApprovalWorkflow" ADD COLUMN     "escalationUserId" TEXT;

-- CreateTable
CREATE TABLE "ApprovalDelegation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalDelegation_tenantId_idx" ON "ApprovalDelegation"("tenantId");

-- CreateIndex
CREATE INDEX "ApprovalDelegation_fromUserId_idx" ON "ApprovalDelegation"("fromUserId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_dueAt_idx" ON "ApprovalRequest"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
