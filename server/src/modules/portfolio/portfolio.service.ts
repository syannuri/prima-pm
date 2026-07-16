import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { computeEvmForProjects } from '../schedule/evm.batch.js';
import { round2 } from '../../calc/money.js';

// FINANCE oversees cost across the whole portfolio, so it sees all projects (like PMO),
// not just ones it owns — otherwise its dashboard charts would be empty.
const GLOBAL_ROLES: Role[] = ['ADMIN', 'PMO', 'FINANCE'];
const dec = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));

type Health = 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA';

// Schedule-based health from SPI.
// PV=0 means the planned baseline hasn't started by the status date -> not started yet.
function scheduleHealth(spi: number, leafTaskCount: number, pv: number): Health {
  if (leafTaskCount === 0 || pv <= 0) return 'NO_DATA';
  if (spi >= 0.95) return 'GREEN';
  if (spi >= 0.85) return 'AMBER';
  return 'RED';
}

// Cost health from CPI; needs recorded Actual Cost to be meaningful.
function costHealthFrom(cpi: number, ac: number): Health {
  if (ac <= 0) return 'NO_DATA';
  if (cpi >= 0.95) return 'GREEN';
  if (cpi >= 0.85) return 'AMBER';
  return 'RED';
}

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
  health: Health; // schedule health (SPI)
  costHealth: Health; // cost health (CPI)
  finishVarianceDays: number | null; // vs schedule baseline (null = no baseline)
  changeCount: number; // total recorded changes (audit-log entries) for this project
  scheduleProgress: number; // physical % complete from the WBS roll-up (0..1)
  resourceCount: number; // distinct manpower resources loaded on the project
  planMandays: number; // Σ planned man-days across manpower lines
  manpowerCost: number; // Σ manpower cost
  plannedCost: number; // project-level cost baseline (costBaselineIdr)
  revenue: number; // project-level total revenue (totalRevenueIdr)
}

