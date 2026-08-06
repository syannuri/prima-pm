import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

// Portfolio RAID roll-up (R5): Risks, Assumptions, Issues, Dependencies aggregated across every
// project the caller can see — the cross-project view the reporting hub was missing (RAID had only
// ever been per-project). Role-scoping mirrors getPortfolioSummary: global roles + guests see their
// full (tenant-scoped) set, other roles see only projects they manage. Only LIVE items are rolled
// up (closed risks / validated assumptions / resolved issues & dependencies are done).
const GLOBAL_ROLES: Role[] = ['ADMIN', 'PMO', 'FINANCE'];
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const IMPACT_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const DEP_RANK: Record<string, number> = { AT_RISK: 0, PENDING: 1, ON_TRACK: 2, RESOLVED: 3 };
const dec = (v: unknown): number => (v == null ? 0 : Number(v));
const ageDays = (from: Date, to: Date) => Math.max(0, Math.floor((+to - +from) / 86_400_000));
const dayFloor = (ms: number) => Math.floor(ms / 86_400_000);

export async function getPortfolioRaid(userId: string, role: string, statusDate: Date) {
  const where: Prisma.ProjectWhereInput = { deletedAt: null, archivedAt: null };
  if (role !== 'GUEST' && !GLOBAL_ROLES.includes(role as Role)) where.pmUserId = userId;
  const projects = await prisma.project.findMany({ where, select: { id: true, code: true, name: true } });
  const projMap = new Map(projects.map((p) => [p.id, p.code]));
  const projectIds = [...projMap.keys()];

  const base = { statusDate, projectCount: projectIds.length };
  if (projectIds.length === 0) {
    return { ...base, risks: [], assumptions: [], issues: [], dependencies: [], counts: { risks: 0, risksHigh: 0, assumptions: 0, issues: 0, dependencies: 0, dependenciesAtRisk: 0 } };
  }

  const [risks, assumptions, issues, dependencies] = await Promise.all([
    prisma.risk.findMany({
      where: { projectId: { in: projectIds }, status: { not: 'CLOSED' } },
      select: { projectId: true, code: true, title: true, severity: true, status: true, kind: true, emv: true, residualEmv: true, responseStrategy: true, owner: { select: { name: true } } },
    }),
    prisma.assumption.findMany({
      where: { projectId: { in: projectIds }, status: 'OPEN' },
      select: { projectId: true, code: true, statement: true, impact: true, category: true, owner: { select: { name: true } } },
    }),
    prisma.issue.findMany({
      where: { projectId: { in: projectIds }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      select: { projectId: true, code: true, title: true, impact: true, status: true, raisedAt: true, owner: { select: { name: true } } },
    }),
    prisma.projectDependency.findMany({
      where: { projectId: { in: projectIds }, status: { not: 'RESOLVED' } },
      select: { projectId: true, code: true, description: true, direction: true, counterparty: true, dueDate: true, status: true, impact: true, owner: { select: { name: true } } },
    }),
  ]);

  const now = statusDate;
  const nowDay = dayFloor(+now);

  const risksOut = risks
    .map((r) => ({
      project: projMap.get(r.projectId) ?? '—', code: r.code, title: r.title,
      severity: r.severity as string, status: r.status as string, kind: r.kind as string,
      emv: dec(r.residualEmv ?? r.emv), response: (r.responseStrategy as string | null) ?? null, owner: r.owner?.name ?? null,
    }))
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.emv - a.emv);

  const assumptionsOut = assumptions
    .map((a) => ({ project: projMap.get(a.projectId) ?? '—', code: a.code, statement: a.statement, impact: a.impact as string, category: a.category ?? null, owner: a.owner?.name ?? null }))
    .sort((a, b) => (IMPACT_RANK[a.impact] ?? 9) - (IMPACT_RANK[b.impact] ?? 9));

  const issuesOut = issues
    .map((i) => ({ project: projMap.get(i.projectId) ?? '—', code: i.code, title: i.title, impact: i.impact as string, status: i.status as string, ageDays: ageDays(i.raisedAt, now), owner: i.owner?.name ?? null }))
    .sort((a, b) => (IMPACT_RANK[a.impact] ?? 9) - (IMPACT_RANK[b.impact] ?? 9) || b.ageDays - a.ageDays);

  const dependenciesOut = dependencies
    .map((d) => ({
      project: projMap.get(d.projectId) ?? '—', code: d.code, description: d.description,
      direction: d.direction as string, counterparty: d.counterparty ?? null, status: d.status as string,
      impact: d.impact as string, dueDate: d.dueDate ? d.dueDate.toISOString() : null,
      overdue: d.dueDate ? dayFloor(+d.dueDate) < nowDay : false, owner: d.owner?.name ?? null,
    }))
    .sort((a, b) => (DEP_RANK[a.status] ?? 9) - (DEP_RANK[b.status] ?? 9) || (IMPACT_RANK[a.impact] ?? 9) - (IMPACT_RANK[b.impact] ?? 9));

  return {
    ...base,
    counts: {
      risks: risksOut.length,
      risksHigh: risksOut.filter((r) => r.severity === 'CRITICAL' || r.severity === 'HIGH').length,
      assumptions: assumptionsOut.length,
      issues: issuesOut.length,
      dependencies: dependenciesOut.length,
      dependenciesAtRisk: dependenciesOut.filter((d) => d.status === 'AT_RISK' || d.overdue).length,
    },
    risks: risksOut,
    assumptions: assumptionsOut,
    issues: issuesOut,
    dependencies: dependenciesOut,
  };
}

export type PortfolioRaid = Awaited<ReturnType<typeof getPortfolioRaid>>;
