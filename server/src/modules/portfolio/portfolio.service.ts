import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getEvm } from '../schedule/schedule.service.js';
import { round2 } from '../../calc/money.js';

const GLOBAL_ROLES: Role[] = ['ADMIN', 'PMO'];
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
}

export async function getPortfolioSummary(userId: string, role: string, statusDate: Date) {
  const where: Prisma.ProjectWhereInput = { deletedAt: null };
  if (!GLOBAL_ROLES.includes(role as Role)) where.pmUserId = userId;

  const projects = await prisma.project.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      pm: { select: { name: true } },
      charter: { select: { category: true } },
      costBaseline: { select: { budgetAtCompletion: true, contingencyReserve: true } },
    },
  });

  // One grouped query for change counts across all visible projects (avoids N+1).
  const changeGroups = await prisma.auditLog.groupBy({
    by: ['projectId'],
    where: { projectId: { in: projects.map((p) => p.id) } },
    _count: { _all: true },
  });
  const changeMap = new Map(changeGroups.map((g) => [g.projectId, g._count._all]));

  const rows: PortfolioRow[] = [];
  for (const p of projects) {
    let pv = 0, ev = 0, ac = 0, spi = 0, cpi = 0, percentComplete = 0, leafTaskCount = 0;
    let finishVarianceDays: number | null = null;
    // Only chartered projects can have a schedule; AC resolved from stored time-phased entries.
    if (p.status !== 'DRAFT') {
      const evm = await getEvm(p.id, undefined, statusDate);
      pv = evm.pv; ev = evm.ev; ac = evm.ac; spi = evm.spi; cpi = evm.cpi;
      percentComplete = evm.percentComplete; leafTaskCount = evm.leafTaskCount;
      finishVarianceDays = evm.finishVarianceDays;
    }
    rows.push({
      id: p.id,
      code: p.code,
      name: p.name,
      clientName: p.clientName,
      status: p.status,
      pm: p.pm?.name ?? '—',
      category: p.charter?.category ?? null,
      bac: dec(p.costBaseline?.budgetAtCompletion),
      contingencyReserve: dec(p.costBaseline?.contingencyReserve),
      pv, ev, ac, spi, cpi, percentComplete,
      health: scheduleHealth(spi, leafTaskCount, pv),
      costHealth: costHealthFrom(cpi, ac),
      finishVarianceDays,
      changeCount: changeMap.get(p.id) ?? 0,
    });
  }

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
