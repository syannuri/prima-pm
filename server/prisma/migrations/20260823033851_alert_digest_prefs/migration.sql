-- CreateEnum
CREATE TYPE "DigestFrequency" AS ENUM ('OFF', 'DAILY', 'WEEKLY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "digestFrequency" "DigestFrequency" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "digestLastSentAt" TIMESTAMP(3);
