-- Combined baseline (schedule + cost) version history — captured at each baseline LOCK.
-- Tenant-scoped like CharterVersion; additive only.

-- CreateTable
CREATE TABLE "BaselineVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT,
    "committedBy" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "schedule" JSONB NOT NULL,
    "cost" JSONB NOT NULL,

    CONSTRAINT "BaselineVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BaselineVersion_projectId_idx" ON "BaselineVersion"("projectId");

-- CreateIndex
CREATE INDEX "BaselineVersion_tenantId_idx" ON "BaselineVersion"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BaselineVersion_projectId_version_key" ON "BaselineVersion"("projectId", "version");

-- AddForeignKey
ALTER TABLE "BaselineVersion" ADD CONSTRAINT "BaselineVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaselineVersion" ADD CONSTRAINT "BaselineVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
