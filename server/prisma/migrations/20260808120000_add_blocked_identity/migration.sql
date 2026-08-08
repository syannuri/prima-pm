-- CreateTable
CREATE TABLE "BlockedIdentity" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "googleSub" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockedIdentity_email_key" ON "BlockedIdentity"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BlockedIdentity_googleSub_key" ON "BlockedIdentity"("googleSub");

-- CreateIndex
CREATE INDEX "BlockedIdentity_email_idx" ON "BlockedIdentity"("email");

-- CreateIndex
CREATE INDEX "BlockedIdentity_googleSub_idx" ON "BlockedIdentity"("googleSub");
