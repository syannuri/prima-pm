-- CreateEnum
CREATE TYPE "AiFeedbackRating" AS ENUM ('UP', 'DOWN');

-- CreateTable
CREATE TABLE "AiFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "rating" "AiFeedbackRating" NOT NULL,
    "question" TEXT,
    "answer" TEXT NOT NULL,
    "note" TEXT,
    "projectId" TEXT,
    "memoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiFeedback_tenantId_idx" ON "AiFeedback"("tenantId");

-- CreateIndex
CREATE INDEX "AiFeedback_tenantId_rating_createdAt_idx" ON "AiFeedback"("tenantId", "rating", "createdAt");

-- AddForeignKey
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
