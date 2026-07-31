import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant, multitenancyEnforced } from '../../lib/tenant/context.js';
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
  // Archived projects are excluded from portfolio aggregates (same rule as listProjects / summary).
  const where: Prisma.ProjectWhereInput = { deletedAt: null, archivedAt: null };
  // Guest/corporate separation is handled by tenant scoping; only the role rule remains.
  if (role !== 'GUEST' && !global.includes(role as Role)) where.pmUserId = userId;
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

  // Capture CONCURRENTLY while isolating per-project failures (one bad project must not abort the
  // batch) — was a sequential await-in-loop.
  const results = await Promise.allSettled(projects.map((p) => captureSnapshot(p.id, { statusDate }, userId)));
  const captured = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - captured;
  return { captured, failed, total: projects.length };
}

// ── Weekly auto-capture (opt-in scheduler) ─────────────────────────────────────
// System-driven capture across the WHOLE corporate portfolio (every non-DRAFT, non-archived,
// non-personal project) with a null actor + a marker note. Idempotent (upsert on project+date).
function dayUTC(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export async function autoCaptureWeekly(statusDate: Date) {
  // Runs per corporate tenant inside the cron fan-out (which skips personal tenants), so tenant
  // scoping already excludes guest projects — no personalOwnerId filter needed.
  const projects = await prisma.project.findMany({
    where: { deletedAt: null, archivedAt: null, status: { not: 'DRAFT' } },
    select: { id: true },
  });
  const results = await Promise.allSettled(
    projects.map((p) => captureSnapshot(p.id, { statusDate, note: 'Auto weekly capture' }, null)),
  );
  const captured = results.filter((r) => r.status === 'fulfilled').length;
  return { captured, failed: results.length - captured, total: projects.length };
}

/**
 * Run the weekly auto-capture IF it is due: enabled in AppSetting, today matches the configured
 * weekday (0=Sun..6=Sat, UTC), and it hasn't already run today. Stamps lastRunAt on success so a
 * server restart on the same day doesn't re-run it. Safe to call on a frequent timer.
 */
export async function runWeeklyAutoCaptureIfDue(now: Date = new Date()) {
  const row = await prisma.appSetting.findUnique({ where: { id: 'singleton' } });
  if (!row?.evmAutoCaptureEnabled) return { ran: false as const };
  if (now.getUTCDay() !== row.evmAutoCaptureWeekday) return { ran: false as const };
  if (row.evmAutoCaptureLastRunAt && dayUTC(row.evmAutoCaptureLastRunAt) >= dayUTC(now)) return { ran: false as const };

  const res = await autoCaptureWeekly(now);
  await prisma.appSetting.update({ where: { id: 'singleton' }, data: { evmAutoCaptureLastRunAt: now } });
  return { ran: true as const, ...res };
}

/**
 * Scheduler entry point. The per-tenant helper above reads AppSetting and writes EvmSnapshots —
 * all tenant-scoped models — so under enforcement it MUST run inside a tenant context or the
 * fail-closed extension rejects it. When enforcement is on we fan out over every ACTIVE tenant,
 * each in its own `runWithTenant` scope (so its settings, projects and snapshots stay isolated);
 * when off we do a single global run, exactly as before (byte-identical single-tenant behaviour).
 */
export async function runWeeklyAutoCaptureIfDueAllTenants(now: Date = new Date()) {
  if (!multitenancyEnforced()) return runWeeklyAutoCaptureIfDue(now);

  // Tenant is a global model, so this listing needs no context. Personal (guest sandbox) tenants
  // are skipped — they never configure corporate EVM auto-capture, and there can be many of them.
  const tenants = await prisma.tenant.findMany({ where: { status: 'ACTIVE', isPersonal: false }, select: { id: true } });
  let ran = false, captured = 0, failed = 0, total = 0;
  for (const t of tenants) {
    const r = await runWithTenant(t.id, () => runWeeklyAutoCaptureIfDue(now));
    if (r.ran) { ran = true; captured += r.captured; failed += r.failed; total += r.total; }
  }
  return ran ? { ran: true as const, captured, failed, total } : { ran: false as const };
}
