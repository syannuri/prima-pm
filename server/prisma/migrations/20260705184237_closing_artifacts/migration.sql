-- CreateEnum
CREATE TYPE "LessonCategory" AS ENUM ('WENT_WELL', 'WENT_WRONG', 'RECOMMENDATION');

-- CreateEnum
CREATE TYPE "AcceptanceDecision" AS ENUM ('ACCEPTED', 'ACCEPTED_WITH_CONDITIONS', 'REJECTED');

-- CreateTable
CREATE TABLE "LessonLearned" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" "LessonCategory" NOT NULL DEFAULT 'RECOMMENDATION',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonLearned_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcceptanceSignoff" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "decision" "AcceptanceDecision" NOT NULL DEFAULT 'ACCEPTED',
    "signedByName" TEXT,
    "comments" TEXT,
    "recordedById" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcceptanceSignoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonLearned_projectId_idx" ON "LessonLearned"("projectId");

-- CreateIndex
CREATE INDEX "AcceptanceSignoff_projectId_idx" ON "AcceptanceSignoff"("projectId");

-- AddForeignKey
ALTER TABLE "LessonLearned" ADD CONSTRAINT "LessonLearned_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceSignoff" ADD CONSTRAINT "AcceptanceSignoff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
