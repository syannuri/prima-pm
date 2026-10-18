-- Anett elevation #4: follow-up chip click telemetry. Tenant-scoped (plain tenantId, no FK — mirrors
-- ChunkEmbedding); best-effort write.
CREATE TABLE "AiFollowupEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "kind" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiFollowupEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiFollowupEvent_tenantId_createdAt_idx" ON "AiFollowupEvent"("tenantId", "createdAt");
