-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('DIRECT', 'GROUP');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "type" "ConversationType" NOT NULL DEFAULT 'DIRECT',
ALTER COLUMN "userAId" DROP NOT NULL,
ALTER COLUMN "userBId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ConversationMember" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationMember_userId_idx" ON "ConversationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMember_conversationId_userId_key" ON "ConversationMember"("conversationId", "userId");

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: materialise ConversationMember rows for every existing (DIRECT) conversation,
-- carrying each side's legacy read cursor into the new per-member lastReadAt.
INSERT INTO "ConversationMember" ("id", "conversationId", "userId", "lastReadAt", "isAdmin", "createdAt")
SELECT gen_random_uuid(), "id", "userAId", "lastReadAAt", false, "createdAt" FROM "Conversation" WHERE "userAId" IS NOT NULL
UNION ALL
SELECT gen_random_uuid(), "id", "userBId", "lastReadBAt", false, "createdAt" FROM "Conversation" WHERE "userBId" IS NOT NULL;
