// The 44 tenant-scoped Prisma models (see docs/MULTITENANCY-POOLED-PLAN.md). Every one carries a
// `tenantId` column (Phase 2). The tenant extension injects `where.tenantId` / stamps it on create
// for exactly these. Global identity models — User, Tenant, Membership, RefreshToken — are NOT
// here and are never tenant-filtered. Model names are the Prisma PascalCase names (the `model`
// value in a client extension). Keep in sync with the schema; the extension asserts membership.
export const SCOPED_MODELS: ReadonlySet<string> = new Set([
  // roots (tenantId -> owning tenant directly)
  'Project', 'ProjectBookmark', 'RateCard', 'Resource', 'AuditLog', 'Notification', 'Feedback',
  'Conversation', 'ConversationMember', 'Message', 'PushSubscription', 'MessageReaction',
  'AppSetting', 'ApiKey', 'WebhookSubscription', 'WebhookDelivery', 'AutomationRule',
  'ApprovalWorkflow', 'ApprovalRequest', 'ApprovalDelegation', 'AiActionProposal',
  // project-children / grandchildren (tenantId denormalized from Project)
  'ProjectCharter', 'CharterVersion', 'BaselineVersion', 'CostItemDirect', 'CostItemIndirect', 'CostBaseline',
  'ActualCostEntry', 'MandayEntry', 'Risk', 'Issue', 'Stakeholder', 'Procurement', 'Assumption',
  'ProjectDependency', 'Task', 'TaskStep', 'TaskDependency', 'ChangeRequest', 'Attachment', 'Sprint',
  'SprintSnapshot', 'EvmSnapshot', 'BacklogItem', 'LessonLearned', 'AcceptanceSignoff',
  'UatTestCase', 'KickoffMeeting', 'KickoffAttendee', 'KickoffActionItem', 'Requirement',
  'RequirementTaskLink', 'ProjectCommentary',
]);
