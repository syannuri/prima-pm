-- CreateTable
CREATE TABLE "ScheduleUndo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "projectId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ids" TEXT[],
    "removedJson" JSONB NOT NULL,
    "sigBefore" TEXT NOT NULL,
    "sigAfter" TEXT NOT NULL,
    "undone" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleUndo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleUndo_projectId_seq_idx" ON "ScheduleUndo"("projectId", "seq");

-- CreateIndex
CREATE INDEX "ScheduleUndo_tenantId_idx" ON "ScheduleUndo"("tenantId");

-- AddForeignKey
ALTER TABLE "ScheduleUndo" ADD CONSTRAINT "ScheduleUndo_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleUndo" ADD CONSTRAINT "ScheduleUndo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
