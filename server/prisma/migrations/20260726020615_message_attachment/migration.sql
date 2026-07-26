-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "attachmentKey" TEXT,
ADD COLUMN     "attachmentMime" TEXT,
ADD COLUMN     "attachmentName" TEXT,
ADD COLUMN     "attachmentSize" INTEGER;

