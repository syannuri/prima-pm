export type Role =
  | 'ADMIN'
  | 'PMO'
  | 'PROJECT_MANAGER'
  | 'FINANCE'
  | 'RISK_OFFICER'
  | 'TEAM_MEMBER'
  | 'VIEWER';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface AdminUser extends User {
  isActive: boolean;
  createdAt: string;
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
  | 'APP_DEV';

export type DeliveryApproach = 'PREDICTIVE' | 'AGILE' | 'HYBRID';
export type BacklogType = 'EPIC' | 'STORY' | 'TASK' | 'BUG';
export type BacklogStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
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
export interface AgileBoard { sprints: Sprint[]; items: BacklogItem[]; snapshots: SprintSnapshot[] }

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
  deliveryApproach: DeliveryApproach;
  costBaselineIdr: string | null;
  totalRevenueIdr: string | null;
  status: ProjectStatus;
  pmUserId: string | null;
  closedAt?: string | null;
  closureNote?: string | null;
  onHoldReason?: string | null;
  baselineLockedAt?: string | null;
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
}

export interface IndirectCost {
  id: string;
  type: string;
  description: string;
  amount: string;
}

export interface ActualCostEntry {
  id: string;
  date: string;
  amount: string;
  description: string | null;
}

export interface CostSummary {
  directCosts: DirectCost[];
  indirectCosts: IndirectCost[];
  baseline: CostBaseline | null;
  highLevelCharterCost: number | null;
  actualCosts: ActualCostEntry[];
  actualCostTotal: number;
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
  createdAt: string;
  updatedAt: string;
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

export interface GanttNode extends Task {
  durationDays: number;
  budgetCost: number;
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
  margin: { revenue: number; planned: number; projected: number };
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
