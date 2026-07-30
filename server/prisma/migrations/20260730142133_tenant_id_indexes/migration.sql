-- CreateIndex
CREATE INDEX "AcceptanceSignoff_tenantId_idx" ON "AcceptanceSignoff"("tenantId");

-- CreateIndex
CREATE INDEX "ActualCostEntry_tenantId_idx" ON "ActualCostEntry"("tenantId");

-- CreateIndex
CREATE INDEX "AppSetting_tenantId_idx" ON "AppSetting"("tenantId");

-- CreateIndex
CREATE INDEX "Assumption_tenantId_idx" ON "Assumption"("tenantId");

-- CreateIndex
CREATE INDEX "Attachment_tenantId_idx" ON "Attachment"("tenantId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "BacklogItem_tenantId_idx" ON "BacklogItem"("tenantId");

-- CreateIndex
CREATE INDEX "ChangeRequest_tenantId_idx" ON "ChangeRequest"("tenantId");

-- CreateIndex
CREATE INDEX "CharterVersion_tenantId_idx" ON "CharterVersion"("tenantId");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_idx" ON "Conversation"("tenantId");

-- CreateIndex
CREATE INDEX "ConversationMember_tenantId_idx" ON "ConversationMember"("tenantId");

-- CreateIndex
CREATE INDEX "CostBaseline_tenantId_idx" ON "CostBaseline"("tenantId");

-- CreateIndex
CREATE INDEX "CostItemDirect_tenantId_idx" ON "CostItemDirect"("tenantId");

-- CreateIndex
CREATE INDEX "CostItemIndirect_tenantId_idx" ON "CostItemIndirect"("tenantId");

-- CreateIndex
CREATE INDEX "EvmSnapshot_tenantId_idx" ON "EvmSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "Issue_tenantId_idx" ON "Issue"("tenantId");

-- CreateIndex
CREATE INDEX "KickoffActionItem_tenantId_idx" ON "KickoffActionItem"("tenantId");

-- CreateIndex
CREATE INDEX "KickoffAttendee_tenantId_idx" ON "KickoffAttendee"("tenantId");

-- CreateIndex
CREATE INDEX "KickoffMeeting_tenantId_idx" ON "KickoffMeeting"("tenantId");

-- CreateIndex
CREATE INDEX "LessonLearned_tenantId_idx" ON "LessonLearned"("tenantId");

-- CreateIndex
CREATE INDEX "MandayEntry_tenantId_idx" ON "MandayEntry"("tenantId");

-- CreateIndex
CREATE INDEX "Message_tenantId_idx" ON "Message"("tenantId");

-- CreateIndex
CREATE INDEX "MessageReaction_tenantId_idx" ON "MessageReaction"("tenantId");

-- CreateIndex
CREATE INDEX "Notification_tenantId_idx" ON "Notification"("tenantId");

-- CreateIndex
CREATE INDEX "Procurement_tenantId_idx" ON "Procurement"("tenantId");

-- CreateIndex
CREATE INDEX "Project_tenantId_idx" ON "Project"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectBookmark_tenantId_idx" ON "ProjectBookmark"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectCharter_tenantId_idx" ON "ProjectCharter"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectDependency_tenantId_idx" ON "ProjectDependency"("tenantId");

-- CreateIndex
CREATE INDEX "PushSubscription_tenantId_idx" ON "PushSubscription"("tenantId");

-- CreateIndex
CREATE INDEX "RateCard_tenantId_idx" ON "RateCard"("tenantId");

-- CreateIndex
CREATE INDEX "Requirement_tenantId_idx" ON "Requirement"("tenantId");

-- CreateIndex
CREATE INDEX "RequirementTaskLink_tenantId_idx" ON "RequirementTaskLink"("tenantId");

-- CreateIndex
CREATE INDEX "Resource_tenantId_idx" ON "Resource"("tenantId");

-- CreateIndex
CREATE INDEX "Risk_tenantId_idx" ON "Risk"("tenantId");

-- CreateIndex
CREATE INDEX "Sprint_tenantId_idx" ON "Sprint"("tenantId");

-- CreateIndex
CREATE INDEX "SprintSnapshot_tenantId_idx" ON "SprintSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "Stakeholder_tenantId_idx" ON "Stakeholder"("tenantId");

-- CreateIndex
CREATE INDEX "Task_tenantId_idx" ON "Task"("tenantId");

-- CreateIndex
CREATE INDEX "TaskDependency_tenantId_idx" ON "TaskDependency"("tenantId");

-- CreateIndex
CREATE INDEX "UatTestCase_tenantId_idx" ON "UatTestCase"("tenantId");
