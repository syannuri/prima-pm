// Gather a full snapshot of a project across all modules for export.
import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { getCostSummary } from '../cost/cost.service.js';
import { getRiskAnalysis } from '../risk/risk.service.js';
import { getGantt } from '../schedule/schedule.service.js';
import { getProjectEvm } from '../agile/agile.service.js';
import { listSnapshots } from '../evm/evm.service.js';

export interface ExportOptions {
  actualCost?: number;
  statusDate?: Date;
}

export async function gatherProjectExport(projectId: string, opts: ExportOptions = {}) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    include: { pm: { select: { name: true, email: true } } },
  });
  if (!project) throw NotFound('Project not found');

  const [charter, risks, issues, cost, riskAnalysis, gantt, evm, evmSnapshots] = await Promise.all([
    prisma.projectCharter.findUnique({ where: { projectId } }),
    prisma.risk.findMany({ where: { projectId }, orderBy: { code: 'asc' } }),
    prisma.issue.findMany({
      where: { projectId },
      include: { owner: { select: { name: true } } },
      orderBy: { raisedAt: 'desc' },
    }),
    getCostSummary(projectId),
    getRiskAnalysis(projectId),
    getGantt(projectId),
    // Use the methodology-aware dispatcher (predictive→WBS, agile→points, hybrid→blend) so the
    // exported EVM matches Dashboard/Forecast/Portfolio/Reports. `undefined` actualCost resolves
    // the stored time-phased AC (same as the live /evm endpoint).
    getProjectEvm(projectId, opts.actualCost, opts.statusDate ?? new Date()),
    // Captured EVM status history (oldest → newest) for the trend section.
    listSnapshots(projectId),
  ]);

  return { project, charter, risks, issues, cost, riskAnalysis, gantt, evm, evmSnapshots, generatedAt: new Date() };
}

export type ProjectExport = Awaited<ReturnType<typeof gatherProjectExport>>;

const CATEGORY_LABEL: Record<string, string> = {
  NETWORK_INFRA: 'Network Infrastructure',
  SERVER_INFRA: 'Server Infrastructure',
  CLOUD_INFRA: 'Cloud Infrastructure',
  CYBERSECURITY_INFRA: 'Cyber Security Infrastructure',
  DATACENTER: 'Data Center Facility',
  APP_DEV: 'Application Development',
  ENTERPRISE_APP: 'Enterprise Applications (ERP/CRM)',
  SYSTEM_INTEGRATION: 'System Integration',
  DATA_ANALYTICS: 'Data Analytics & BI',
  AI_ML: 'AI / Machine Learning',
  DIGITAL_TRANSFORMATION: 'Digital Transformation',
  MANAGED_SERVICES: 'Managed Services & Support',
  IT_CONSULTING: 'IT Consulting & Advisory',
  OTHER: 'Other',
};
// For OTHER, append the free-text detail so the export reads e.g. "Other · Bug bounty program".
export const categoryLabel = (c?: string | null, other?: string | null) => {
  if (!c) return '—';
  const base = CATEGORY_LABEL[c] ?? c;
  return c === 'OTHER' && other?.trim() ? `${base} · ${other.trim()}` : base;
};

// Flatten the gantt tree into ordered rows with depth for tabular exports.
export interface FlatTaskRow {
  depth: number;
  wbsCode: string;
  name: string;
  planStart: Date;
  planEnd: Date;
  actualStart: Date | null;
  actualFinish: Date | null;
  pic: string;
  progressPct: number;
  budgetCost: number;
  linkedPlanMandays: number;
}

export function flattenGantt(nodes: ProjectExport['gantt']['tree'], depth = 0, acc: FlatTaskRow[] = []): FlatTaskRow[] {
  for (const n of nodes) {
    acc.push({
      depth,
      wbsCode: n.wbsCode,
      name: n.name,
      planStart: n.planStart,
      planEnd: n.planEnd,
      actualStart: n.actualStart,
      actualFinish: n.actualFinish,
      pic: n.pic?.name ?? '—',
      progressPct: n.progressPct,
      budgetCost: n.budgetCost,
      linkedPlanMandays: n.linkedPlanMandays,
    });
    if (n.children?.length) flattenGantt(n.children, depth + 1, acc);
  }
  return acc;
}
