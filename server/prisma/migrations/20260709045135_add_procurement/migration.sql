-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('FIXED_PRICE', 'TIME_AND_MATERIALS', 'COST_PLUS', 'PURCHASE_ORDER');

-- CreateEnum
CREATE TYPE "ProcurementStatus" AS ENUM ('PLANNED', 'SOLICITATION', 'AWARDED', 'IN_PROGRESS', 'DELIVERED', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Procurement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "vendor" TEXT,
    "vendorContact" TEXT,
    "type" "ContractType" NOT NULL DEFAULT 'PURCHASE_ORDER',
    "status" "ProcurementStatus" NOT NULL DEFAULT 'PLANNED',
    "amount" DECIMAL(18,2),
    "needBy" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "scope" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Procurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Procurement_projectId_status_idx" ON "Procurement"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Procurement_projectId_code_key" ON "Procurement"("projectId", "code");

-- AddForeignKey
ALTER TABLE "Procurement" ADD CONSTRAINT "Procurement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
