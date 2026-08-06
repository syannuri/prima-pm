-- CreateTable
CREATE TABLE "ProjectCommentary" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "projectId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "highlights" TEXT,
    "lowlights" TEXT,
    "nextFocus" TEXT,
    "authorId" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCommentary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectCommentary_tenantId_idx" ON "ProjectCommentary"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCommentary_projectId_period_periodKey_key" ON "ProjectCommentary"("projectId", "period", "periodKey");

-- AddForeignKey
ALTER TABLE "ProjectCommentary" ADD CONSTRAINT "ProjectCommentary_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCommentary" ADD CONSTRAINT "ProjectCommentary_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
