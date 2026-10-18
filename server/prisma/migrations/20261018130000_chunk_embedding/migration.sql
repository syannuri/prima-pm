-- RAG v2: chunk-level embedding cache. Tenant-scoped; vector is plain JSONB (brute-force cosine in
-- Node), so no pgvector extension is required. One row per source entity (charter section / risk /
-- CR / lesson / issue / task / cost line).
CREATE TABLE "ChunkEmbedding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "docHash" TEXT NOT NULL,
    "vector" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChunkEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChunkEmbedding_projectId_entityType_entityId_key" ON "ChunkEmbedding"("projectId", "entityType", "entityId");
CREATE INDEX "ChunkEmbedding_tenantId_projectId_idx" ON "ChunkEmbedding"("tenantId", "projectId");
