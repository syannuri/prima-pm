// Gather a full snapshot of a project across all modules for export.
import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { getCostSummary } from '../cost/cost.service.js';
import { getRiskAnalysis } from '../risk/risk.service.js';
import { getGantt, getEvm } from '../schedule/schedule.service.js';

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

  const [charter, risks, cost, riskAnalysis, gantt, evm] = await Promise.all([
    prisma.projectCharter.findUnique({ where: { projectId } }),
    prisma.risk.findMany({ where: { projectId }, orderBy: { code: 'asc' } }),
    getCostSummary(projectId),
    getRiskAnalysis(projectId),
    getGantt(projectId),
    // Pass actualCost through as-is: undefined makes getEvm resolve the stored
    // time-phased AC (same as the live /evm endpoint). Forcing 0 here made every
    // exported PDF/Excel show CPI=0 / EAC=BAC even when actuals existed.
    getEvm(projectId, opts.actualCost, opts.statusDate ?? new Date()),
  ]);

  return { project, charter, risks, cost, riskAnalysis, gantt, evm, generatedAt: new Date() };
}

export type ProjectExport = Awaited<ReturnType<typeof gatherProjectExport>>;

const CATEGORY_LABEL: Record<string, string> = {
  NETWORK_INFRA: 'Network Infrastructure',
  SERVER_INFRA: 'Server Infrastructure',
  CLOUD_INFRA: 'Cloud Infrastructure',
  CYBERSECURITY_INFRA: 'Cyber Security Infrastructure',
  APP_DEV: 'Application Development',
};
export const categoryLabel = (c?: string | null) => (c ? CATEGORY_LABEL[c] ?? c : '—');

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
