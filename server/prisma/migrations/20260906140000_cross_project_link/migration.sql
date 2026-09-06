-- CreateTable
CREATE TABLE "CrossProjectLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "predecessorTaskId" TEXT NOT NULL,
    "successorTaskId" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'FS',
    "lagDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossProjectLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrossProjectLink_predecessorTaskId_successorTaskId_key" ON "CrossProjectLink"("predecessorTaskId", "successorTaskId");

-- CreateIndex
CREATE INDEX "CrossProjectLink_tenantId_idx" ON "CrossProjectLink"("tenantId");

-- CreateIndex
CREATE INDEX "CrossProjectLink_successorTaskId_idx" ON "CrossProjectLink"("successorTaskId");

-- CreateIndex
CREATE INDEX "CrossProjectLink_predecessorTaskId_idx" ON "CrossProjectLink"("predecessorTaskId");
