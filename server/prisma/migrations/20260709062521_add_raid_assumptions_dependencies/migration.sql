-- CreateEnum
CREATE TYPE "AssumptionStatus" AS ENUM ('OPEN', 'VALIDATED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "DependencyDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "DependencyStatus" AS ENUM ('PENDING', 'ON_TRACK', 'AT_RISK', 'RESOLVED');

-- CreateTable
CREATE TABLE "Assumption" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "category" TEXT,
    "status" "AssumptionStatus" NOT NULL DEFAULT 'OPEN',
    "impact" "IssueImpact" NOT NULL DEFAULT 'MEDIUM',
    "ownerUserId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDependency" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "direction" "DependencyDirection" NOT NULL DEFAULT 'INBOUND',
    "counterparty" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "DependencyStatus" NOT NULL DEFAULT 'PENDING',
    "impact" "IssueImpact" NOT NULL DEFAULT 'MEDIUM',
    "ownerUserId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Assumption_projectId_status_idx" ON "Assumption"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Assumption_projectId_code_key" ON "Assumption"("projectId", "code");

-- CreateIndex
CREATE INDEX "ProjectDependency_projectId_status_idx" ON "ProjectDependency"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDependency_projectId_code_key" ON "ProjectDependency"("projectId", "code");

-- AddForeignKey
ALTER TABLE "Assumption" ADD CONSTRAINT "Assumption_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assumption" ADD CONSTRAINT "Assumption_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDependency" ADD CONSTRAINT "ProjectDependency_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDependency" ADD CONSTRAINT "ProjectDependency_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