export async function getPortfolioSummary(userId: string, role: string, statusDate: Date) {
  const where: Prisma.ProjectWhereInput = { deletedAt: null };
  if (role === 'GUEST') {
    where.personalOwnerId = userId;
  } else {
    where.personalOwnerId = null; // corporate portfolio excludes personal (guest) projects
    if (!GLOBAL_ROLES.includes(role as Role)) where.pmUserId = userId;
  }

  const projects = await prisma.project.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      pm: { select: { name: true } },
      charter: { select: { category: true } },
      costBaseline: { select: { costBaseline: true, contingencyReserve: true } },
    },
  });

  // One grouped query for change counts across all visible projects (avoids N+1).
  const changeGroups = await prisma.auditLog.groupBy({
    by: ['projectId'],
    where: { projectId: { in: projects.map((p) => p.id) } },
    _count: { _all: true },
  });
  const changeMap = new Map(changeGroups.map((g) => [g.projectId, g._count._all]));

  // Per-project manpower/resource summary (distinct resources, mandays, cost).
  const manpower = await prisma.costItemDirect.findMany({
    where: { type: 'MANPOWER', projectId: { in: projects.map((p) => p.id) } },
    select: { projectId: true, resourceId: true, resourceUserId: true, label: true, planMandays: true, manpowerCost: true },
  });
  const mpMap = new Map<string, { keys: Set<string>; mandays: number; cost: number }>();
  for (const m of manpower) {
    const e = mpMap.get(m.projectId) ?? { keys: new Set<string>(), mandays: 0, cost: 0 };
    // Identify a distinct resource by pool id, else linked user, else its label.
    e.keys.add(m.resourceId ? `R:${m.resourceId}` : m.resourceUserId ? `U:${m.resourceUserId}` : `L:${m.label}`);
    e.mandays += dec(m.planMandays);
    e.cost += dec(m.manpowerCost);
    mpMap.set(m.projectId, e);
  }

  // EVM per project by methodology (agile → story points; hybrid → blended WBS + points;
  // predictive → WBS schedule). Batched: the many predictive projects share a handful of bulk
  // queries (was O(projects × ~5) — see computeEvmForProjects); agile/hybrid still dispatch
  // per-project. DRAFT projects are omitted from the map (no baseline yet).
  const evmMap = await computeEvmForProjects(projects, statusDate);

  const rows: PortfolioRow[] = [];
  // Portfolio physical progress = duration-weighted roll-up across projects.
  const schedAccum = { weighted: 0, weight: 0 };
  projects.forEach((p) => {
    const evm = evmMap.get(p.id) ?? null;
    const pv = evm?.pv ?? 0, ev = evm?.ev ?? 0, ac = evm?.ac ?? 0, spi = evm?.spi ?? 0, cpi = evm?.cpi ?? 0;
    const percentComplete = evm?.percentComplete ?? 0, leafTaskCount = evm?.leafTaskCount ?? 0;
    const scheduleProgress = evm?.scheduleProgress ?? 0, scheduleWeight = evm?.scheduleWeight ?? 0;
    const finishVarianceDays = evm?.finishVarianceDays ?? null;
    rows.push({
      id: p.id,
      code: p.code,
      name: p.name,
      clientName: p.clientName,
      status: p.status,
      pm: p.pm?.name ?? '—',
      category: p.charter?.category ?? null,
      bac: dec(p.costBaseline?.costBaseline), // PMB (excludes management reserve)
      contingencyReserve: dec(p.costBaseline?.contingencyReserve),
      pv, ev, ac, spi, cpi, percentComplete,
      health: scheduleHealth(spi, leafTaskCount, pv),
      costHealth: costHealthFrom(cpi, ac),
      finishVarianceDays,
      changeCount: changeMap.get(p.id) ?? 0,
      scheduleProgress,
      resourceCount: mpMap.get(p.id)?.keys.size ?? 0,
      planMandays: round2(mpMap.get(p.id)?.mandays ?? 0),
      manpowerCost: round2(mpMap.get(p.id)?.cost ?? 0),
      plannedCost: dec(p.costBaselineIdr),
      revenue: dec(p.totalRevenueIdr),
    });
    schedAccum.weighted += scheduleProgress * scheduleWeight;
    schedAccum.weight += scheduleWeight;
  });

  // Portfolio totals & distributions.
  const totals = rows.reduce(
    (acc, r) => {
      acc.bac = round2(acc.bac + r.bac);
      acc.contingencyReserve = round2(acc.contingencyReserve + r.contingencyReserve);
      acc.pv = round2(acc.pv + r.pv);
      acc.ev = round2(acc.ev + r.ev);
      acc.ac = round2(acc.ac + r.ac);
      return acc;
    },
    { bac: 0, contingencyReserve: 0, pv: 0, ev: 0, ac: 0 },
  );
  const portfolioSpi = totals.pv > 0 ? round2(totals.ev / totals.pv) : 0;
  const portfolioCpi = totals.ac > 0 ? round2(totals.ev / totals.ac) : 0;
  const portfolioPercent = totals.bac > 0 ? round2(totals.ev / totals.bac) : 0;
  // Physical % complete (WBS) rolled up across projects, weighted by schedule span.
  const portfolioSchedule = schedAccum.weight > 0 ? round2(schedAccum.weighted / schedAccum.weight) : 0;

  const byStatus: Record<string, number> = {};
  const byHealth: Record<string, number> = { GREEN: 0, AMBER: 0, RED: 0, NO_DATA: 0 };
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byHealth[r.health] += 1;
  }

  // Schedule-variance roll-up (baselined projects only).
  const baselined = rows.filter((r) => r.finishVarianceDays != null);
  const slippedCount = baselined.filter((r) => (r.finishVarianceDays ?? 0) > 0).length;
  const worstSlipDays = baselined.reduce((m, r) => Math.max(m, r.finishVarianceDays ?? 0), 0);

  return {
    projects: rows,
    totals: {
      ...totals,
      spi: portfolioSpi,
      cpi: portfolioCpi,
      percentComplete: portfolioPercent,
      scheduleProgress: portfolioSchedule,
      count: rows.length,
      baselinedCount: baselined.length,
      slippedCount,
      worstSlipDays,
    },
    byStatus,
    byHealth,
    statusDate,
  };
}
