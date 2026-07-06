-- CreateTable
CREATE TABLE "EvmSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "statusDate" DATE NOT NULL,
    "bac" DECIMAL(18,2) NOT NULL,
    "pv" DECIMAL(18,2) NOT NULL,
    "ev" DECIMAL(18,2) NOT NULL,
    "ac" DECIMAL(18,2) NOT NULL,
    "cpi" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spi" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weightedProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvmSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvmSnapshot_projectId_statusDate_idx" ON "EvmSnapshot"("projectId", "statusDate");

-- CreateIndex
CREATE UNIQUE INDEX "EvmSnapshot_projectId_statusDate_key" ON "EvmSnapshot"("projectId", "statusDate");

-- AddForeignKey
ALTER TABLE "EvmSnapshot" ADD CONSTRAINT "EvmSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
