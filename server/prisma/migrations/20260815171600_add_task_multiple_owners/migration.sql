-- Multiple owners per task. `TaskOwner` is the full owner set (lead + co-owners);
-- the LEAD owner remains `Task.picResourceId` (which is also inserted here).

-- CreateTable
CREATE TABLE "TaskOwner" (
    "taskId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,

    CONSTRAINT "TaskOwner_pkey" PRIMARY KEY ("taskId","resourceId")
);

-- CreateIndex
CREATE INDEX "TaskOwner_resourceId_idx" ON "TaskOwner"("resourceId");

-- AddForeignKey
ALTER TABLE "TaskOwner" ADD CONSTRAINT "TaskOwner_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOwner" ADD CONSTRAINT "TaskOwner_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: the existing single owner becomes the task's (lead) owner link.
INSERT INTO "TaskOwner" ("taskId", "resourceId")
SELECT "id", "picResourceId" FROM "Task" WHERE "picResourceId" IS NOT NULL;
