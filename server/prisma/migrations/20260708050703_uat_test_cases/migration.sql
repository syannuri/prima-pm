-- CreateEnum
CREATE TYPE "UatStatus" AS ENUM ('NOT_RUN', 'PASS', 'FAIL', 'BLOCKED');

-- CreateTable
CREATE TABLE "UatTestCase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scenario" TEXT,
    "steps" TEXT,
    "expected" TEXT NOT NULL,
    "actual" TEXT,
    "status" "UatStatus" NOT NULL DEFAULT 'NOT_RUN',
    "testerName" TEXT,
    "executedAt" TIMESTAMP(3),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UatTestCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UatTestCase_projectId_idx" ON "UatTestCase"("projectId");

-- AddForeignKey
ALTER TABLE "UatTestCase" ADD CONSTRAINT "UatTestCase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
