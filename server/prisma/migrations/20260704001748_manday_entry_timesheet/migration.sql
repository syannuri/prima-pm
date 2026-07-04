-- CreateTable
CREATE TABLE "MandayEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "costItemId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "mandays" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MandayEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MandayEntry_projectId_date_idx" ON "MandayEntry"("projectId", "date");

-- CreateIndex
CREATE INDEX "MandayEntry_costItemId_idx" ON "MandayEntry"("costItemId");

-- AddForeignKey
ALTER TABLE "MandayEntry" ADD CONSTRAINT "MandayEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MandayEntry" ADD CONSTRAINT "MandayEntry_costItemId_fkey" FOREIGN KEY ("costItemId") REFERENCES "CostItemDirect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
