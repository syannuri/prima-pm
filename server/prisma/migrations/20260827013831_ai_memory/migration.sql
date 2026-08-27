-- CreateEnum
CREATE TYPE "AiMemoryScope" AS ENUM ('USER', 'TENANT');

-- CreateEnum
CREATE TYPE "AiMemoryKind" AS ENUM ('PREFERENCE', 'FACT', 'GLOSSARY', 'GUIDANCE');

-- CreateEnum
CREATE TYPE "AiMemorySource" AS ENUM ('EXPLICIT', 'FEEDBACK', 'AUTO');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "aiMemoryEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AiMemory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "scope" "AiMemoryScope" NOT NULL,
    "userId" TEXT,
    "kind" "AiMemoryKind" NOT NULL DEFAULT 'FACT',
    "content" TEXT NOT NULL,
    "source" "AiMemorySource" NOT NULL DEFAULT 'EXPLICIT',
    "sourceRef" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdByName" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiMemory_tenantId_idx" ON "AiMemory"("tenantId");

-- CreateIndex
CREATE INDEX "AiMemory_tenantId_scope_userId_active_idx" ON "AiMemory"("tenantId", "scope", "userId", "active");

-- AddForeignKey
ALTER TABLE "AiMemory" ADD CONSTRAINT "AiMemory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
