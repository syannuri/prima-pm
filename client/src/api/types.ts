export type Role =
  | 'ADMIN'
  | 'PMO'
  | 'PROJECT_MANAGER'
  | 'FINANCE'
  | 'RISK_OFFICER'
  | 'TEAM_MEMBER'
  | 'VIEWER'
  | 'GUEST';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  // Global platform (super-admin) privilege — gates the tenant-provisioning console.
  isPlatformAdmin?: boolean;
}

// Platform console — a tenant as seen by a super-admin (GET /admin/tenants).
export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING' | 'REJECTED';
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  customDomain: string | null;
  isPersonal: boolean;
  createdAt: string;
  updatedAt: string; // last change to the tenant record (rename / plan / status) — the "Updated" column
  memberCount: number;
  projectCount: number; // active (non-deleted) projects — for quota bars
  storageBytes: number; // total attachment bytes — for quota bars
}

// A recent platform (super-admin) event for the console activity feed. `before`/`after` carry the
// audit deltas; the client's describeActivity() turns them into a human sentence.
export interface PlatformActivity {
  id: string;
  createdAt: string;
  action: string;   // CREATE | UPDATE | DELETE | IMPERSONATE | EXPORT
  entity: string;   // Tenant | User | BlockedIdentity
  actorName: string | null;
  targetName: string | null;
  before: unknown;
  after: unknown;
}

export interface AdminUser extends User {
  isActive: boolean;
  createdAt: string;
}

// Pooled multitenancy — a tenant the current user belongs to (GET /auth/tenants) with their
// per-tenant role. `active` in the response marks which one the session is scoped to.
export type TenantPlan = 'FREE' | 'PRO' | 'ENTERPRISE';

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
  plan: TenantPlan;
  subscriptionStatus?: string | null;
}

// A member of the active tenant (GET /members) — the tenant-centric view of a user.
export interface TenantMember {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  role: Role;
  since: string;
}

// Admin-only global audit trail (GET /admin/audit).
export interface AuditEntry {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  createdAt: string;
  before: unknown | null;
  after: unknown | null;
  actor: { name: string; role: Role; email: string } | null;
  project: { code: string; name: string } | null;
  personal: boolean; // guest activity (personal project or a GUEST actor)
}

export type PersonnelRole = 'PM' | 'PROJECT_PERSONNEL';
export type ResourceType = 'NAMED' | 'GENERIC';

export interface RateCard {
  id: string;
  roleName: string;
  level: string | null;
  unitCostPerManday: string; // Decimal serialized as string
  isActive: boolean;
}

export interface ResourceItem {
  id: string;
  name: string;
  resourceType: ResourceType;
  roleTitle: string | null;
  personnelRole: PersonnelRole;
  rateCardId: string | null;
  rateCard?: { id: string; roleName: string; level: string | null; unitCostPerManday: string; isActive: boolean } | null;
  unitCostPerManday: string;
  capacityPerDay: string;
  department: string | null;
  userId: string | null;
  user?: { id: string; name: string; email: string } | null;
  isActive: boolean;
}

export type ProjectStatus = 'DRAFT' | 'CHARTERED' | 'IN_PROGRESS' | 'ON_HOLD' | 'CLOSED';
export type ProjectCategory =
  | 'NETWORK_INFRA'
  | 'SERVER_INFRA'
  | 'CLOUD_INFRA'
  | 'CYBERSECURITY_INFRA'
  | 'DATACENTER'
  | 'APP_DEV'
  | 'ENTERPRISE_APP'
  | 'SYSTEM_INTEGRATION'
  | 'DATA_ANALYTICS'
  | 'AI_ML'
  | 'DIGITAL_TRANSFORMATION'
  | 'MANAGED_SERVICES'
  | 'IT_CONSULTING'
  | 'OTHER';

