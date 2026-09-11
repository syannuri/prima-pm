-- CreateTable
CREATE TABLE "AiJudgeSample" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "feature" TEXT NOT NULL DEFAULT 'assistant_qa',
    "model" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "groundedness" INTEGER NOT NULL,
    "helpfulness" INTEGER NOT NULL,
    "clarity" INTEGER NOT NULL,
    "overall" DOUBLE PRECISION NOT NULL,
    "pass" BOOLEAN NOT NULL,
    "rationale" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiJudgeSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiJudgeSample_tenantId_createdAt_idx" ON "AiJudgeSample"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiJudgeSample" ADD CONSTRAINT "AiJudgeSample_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
