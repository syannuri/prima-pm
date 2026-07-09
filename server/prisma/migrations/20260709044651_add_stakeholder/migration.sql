-- CreateEnum
CREATE TYPE "StakeholderCategory" AS ENUM ('SPONSOR', 'CUSTOMER', 'TEAM', 'VENDOR', 'REGULATOR', 'END_USER', 'OTHER');

-- CreateEnum
CREATE TYPE "InfluenceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "EngagementLevel" AS ENUM ('UNAWARE', 'RESISTANT', 'NEUTRAL', 'SUPPORTIVE', 'LEADING');

-- CreateTable
CREATE TABLE "Stakeholder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "organization" TEXT,
    "category" "StakeholderCategory" NOT NULL DEFAULT 'OTHER',
    "power" "InfluenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "interest" "InfluenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "currentEngagement" "EngagementLevel" NOT NULL DEFAULT 'NEUTRAL',
    "desiredEngagement" "EngagementLevel" NOT NULL DEFAULT 'SUPPORTIVE',
    "email" TEXT,
    "strategy" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stakeholder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Stakeholder_projectId_idx" ON "Stakeholder"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Stakeholder_projectId_code_key" ON "Stakeholder"("projectId", "code");

-- AddForeignKey
ALTER TABLE "Stakeholder" ADD CONSTRAINT "Stakeholder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