export type DeliveryApproach = 'PREDICTIVE' | 'AGILE' | 'HYBRID';
export type BacklogType = 'EPIC' | 'STORY' | 'TASK' | 'BUG';
export type BacklogStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'DEFERRED';
export type SprintStatus = 'PLANNED' | 'ACTIVE' | 'CLOSED';

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  status: SprintStatus;
  sortOrder: number;
}
export interface BacklogItem {
  id: string;
  projectId: string;
  sprintId: string | null;
  type: BacklogType;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  storyPoints: number | null;
  priority: number;
  status: BacklogStatus;
  assigneeUserId: string | null;
  assignee: { id: string; name: string } | null;
  sortOrder: number;
}
export interface SprintSnapshot {
  id: string;
  sprintId: string;
  date: string;
  committedPoints: number;
  remainingPoints: number;
}
export interface AgileBoard { sprints: Sprint[]; items: BacklogItem[]; snapshots: SprintSnapshot[]; mandaysPerPoint: number }

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  projectId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  clientName: string | null;
  sponsor: string | null;
  category: ProjectCategory | null;
  categoryOther: string | null;
  deliveryApproach: DeliveryApproach;
  costBaselineIdr: string | null;
  totalRevenueIdr: string | null;
  status: ProjectStatus;
  pmUserId: string | null;
  // When set, this is a personal (guest) project owned by that user — sandboxed + self-governed.
  personalOwnerId?: string | null;
  closedAt?: string | null;
  closureNote?: string | null;
  onHoldReason?: string | null;
  baselineLockedAt?: string | null;
  archivedAt?: string | null;
  // PMO activation-review outcome: null (in queue / approved) | 'NEEDS_REVISION' | 'REJECTED'.
  activationReviewStatus?: string | null;
  activationReviewNote?: string | null;
  activationReviewAt?: string | null;
  pm?: { id: string; name: string; email: string } | null;
  charter?: { id: string; locked: boolean; version: number; category: ProjectCategory } | null;
  costBaseline?: { budgetAtCompletion: string } | null;
  changeCount?: number;
}

export interface ClosureItem {
  key: string;
  label: string;
  severity: 'block' | 'warn';
  ok: boolean;
  detail?: string;
}

export interface ClosureReadiness {
  items: ClosureItem[];
  blockers: ClosureItem[];
  warnings: ClosureItem[];
  canClose: boolean;
}

// Activation readiness reuses the same item shape as closure (block/warn checklist).
export type ActivationItem = ClosureItem;

export interface ActivationReadiness {
  items: ActivationItem[];
  blockers: ActivationItem[];
  warnings: ActivationItem[];
  canActivate: boolean;
}

// Rich activation-review summary for the PMO decision card (Scope / Budget / Schedule).
export interface ActivationReview {
  project: { id: string; code: string; name: string; status: ProjectStatus; deliveryApproach: DeliveryApproach };
  readiness: ActivationReadiness;
  review: { status: string | null; note: string | null; at: string | null; by: string | null };
  charter: {
    scope: string; deliverables: string; goals: string; description: string;
    hiCostIdr: number; start: string; end: string; committedAt: string | null;
  } | null;
  budget: {
    direct: number; indirect: number; contingency: number; managementReserve: number;
    bac: number; totalBudget: number;
  } | null;
  schedule: {
    deliveryApproach: DeliveryApproach; hasWbs: boolean;
    taskCount: number; milestoneCount: number; start: string | null; end: string | null; durationDays: number | null;
    scheduleBaselinedAt: string | null; sprintCount: number; backlogCount: number;
  };
}

// Guided next-step cues for a project's current lifecycle stage.
export interface NextStep {
  key: string;
  title: string;
  detail: string;
  tab?: string; // a ProjectPage tab to jump to
  action?: 'activate' | 'resume' | 'close'; // a header lifecycle control
}

export interface NextStepsResult {
  stage: string;
  steps: NextStep[];
}

// Closing artifacts (Closeout tab): lessons-learned register + acceptance sign-offs.
export type LessonCategory = 'WENT_WELL' | 'WENT_WRONG' | 'RECOMMENDATION';
export type AcceptanceDecision = 'ACCEPTED' | 'ACCEPTED_WITH_CONDITIONS' | 'REJECTED';

