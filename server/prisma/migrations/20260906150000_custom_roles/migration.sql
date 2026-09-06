-- CreateTable
CREATE TABLE "CustomRole" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseRole" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_tenantId_name_key" ON "CustomRole"("tenantId", "name");

-- CreateIndex
CREATE INDEX "CustomRole_tenantId_idx" ON "CustomRole"("tenantId");

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "customRoleId" TEXT;
