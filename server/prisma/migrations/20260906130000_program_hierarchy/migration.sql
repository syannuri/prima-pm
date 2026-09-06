-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sponsor" TEXT,
    "managerUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Program_tenantId_idx" ON "Program"("tenantId");

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "programId" TEXT;

-- CreateIndex
CREATE INDEX "Project_programId_idx" ON "Project"("programId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;
