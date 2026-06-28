-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('NAMED', 'GENERIC');

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resourceType" "ResourceType" NOT NULL DEFAULT 'NAMED',
    "roleTitle" TEXT,
    "personnelRole" "PersonnelRole" NOT NULL DEFAULT 'PROJECT_PERSONNEL',
    "rateCardId" TEXT,
    "unitCostPerManday" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "capacityPerDay" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "department" TEXT,
    "userId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Resource_isActive_idx" ON "Resource"("isActive");

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
