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
  pm?: { id: string; name: string; email: string } | null;
  charter?: { id: string; locked: boolean; version: number; category: ProjectCategory } | null;
  costBaseline?: { budgetAtCompletion: string } | null;
  changeCount?: number;
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

export type ChangeImpact = 'COST' | 'SCHEDULE' | 'RESOURCE' | 'QUALITY' | 'RISK';

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
