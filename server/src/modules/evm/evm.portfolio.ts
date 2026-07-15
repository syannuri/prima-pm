import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { captureSnapshot } from './evm.service.js';
import { rollupPortfolioTrend, type RollupInput } from './evm.helpers.js';

// FINANCE oversees cost across the whole portfolio, so it reads all projects (like
// PMO/ADMIN); everyone else is scoped to the projects they own. Mirrors portfolio.service.
const GLOBAL_READ: Role[] = ['ADMIN', 'PMO', 'FINANCE'];
// Capturing is a PM/PMO action; ADMIN/PMO capture across the portfolio, a PM only
// their own projects. (FINANCE reads but does not capture.)
const GLOBAL_WRITE: Role[] = ['ADMIN', 'PMO'];

const num = (d: unknown): number => (d == null ? 0 : Number(d));

function scopeWhere(userId: string, role: string, global: Role[]): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = { deletedAt: null };
  if (role === 'GUEST') {
    where.personalOwnerId = userId; // guests: only their own personal projects
  } else {
    where.personalOwnerId = null; // corporate aggregates never include personal (guest) projects
    if (!global.includes(role as Role)) where.pmUserId = userId;
  }
  return where;
}

/** Portfolio EVM trend: roll up every visible project's captured snapshots into one series. */
export async function getPortfolioEvmTrend(userId: string, role: string) {
  const projects = await prisma.project.findMany({ where: scopeWhere(userId, role, GLOBAL_READ), select: { id: true } });
  const ids = projects.map((p) => p.id);
  if (!ids.length) return { series: [], bac: 0, projectCount: 0 };

  const rows = await prisma.evmSnapshot.findMany({
    where: { projectId: { in: ids } },
    orderBy: { statusDate: 'asc' },
    select: { projectId: true, statusDate: true, pv: true, ev: true, ac: true, bac: true },
  });

  const snaps: RollupInput[] = rows.map((r) => ({
    projectId: r.projectId,
    statusDate: r.statusDate.toISOString(),
    pv: num(r.pv),
    ev: num(r.ev),
    ac: num(r.ac),
  }));
  const series = rollupPortfolioTrend(snaps);

  // Portfolio BAC = Σ of each project's LATEST captured BAC (the baseline that trend measures against).
  const latestBac = new Map<string, number>();
  for (const r of rows) latestBac.set(r.projectId, num(r.bac)); // rows are asc, so the last write wins = latest
  const bac = [...latestBac.values()].reduce((s, v) => s + v, 0);

  return { series, bac: Math.round(bac * 100) / 100, projectCount: latestBac.size };
}

/** Capture a snapshot for every visible, non-DRAFT project at once. */
export async function captureAllSnapshots(userId: string, role: string, statusDate: Date | undefined) {
  const where = scopeWhere(userId, role, GLOBAL_WRITE);
  where.status = { not: 'DRAFT' }; // DRAFT projects have no baseline/EVM yet
  const projects = await prisma.project.findMany({ where, select: { id: true } });

  let captured = 0;
  const failed: string[] = [];
  for (const p of projects) {
    try {
      await captureSnapshot(p.id, { statusDate }, userId);
      captured++;
    } catch {
      failed.push(p.id);
    }
  }
  return { captured, failed: failed.length, total: projects.length };
}
