-- Semantic-search vector cache (round-3 #1). Tenant-scoped; vector is plain JSONB (brute-force
-- cosine in Node), so no pgvector extension is required.
CREATE TABLE "ProjectEmbedding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "docHash" TEXT NOT NULL,
    "vector" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectEmbedding_projectId_key" ON "ProjectEmbedding"("projectId");
CREATE INDEX "ProjectEmbedding_tenantId_idx" ON "ProjectEmbedding"("tenantId");