export interface LessonLearned {
  id: string;
  projectId: string;
  category: LessonCategory;
  title: string;
  description?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AcceptanceSignoff {
  id: string;
  projectId: string;
  party: string;
  decision: AcceptanceDecision;
  signedByName?: string | null;
  comments?: string | null;
  recordedById?: string | null;
  recordedByName?: string | null;
  signedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Charter {
  id: string;
  projectId: string;
  description: string;
  goals: string;
  category: ProjectCategory;
  categoryOther: string | null;
  hiScope: string;
  hiCostIdr: string;
  hiScheduleStart: string;
  hiScheduleEnd: string;
  hiDeliverables: string;
  pmUserId: string;
  version: number;
  locked: boolean;
  committedAt: string | null;
}

export interface CostBaseline {
  directTotal: string;
  indirectTotal: string;
  contingencyReserve: string;
  managementReserve: string;
  costBaseline: string;
  budgetAtCompletion: string;
}

export interface DirectCost {
  id: string;
  type: string;
  label: string;
  subCategory: string | null;
  sortOrder: number;
  qty: string | null;
  unitCost: string | null;
  amount: string | null;
  personnelRole: string | null;
  unitCostPerManday: string | null;
  planMandays: string | null;
  manpowerCost: string | null;
  taskId: string | null;
  resourceUserId: string | null;
  resource: { id: string; name: string } | null;
  resourceId: string | null;
  resourceRef: { id: string; name: string; resourceType: ResourceType } | null;
  // Per-component drawdown: spend booked to this line and what's left of its budget.
  // Manpower draws actualToDate from the timesheet; material lines from attributed Actual Cost.
  actualToDate: number;
  remaining: number;
  // Committed cost: value of awarded→delivered contracts charged to this line.
  committed: number;
  // Available (uncommitted) = budget − spent − committed.
  available: number;
}

export interface IndirectCost {
  id: string;
  type: string;
  description: string;
  subCategory: string | null;
  amount: string;
  // Per-component drawdown: spend booked to this line and what's left of its budget.
  actualToDate: number;
  remaining: number;
  // Committed cost: value of awarded→delivered contracts charged to this line.
  committed: number;
  // Available (uncommitted) = budget − spent − committed.
  available: number;
}

export interface ActualCostEntry {
  id: string;
  date: string;
  amount: string;
  description: string | null;
  category: 'DIRECT' | 'INDIRECT';
  // Optional per-component attribution to a budget line (at most one set).
  directLineId: string | null;
  indirectLineId: string | null;
}

export interface CostSummary {
  directCosts: DirectCost[];
  indirectCosts: IndirectCost[];
  baseline: CostBaseline | null;
  highLevelCharterCost: number | null;
  actualCosts: ActualCostEntry[];
  actualCostTotal: number;
  // Read-only reference: labour cost implied by logged timesheets (Σ consumed md × day-rate).
  // Does NOT feed AC/EVM — AC stays manual.
  labourActual: number;
  labourConsumedMandays: number;
  // Actual spend split by the budget it draws down (labour is always direct). Used for the
  // "remaining Direct / Indirect" summary; sums don't double-count the labour sentinel entry.
  directActual: number;
  indirectActual: number;
  // Spend not booked to any specific line (rolls up to the category bucket only).
  unattributedDirectActual: number;
  unattributedIndirectActual: number;
  // Committed cost: value of awarded→delivered contracts charged to budget lines.
  committedDirect: number;
  committedIndirect: number;
  committedTotal: number;
  // Available (uncommitted) budget = budget − spent − committed, per category + overall.
  availableDirect: number;
  availableIndirect: number;
  availableTotal: number;
  // When true, each man-day mutation auto-refreshes the labour AC entry (no manual "Fill AC").
  autoPostLabourAc: boolean;
}

export type CRStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

export type ChangeImpact = 'CHARTER' | 'COST' | 'SCHEDULE' | 'RESOURCE' | 'QUALITY' | 'RISK';

export interface ChangeRequest {
  id: string;
  type: string;
  title: string;
  description: string;
  chargeable: boolean;
  amountIdr: string | null;
  magnitude: 'MINOR' | 'MAJOR';
  impactAreas: ChangeImpact[];
  status: CRStatus;
  requestedBy: string;
  requester?: { name: string } | null;
  reviewedBy: string | null;
  reviewer?: { name: string } | null;
  reviewedAt: string | null;
  decidedBy: string | null;
  decider?: { name: string } | null;
  decidedAt: string | null;
  createdAt: string;
}

// A pending change request enriched with its project, for the PMO approvals panel.
export interface PendingApproval extends ChangeRequest {
  project: { id: string; code: string; name: string };
}

export interface CharterVersion {
  id: string;
  version: number;
  committedBy: string;
  committedAt: string;
}

export type PortfolioHealth = 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA';

export interface PortfolioRow {
  id: string;
  code: string;
  name: string;
  clientName: string | null;
  status: string;
  pm: string;
  category: string | null;
  bac: number;
  contingencyReserve: number;
  pv: number;
  ev: number;
  ac: number;
  spi: number;
  cpi: number;
  percentComplete: number;
  health: PortfolioHealth;
  costHealth: PortfolioHealth;
  finishVarianceDays: number | null;
  changeCount: number;
  scheduleProgress: number; // physical % complete from the WBS roll-up (0..1)
  resourceCount: number;
  planMandays: number;
  manpowerCost: number;
  plannedCost: number;
  revenue: number;
}

export interface PortfolioSummary {
  projects: PortfolioRow[];
  totals: { bac: number; contingencyReserve: number; pv: number; ev: number; ac: number; spi: number; cpi: number; percentComplete: number; scheduleProgress: number; count: number; baselinedCount: number; slippedCount: number; worstSlipDays: number };
  byStatus: Record<string, number>;
  byHealth: Record<string, number>;
  statusDate: string;
}

// Portfolio RAID roll-up (R5) — Risks/Assumptions/Issues/Dependencies across visible projects.
export interface PortfolioRaid {
  statusDate: string;
  projectCount: number;
  counts: { risks: number; risksHigh: number; assumptions: number; issues: number; dependencies: number; dependenciesAtRisk: number };
  risks: { project: string; code: string; title: string; severity: string; status: string; kind: string; emv: number; response: string | null; owner: string | null }[];
  assumptions: { project: string; code: string; statement: string; impact: string; category: string | null; owner: string | null }[];
  issues: { project: string; code: string; title: string; impact: string; status: string; ageDays: number; owner: string | null }[];
  dependencies: { project: string; code: string; description: string; direction: string; counterparty: string | null; status: string; impact: string; dueDate: string | null; overdue: boolean; owner: string | null }[];
}

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Risk {
  id: string;
  code: string;
  title: string;
  kind: 'THREAT' | 'OPPORTUNITY';
  status: string;
  probabilityScore: number;
  impactScore: number;
  riskScore: number;
  severity: Severity;
  probabilityPct: string;
  impactCostIdr: string;
  emv: string;
  responseStrategy: string | null;
  residualEmv: string | null;
  includeInReserve: boolean;
}

export interface RiskAnalysis {
  heatmap: { probability: number; impact: number; count: number; score: number }[];
  total: number;
  bySeverity: Record<Severity, number>;
  topByEmv: { id: string; code: string; title: string; emv: number }[];
  reserve: { threatReserve: number; opportunityOffset: number; confidenceFactor: number; contingencyReserve: number };
}

export type IssueImpact = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface Issue {
  id: string;
  code: string;
  title: string;
  description: string | null;
  category: string | null;
  impact: IssueImpact;
  status: IssueStatus;
  ownerUserId: string | null;
  owner?: { id: string; name: string } | null;
  resolution: string | null;
  raisedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Stakeholder management (PMBOK Stakeholder KA) ---
export type StakeholderCategory = 'SPONSOR' | 'CUSTOMER' | 'TEAM' | 'VENDOR' | 'REGULATOR' | 'END_USER' | 'OTHER';
export type InfluenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type EngagementLevel = 'UNAWARE' | 'RESISTANT' | 'NEUTRAL' | 'SUPPORTIVE' | 'LEADING';

export interface Stakeholder {
  id: string;
  code: string;
  name: string;
  role: string | null;
  organization: string | null;
  category: StakeholderCategory;
  power: InfluenceLevel;
  interest: InfluenceLevel;
  currentEngagement: EngagementLevel;
  desiredEngagement: EngagementLevel;
  email: string | null;
  strategy: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Procurement management (PMBOK Procurement KA) ---
export type ContractType = 'FIXED_PRICE' | 'TIME_AND_MATERIALS' | 'COST_PLUS' | 'PURCHASE_ORDER';
export type ProcurementStatus = 'PLANNED' | 'SOLICITATION' | 'AWARDED' | 'IN_PROGRESS' | 'DELIVERED' | 'CLOSED' | 'CANCELLED';

export interface Procurement {
  id: string;
  code: string;
  title: string;
  vendor: string | null;
  vendorContact: string | null;
  type: ContractType;
  status: ProcurementStatus;
  amount: number | null;
  needBy: string | null;
  startDate: string | null;
  endDate: string | null;
  scope: string | null;
  notes: string | null;
  // Committed-cost link: charged to one budget line (direct XOR indirect), or null.
  costDirectLineId: string | null;
  costIndirectLineId: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Requirements traceability (RTM: requirement ↔ WBS task) ---
export type RequirementCategory = 'FUNCTIONAL' | 'NON_FUNCTIONAL' | 'BUSINESS' | 'TECHNICAL' | 'REGULATORY' | 'OTHER';
export type RequirementPriority = 'MUST' | 'SHOULD' | 'COULD' | 'WONT'; // MoSCoW
export type RequirementStatus = 'PROPOSED' | 'APPROVED' | 'IN_PROGRESS' | 'VERIFIED' | 'DEFERRED' | 'REJECTED';

export interface RequirementTaskLink {
  id: string;
  taskId: string;
  task: { id: string; wbsCode: string; name: string; progressPct: number; isMilestone: boolean };
}

export interface Requirement {
  id: string;
  code: string;
  title: string;
  description: string | null;
  category: RequirementCategory;
  priority: RequirementPriority;
  status: RequirementStatus;
  source: string | null;
  acceptanceCriteria: string | null;
  notes: string | null;
  taskLinks: RequirementTaskLink[];
  createdAt: string;
  updatedAt: string;
}

export interface RequirementCoverage {
  total: number;
  covered: number;
  uncovered: number;
  verified: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
}

// --- RAID: Assumptions & Dependencies (completes RAID with Risk + Issue) ---
export type AssumptionStatus = 'OPEN' | 'VALIDATED' | 'INVALIDATED';
export interface Assumption {
  id: string;
  code: string;
  statement: string;
  category: string | null;
  status: AssumptionStatus;
  impact: IssueImpact;
  ownerUserId: string | null;
  owner?: { id: string; name: string } | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DependencyDirection = 'INBOUND' | 'OUTBOUND';
export type DependencyStatus = 'PENDING' | 'ON_TRACK' | 'AT_RISK' | 'RESOLVED';
export interface ProjectDependency {
  id: string;
  code: string;
  description: string;
  direction: DependencyDirection;
  counterparty: string | null;
  dueDate: string | null;
  status: DependencyStatus;
  impact: IssueImpact;
  ownerUserId: string | null;
  owner?: { id: string; name: string } | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Critical Path Method (CPM) ---
export interface CpmTaskRow {
  id: string;
  wbsCode: string;
  name: string;
  planStart: string;
  planEnd: string;
  duration: number;
  es: number; ef: number; ls: number; lf: number;
  totalFloat: number;
  critical: boolean;
}
export interface CpmResult {
  hasNetwork: boolean;
  cyclic: boolean;
  projectDuration: number;
  criticalCount: number;
  taskCount: number;
  tasks: CpmTaskRow[];
}

export interface Task {
  id: string;
  parentTaskId: string | null;
  wbsCode: string;
  name: string;
  description: string | null;
  deliverable: string | null;
  acceptanceCriteria: string | null;
  planStart: string;
  planEnd: string;
  actualStart: string | null;
  actualFinish: string | null;
  baselineStart: string | null;
  baselineFinish: string | null;
  picUserId: string | null;
  picResourceId: string | null;
  progressPct: number;
  /** Manual relative work-package weight (Model B). null = derive from cost/duration. */
  weight: number | null;
  /** PMB snapshot of `weight`, frozen at schedule-baseline capture. EVM measures against this. */
  baselineWeight: number | null;
  isMilestone: boolean;
  sortOrder: number;
}

export interface TaskDependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
}

export interface TaskStep {
  id: string;
  name: string;
  weight: number;
  done: boolean;
  sortOrder: number;
}

export interface GanttNode extends Task {
  durationDays: number;
  budgetCost: number;
  /** Share of total project weight this task/subtree carries (0..100), honouring manual weights. */
  effectiveWeightPct: number;
  /** Count of weighted progress steps; when > 0 the task's % is derived (read-only) from them. */
  stepCount: number;
  linkedPlanMandays: number;
  pic?: { id: string; name: string } | null;
  picResource?: { id: string; name: string } | null;
  children: GanttNode[];
}

export interface Evm {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  cv: number;
  sv: number;
  cpi: number;
  spi: number;
  eac: number;
  etc: number;
  vac: number;
  tcpi: number;
  percentComplete: number;
  weightedProgress: number; // Σ(weight·%)/Σweight (0..1) — physical, BAC-independent
  scheduleProgress: number; // physical % complete, WBS-weighted (0..1)
  scheduleWeight: number;
  health: 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA';
  costBaselineBAC: number;
  leafTaskCount: number;
  scheduleBaselinedAt: string | null;
  baselineFinish: string | null;
  currentFinish: string | null;
  finishVarianceDays: number | null;
}

export interface Forecast {
  statusDate: string;
  bac: number; ev: number; ac: number; pv: number; cpi: number; spi: number;
  etc: number; vac: number; tcpi: number;
  eac: { optimistic: number; likely: number; pessimistic: number };
  schedule: {
    plannedStart: string | null;
    plannedFinish: string | null;
    forecastFinish: string | null;
    varianceDays: number | null;
  };
  margin: {
    revenue: number;
    hasRevenue: boolean;
    planned: number;
    projected: number;      // likely-case profit (Rev − likely EAC)
    projectedBest: number;  // best-case (Rev − optimistic EAC)
    projectedWorst: number; // worst-case (Rev − pessimistic EAC)
    plannedPct: number | null;
    projectedPct: number | null;
    projectedWorstPct: number | null;
  };
  baselineUpdatePending: boolean;
  pendingChangeTitle: string | null;
  hasData: boolean;
  sCurve: { t: string; pv: number; ac: number | null; forecast: number | null }[];
}

// Curated single-project status report (Reports page, PM + ADMIN/PMO). Period drives the
// S-curve granularity + the period label. Reuses the Forecast payload for the chart + EAC.
export interface ProjectReportData {
  project: { code: string; name: string; pmName: string; status: string; deliveryApproach: string };
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  asOf: string;
  periodLabel: string;
  health: 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA';
  evm: {
    bac: number; pv: number; ev: number; ac: number; cpi: number; spi: number;
    percentComplete: number; weightedProgress: number; scheduleProgress: number; leafTaskCount: number;
  };
  tasks: {
    total: number; completed: number; inProgress: number; notStarted: number; weightedPct: number;
    remaining: { name: string; pct: number; planEnd: string; overdue: boolean; isMilestone: boolean; owner: string | null }[];
  };
  forecast: Forecast;
  // PM narrative for this reporting bucket (null fields when nothing written yet).
  commentary: {
    highlights: string | null;
    lowlights: string | null;
    nextFocus: string | null;
    authorName: string | null;
    updatedAt: string | null;
  };
  // Trend vs the prior captured status (most recent EvmSnapshot before this bucket); null if none.
  delta: {
    since: string;
    prior: { spi: number; cpi: number; weightedPct: number; health: 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA' };
    spi: number;
    cpi: number;
    weightedPct: number;
    healthFrom: 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA';
    healthTo: 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA';
    healthChanged: boolean;
  } | null;
  // UI hint: whether the "Draft dengan AI" action is offered (global key set + tenant opted in).
  aiAvailable: boolean;
}

// Response of PUT /projects/:id/report/commentary (echoes the saved narrative).
export type ProjectCommentary = ProjectReportData['commentary'];

// Response of POST /projects/:id/report/commentary/ai-draft — a generated (unsaved) narrative draft.
export interface AiNarrativeDraft {
  executiveSummary: string;
  highlights: string;
  lowlights: string;
  nextFocus: string;
}

// GET/PATCH /ai-settings — per-tenant opt-in. `configured` = global key set; `enabled` = opt-in.
export interface AiSettings {
  configured: boolean;
  enabled: boolean;
}

// UAT (User Acceptance Test) — a structured, executable test-case template per project.
export type UatStatus = 'NOT_RUN' | 'PASS' | 'FAIL' | 'BLOCKED';
export interface UatTestCase {
  id: string;
  code: string;
  title: string;
  scenario: string | null;
  steps: string | null;
  expected: string;
  actual: string | null;
  status: UatStatus;
  testerName: string | null;
  executedAt: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
}
export interface UatSummary {
  total: number;
  executed: number;
  passRate: number;
  notRun: number;
  pass: number;
  fail: number;
  blocked: number;
}

// A curated WBS template (list item) used to seed an empty schedule.
export interface WbsTemplateInfo { id: string; name: string; category: string; description: string; taskCount: number }

// Kick-Off Meeting minutes — one structured record per project (Initiating artifact).
export type KickoffActionStatus = 'OPEN' | 'DONE';
export interface KickoffMeeting {
  id: string;
  meetingDate: string | null;
  location: string | null;
  facilitator: string | null;
  agenda: string | null;
  objectives: string | null;
  decisions: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface KickoffAttendee { id: string; name: string; role: string | null; present: boolean }
export interface KickoffActionItem { id: string; description: string; ownerName: string | null; dueDate: string | null; status: KickoffActionStatus }
export interface KickoffData { meeting: KickoffMeeting | null; attendees: KickoffAttendee[]; actionItems: KickoffActionItem[] }

// A frozen point-in-time EVM capture — the app's point-in-time EVM turned into a trend.
export interface EvmSnapshot {
  id: string;
  statusDate: string;
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  cpi: number;
  spi: number;
  weightedProgress: number; // physical % complete (0..1)
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface EvmTrend {
  projectId: string;
  statusDate: string;
  bac: number;
  plannedStart: string | null;
  plannedFinish: string | null;
  snapshots: EvmSnapshot[];
  plannedCurve: { t: string; pv: number }[]; // smooth planned-value backdrop
}

// A chartered project whose baselines are set and is ready for ADMIN/PMO to activate.
export interface AwaitingActivationItem {
  id: string;
  code: string;
  name: string;
  pm: string;
}

// An in-progress project that has met the closure gate and is ready for ADMIN/PMO to
// close, with the state of each closeout artifact (acceptance sign-off / lessons learned).
export interface AwaitingClosureItem {
  id: string;
  code: string;
  name: string;
  pm: string;
  hasAcceptance: boolean;
  hasLessons: boolean;
}

// Dashboard "Set Baseline" reminder: a still-in-planning project with the completion
// state of each planning artifact (charter / cost baseline / schedule baseline).
export interface PlanningReminderItem {
  id: string;
  code: string;
  name: string;
  pm: string;
  charter: boolean;
  cost: boolean;
  schedule: boolean;
  scheduleNa: boolean; // no WBS → schedule baseline not applicable
}

// Portfolio-wide EVM trend: per-project snapshots rolled up (latest-as-of each date).
export interface PortfolioEvmTrend {
  bac: number;
  projectCount: number;
  series: { statusDate: string; pv: number; ev: number; ac: number; cpi: number; spi: number; projectCount: number }[];
}

// --- Direct messaging (1-to-1 chat) ---
export interface ChatContact {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface ChatAttachment {
  name: string;
  mime: string;
  size: number;
}
export interface ChatReaction {
  emoji: string;
  count: number;
  mine: boolean;
  users: string[];
}
export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  editedAt?: string | null;
  deleted?: boolean;
  attachment?: ChatAttachment | null;
  reactions?: ChatReaction[];
  read?: { count: number; all: boolean } | null;
}
export type ChatConversationType = 'DIRECT' | 'GROUP';
export interface ChatMember extends ChatContact {
  isAdmin: boolean;
}
// Common display fields for a conversation (DIRECT shows the counterpart, GROUP a title + members).
export interface ChatConversationBase {
  id: string;
  type: ChatConversationType;
  title: string;
  other: ChatContact | null;
  members: ChatMember[];
  projectId?: string | null;
  createdById?: string | null;
  iAmAdmin?: boolean;
}
export interface ChatConversation extends ChatConversationBase {
  lastMessage: { body: string; senderId: string; createdAt: string; deleted?: boolean } | null;
  lastMessageAt: string;
  unread: number;
}
export interface ChatSearchResult {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  conversation: { id: string; type: ChatConversationType; title: string; other: ChatContact | null };
}
export interface ChatThread extends ChatConversationBase {
  conversationId: string;
  messages: ChatMessage[];
}

// ---- Approval workflows (admin-configured, multi-step approval) ----
export type ApprovalApproverKind = 'ROLE' | 'USER' | 'PROJECT_PM';
// What kind of action a workflow gates. CHANGE_REQUEST + COST_BASELINE are wired; PROJECT_CLOSURE
// is reserved (Phase 2b).
export type ApprovalAppliesTo = 'CHANGE_REQUEST' | 'COST_BASELINE' | 'PROJECT_CLOSURE';
export interface ApprovalApprover {
  id?: string;
  kind: ApprovalApproverKind;
  role: Role | null;
  userId: string | null;
}
export interface ApprovalStep {
  id?: string;
  order?: number;
  name: string;
  mode: 'ANY' | 'ALL';
  slaHours?: number | null;
  approvers: ApprovalApprover[];
}
export interface ApprovalWorkflow {
  id: string;
  name: string;
  appliesTo: ApprovalAppliesTo;
  enabled: boolean;
  condMagnitude: 'MINOR' | 'MAJOR' | null;
  condChargeable: boolean | null;
  condMinAmountIdr: string | number | null;
  escalationUserId: string | null;
  steps: ApprovalStep[];
  _count?: { requests: number };
}
export interface ApprovalDelegation {
  id: string;
  fromUserId: string;
  toUserId: string;
  note: string | null;
  expiresAt: string | null;
  toUser: { id: string; name: string; email: string } | null;
}
export interface MyApproval {
  id: string;
  entityType: ApprovalAppliesTo;
  actionLabel: string;
  reason: string | null;
  workflowName: string;
  stepName: string;
  stepOrder: number;
  totalSteps: number;
  mode: 'ANY' | 'ALL';
  alreadyVoted: boolean;
  createdAt: string;
  dueAt: string | null;
  project: { id: string; name: string; code: string } | null;
  changeRequest: {
    title: string;
    description: string;
    magnitude: 'MINOR' | 'MAJOR';
    chargeable: boolean;
    amountIdr: number | null;
  } | null;
}
