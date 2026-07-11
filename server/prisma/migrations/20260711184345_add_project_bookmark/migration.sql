-- CreateTable
CREATE TABLE "ProjectBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectBookmark_userId_idx" ON "ProjectBookmark"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBookmark_userId_projectId_key" ON "ProjectBookmark"("userId", "projectId");

-- AddForeignKey
ALTER TABLE "ProjectBookmark" ADD CONSTRAINT "ProjectBookmark_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
