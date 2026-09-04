-- CreateEnum
CREATE TYPE "AiBatchStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "AiBatch" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "feature" TEXT NOT NULL DEFAULT 'proactive',
    "status" "AiBatchStatus" NOT NULL DEFAULT 'PENDING',
    "mapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AiBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiBatch_batchId_key" ON "AiBatch"("batchId");

-- CreateIndex
CREATE INDEX "AiBatch_status_idx" ON "AiBatch"("status");
