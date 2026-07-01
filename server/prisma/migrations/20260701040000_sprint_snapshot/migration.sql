-- CreateTable
CREATE TABLE "SprintSnapshot" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "committedPoints" INTEGER NOT NULL DEFAULT 0,
    "remainingPoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SprintSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SprintSnapshot_sprintId_idx" ON "SprintSnapshot"("sprintId");

-- CreateIndex
CREATE UNIQUE INDEX "SprintSnapshot_sprintId_date_key" ON "SprintSnapshot"("sprintId", "date");

-- AddForeignKey
ALTER TABLE "SprintSnapshot" ADD CONSTRAINT "SprintSnapshot_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

