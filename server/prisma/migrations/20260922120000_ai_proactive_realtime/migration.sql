-- Event-driven proactive (Phase 2). A sub-opt-in on top of aiProactiveEnabled + a lightweight trigger
-- queue. Default false ⇒ dormant-by-default; existing tenants are unaffected until they opt in.
ALTER TABLE "Tenant" ADD COLUMN "aiProactiveRealtime" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AiProactiveTrigger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AiProactiveTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiProactiveTrigger_tenantId_idx" ON "AiProactiveTrigger"("tenantId");

-- CreateIndex
CREATE INDEX "AiProactiveTrigger_projectId_processedAt_idx" ON "AiProactiveTrigger"("projectId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiProactiveTrigger_projectId_kind_dayKey_key" ON "AiProactiveTrigger"("projectId", "kind", "dayKey");

-- AddForeignKey
ALTER TABLE "AiProactiveTrigger" ADD CONSTRAINT "AiProactiveTrigger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProactiveTrigger" ADD CONSTRAINT "AiProactiveTrigger_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
