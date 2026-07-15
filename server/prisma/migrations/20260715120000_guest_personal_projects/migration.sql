-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'GUEST';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "personalOwnerId" TEXT;
