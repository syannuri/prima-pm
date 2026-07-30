-- AlterTable
ALTER TABLE "AcceptanceSignoff" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ActualCostEntry" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "AppSetting" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Assumption" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "BacklogItem" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ChangeRequest" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "CharterVersion" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ConversationMember" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "CostBaseline" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "CostItemDirect" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "CostItemIndirect" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "EvmSnapshot" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "KickoffActionItem" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "KickoffAttendee" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "KickoffMeeting" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "LessonLearned" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "MandayEntry" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "MessageReaction" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Procurement" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ProjectBookmark" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ProjectCharter" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ProjectDependency" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "RateCard" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "RequirementTaskLink" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Risk" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Sprint" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "SprintSnapshot" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Stakeholder" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "TaskDependency" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "UatTestCase" ADD COLUMN     "tenantId" TEXT;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBookmark" ADD CONSTRAINT "ProjectBookmark_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCharter" ADD CONSTRAINT "ProjectCharter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharterVersion" ADD CONSTRAINT "CharterVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostItemDirect" ADD CONSTRAINT "CostItemDirect_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostItemIndirect" ADD CONSTRAINT "CostItemIndirect_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostBaseline" ADD CONSTRAINT "CostBaseline_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActualCostEntry" ADD CONSTRAINT "ActualCostEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MandayEntry" ADD CONSTRAINT "MandayEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stakeholder" ADD CONSTRAINT "Stakeholder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procurement" ADD CONSTRAINT "Procurement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assumption" ADD CONSTRAINT "Assumption_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDependency" ADD CONSTRAINT "ProjectDependency_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintSnapshot" ADD CONSTRAINT "SprintSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvmSnapshot" ADD CONSTRAINT "EvmSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonLearned" ADD CONSTRAINT "LessonLearned_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceSignoff" ADD CONSTRAINT "AcceptanceSignoff_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UatTestCase" ADD CONSTRAINT "UatTestCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KickoffMeeting" ADD CONSTRAINT "KickoffMeeting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KickoffAttendee" ADD CONSTRAINT "KickoffAttendee_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KickoffActionItem" ADD CONSTRAINT "KickoffActionItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementTaskLink" ADD CONSTRAINT "RequirementTaskLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- Phase-2a data backfill (see docs/MULTITENANCY-POOLED-PLAN.md): stamp tenantId onto
-- every scoped row. Roots -> the single default tenant; project-children -> their
-- Project's tenantId; a few grandchildren -> their already-stamped parent. Runs after
-- the Phase-1 seed so the default tenant exists. Idempotent (guarded by IS NULL).
-- Column stays NULLABLE this phase; NOT NULL + indexes + unique swaps come in 2b.
-- =====================================================================

-- Roots -> default tenant
UPDATE "Project" SET "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'default') WHERE "tenantId" IS NULL;
UPDATE "ProjectBookmark" SET "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'default') WHERE "tenantId" IS NULL;
UPDATE "RateCard" SET "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'default') WHERE "tenantId" IS NULL;
UPDATE "Resource" SET "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'default') WHERE "tenantId" IS NULL;
UPDATE "AuditLog" SET "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'default') WHERE "tenantId" IS NULL;
UPDATE "Notification" SET "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'default') WHERE "tenantId" IS NULL;
UPDATE "Conversation" SET "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'default') WHERE "tenantId" IS NULL;
UPDATE "ConversationMember" SET "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'default') WHERE "tenantId" IS NULL;
UPDATE "Message" SET "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'default') WHERE "tenantId" IS NULL;
UPDATE "PushSubscription" SET "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'default') WHERE "tenantId" IS NULL;
UPDATE "MessageReaction" SET "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'default') WHERE "tenantId" IS NULL;
UPDATE "AppSetting" SET "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'default') WHERE "tenantId" IS NULL;

-- Project-children -> Project.tenantId
UPDATE "ProjectCharter" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "CharterVersion" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "CostItemDirect" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "CostItemIndirect" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "CostBaseline" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "ActualCostEntry" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "MandayEntry" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "Risk" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "Issue" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "Stakeholder" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "Procurement" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "Assumption" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "ProjectDependency" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "Task" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "ChangeRequest" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "Sprint" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "EvmSnapshot" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "BacklogItem" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "LessonLearned" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "AcceptanceSignoff" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "UatTestCase" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "KickoffMeeting" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;
UPDATE "Requirement" x SET "tenantId" = p."tenantId" FROM "Project" p WHERE x."projectId" = p."id" AND x."tenantId" IS NULL;

-- Grandchildren -> parent's already-stamped tenantId
UPDATE "TaskDependency" x SET "tenantId" = q."tenantId" FROM "Task" q WHERE x."predecessorId" = q."id" AND x."tenantId" IS NULL;
UPDATE "Attachment" x SET "tenantId" = q."tenantId" FROM "Project" q WHERE x."projectRelId" = q."id" AND x."tenantId" IS NULL;
UPDATE "SprintSnapshot" x SET "tenantId" = q."tenantId" FROM "Sprint" q WHERE x."sprintId" = q."id" AND x."tenantId" IS NULL;
UPDATE "KickoffAttendee" x SET "tenantId" = q."tenantId" FROM "KickoffMeeting" q WHERE x."meetingId" = q."id" AND x."tenantId" IS NULL;
UPDATE "KickoffActionItem" x SET "tenantId" = q."tenantId" FROM "KickoffMeeting" q WHERE x."meetingId" = q."id" AND x."tenantId" IS NULL;
UPDATE "RequirementTaskLink" x SET "tenantId" = q."tenantId" FROM "Requirement" q WHERE x."requirementId" = q."id" AND x."tenantId" IS NULL;
