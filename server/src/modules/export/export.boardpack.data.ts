// Gather a Steering Committee "Board Pack": everything a governance board reviews in one place —
// portfolio health (reused Executive summary) + the top risks and open issues across the portfolio
// + the decisions the board is being asked to make (change requests awaiting a decision).
// Role-scoping rides on getPortfolioSummary (a PM sees only owned projects); the remaining
// risk/issue/CR queries are constrained to that same visible project set (and tenant-scoped by the
// Prisma extension). This is the data behind R4 — see docs / the reporting-hub memory.
import { prisma } from '../../lib/prisma.js';
import { getPortfolioSummary } from '../portfolio/portfolio.service.js';

const TOP_RISKS = 8;
const TOP_ISSUES = 8;
const MAX_DECISIONS = 10;

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const IMPACT_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const dec = (v: unknown): number => (v == null ? 0 : Number(v));
const ageDays = (from: Date, to: Date) => Math.max(0, Math.floor((+to - +from) / 86_400_000));

export async function gatherBoardPack(userId: string, role: string, statusDate: Date) {
  const summary = await getPortfolioSummary(userId, role, statusDate);
  // The visible (role + tenant scoped) project set + a lookup for code/PM on each risk/issue/CR.
  const projMap = new Map(summary.projects.map((p) => [p.id, { code: p.code, name: p.name, pm: p.pm }]));
  const projectIds = [...projMap.keys()];

  const emptyPack = { summary, statusDate, generatedAt: new Date(), topRisks: [], topIssues: [], decisions: [] };
  if (projectIds.length === 0) return emptyPack;

  const [risks, issues, changeRequests] = await Promise.all([
    // Live threats/opportunities — everything not yet CLOSED (OCCURRED risks still matter to a board).
    prisma.risk.findMany({
      where: { projectId: { in: projectIds }, status: { not: 'CLOSED' } },
      select: {
        projectId: true, code: true, title: true, severity: true, status: true, kind: true,
        emv: true, residualEmv: true, responseStrategy: true, owner: { select: { name: true } },
      },
    }),
    // Open / in-progress issues (resolved & closed are done).
    prisma.issue.findMany({
      where: { projectId: { in: projectIds }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      select: {
        projectId: true, code: true, title: true, impact: true, status: true,
        raisedAt: true, owner: { select: { name: true } },
      },
    }),
    // Decisions the board is asked to make: change requests still awaiting a decision.
    prisma.changeRequest.findMany({
      where: { projectId: { in: projectIds }, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      select: {
        projectId: true, title: true, type: true, magnitude: true, status: true,
        chargeable: true, amountIdr: true, impactAreas: true, createdAt: true,
        requester: { select: { name: true } },
      },
    }),
  ]);

  const now = statusDate;

  const topRisks = risks
    .map((r) => ({
      project: projMap.get(r.projectId)?.code ?? '—',
      code: r.code,
      title: r.title,
      severity: r.severity as string,
      status: r.status as string,
      kind: r.kind as string,
      emv: dec(r.residualEmv ?? r.emv), // residual (post-response) if set, else gross
      response: (r.responseStrategy as string | null) ?? null,
      owner: r.owner?.name ?? null,
    }))
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.emv - a.emv)
    .slice(0, TOP_RISKS);

  const topIssues = issues
    .map((i) => ({
      project: projMap.get(i.projectId)?.code ?? '—',
      code: i.code,
      title: i.title,
      impact: i.impact as string,
      status: i.status as string,
      owner: i.owner?.name ?? null,
      ageDays: ageDays(i.raisedAt, now),
    }))
    .sort((a, b) => (IMPACT_RANK[a.impact] ?? 9) - (IMPACT_RANK[b.impact] ?? 9) || b.ageDays - a.ageDays)
    .slice(0, TOP_ISSUES);

  const decisions = changeRequests
    .map((c) => ({
      project: projMap.get(c.projectId)?.code ?? '—',
      title: c.title,
      type: c.type,
      magnitude: c.magnitude as string,
      status: c.status as string,
      amount: c.chargeable ? dec(c.amountIdr) : 0,
      impactAreas: (c.impactAreas as string[]) ?? [],
      requestedBy: c.requester?.name ?? null,
      ageDays: ageDays(c.createdAt, now),
    }))
    .sort((a, b) => b.ageDays - a.ageDays) // oldest-waiting first — those need a decision most
    .slice(0, MAX_DECISIONS);

  return { summary, statusDate, generatedAt: new Date(), topRisks, topIssues, decisions };
}

export type BoardPack = Awaited<ReturnType<typeof gatherBoardPack>>;
