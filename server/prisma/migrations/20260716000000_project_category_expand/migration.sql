-- AlterEnum: expand ProjectCategory with data/integration/services/facility categories + OTHER catch-all
ALTER TYPE "ProjectCategory" ADD VALUE 'DATACENTER';
ALTER TYPE "ProjectCategory" ADD VALUE 'ENTERPRISE_APP';
ALTER TYPE "ProjectCategory" ADD VALUE 'SYSTEM_INTEGRATION';
ALTER TYPE "ProjectCategory" ADD VALUE 'DATA_ANALYTICS';
ALTER TYPE "ProjectCategory" ADD VALUE 'AI_ML';
ALTER TYPE "ProjectCategory" ADD VALUE 'DIGITAL_TRANSFORMATION';
ALTER TYPE "ProjectCategory" ADD VALUE 'MANAGED_SERVICES';
ALTER TYPE "ProjectCategory" ADD VALUE 'IT_CONSULTING';
ALTER TYPE "ProjectCategory" ADD VALUE 'OTHER';

-- AlterTable: free-text sub-category detail, populated only when category = OTHER
ALTER TABLE "Project" ADD COLUMN     "categoryOther" TEXT;

-- AlterTable
ALTER TABLE "ProjectCharter" ADD COLUMN     "categoryOther" TEXT;
