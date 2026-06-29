import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getCostSummary } from '../cost/cost.service.js';

const GLOBAL_ROLES: Role[] = ['ADMIN', 'PMO'];
const dec = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));
const DAY = 86_400_000;

export type AlertType = 'OVERDUE_TASK' | 'HIGH_RISK' | 'BUDGET_OVERRUN' | 'OVERSPEND';
export type AlertSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Alert {
  type: AlertType;
  severity: AlertSeverity;
  tab: 'Schedule' | 'Risk' | 'Cost';
  message: string;
}

// Compute live alerts for one project from its current state.
export async function getProjectAlerts(projectId: string, now: Date): Promise<{ alerts: Alert[]; counts: Record<AlertSeverity, number> }> {
  const [tasks, risks, cost] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, select: { id: true, name: true, parentTaskId: true, planEnd: true, progressPct: true } }),
    prisma.risk.findMany({ where: { projectId }, select: { code: true, title: true, severity: true, status: true } }),
    getCostSummary(projectId),
  ]);

  const alerts: Alert[] = [];

  // 1) Overdue leaf tasks (planned end passed, not complete).
  const parentIds = new Set(tasks.filter((t) => t.parentTaskId).map((t) => t.parentTaskId!));
  for (const t of tasks) {
    if (parentIds.has(t.id)) continue; // skip summary rows
    if (t.progressPct >= 100) continue;
    const lateMs = now.getTime() - new Date(t.planEnd).getTime();
    if (lateMs > 0) {
      const days = Math.floor(lateMs / DAY);
      alerts.push({
        type: 'OVERDUE_TASK',
        severity: days > 14 ? 'HIGH' : 'MEDIUM',
        tab: 'Schedule',
        message: `Task "${t.name}" is ${days}d overdue (${t.progressPct}% done)`,
      });
    }
  }

  // 2) High/critical open risks.
  for (const r of risks) {
    if (r.status === 'CLOSED') continue;
    if (r.severity === 'CRITICAL' || r.severity === 'HIGH') {
      alerts.push({
        type: 'HIGH_RISK',
        severity: r.severity === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
        tab: 'Risk',
        message: `Risk ${r.code} "${r.title}" is ${r.severity}`,
      });
    }
  }

  // 3) Budget signals. BAC = PMB (cost baseline, excl. management reserve).
  const bac = dec(cost.baseline?.costBaseline);
  const charterCost = cost.highLevelCharterCost ?? 0;
  const actual = cost.actualCostTotal ?? 0;
  if (charterCost > 0 && bac > charterCost) {
    alerts.push({
      type: 'BUDGET_OVERRUN',
      severity: 'MEDIUM',
      tab: 'Cost',
      message: `Detailed budget (BAC) exceeds the charter estimate by Rp ${Math.round(bac - charterCost).toLocaleString('id-ID')}`,
    });
  }
  if (bac > 0 && actual > bac) {
    alerts.push({
      type: 'OVERSPEND',
      severity: 'HIGH',
      tab: 'Cost',
      message: `Actual cost has exceeded BAC by Rp ${Math.round(actual - bac).toLocaleString('id-ID')}`,
    });
  }

  const counts: Record<AlertSeverity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const a of alerts) counts[a.severity] += 1;
  return { alerts, counts };
}

export interface PortfolioAlertRow {
  projectId: string;
  code: string;
  name: string;
  total: number;
  high: number;
}

// Portfolio-wide alert summary for the header bell (scoped to visible projects).
export async function getPortfolioAlerts(userId: string, role: string, now: Date) {
  const where: Prisma.ProjectWhereInput = { deletedAt: null, status: { not: 'DRAFT' } };
  if (!GLOBAL_ROLES.includes(role as Role)) where.pmUserId = userId;

  const projects = await prisma.project.findMany({ where, select: { id: true, code: true, name: true } });

  const rows: PortfolioAlertRow[] = [];
  let total = 0;
  let high = 0;
  for (const p of projects) {
    const { alerts, counts } = await getProjectAlerts(p.id, now);
    if (alerts.length === 0) continue;
    rows.push({ projectId: p.id, code: p.code, name: p.name, total: alerts.length, high: counts.HIGH });
    total += alerts.length;
    high += counts.HIGH;
  }
  rows.sort((a, b) => b.high - a.high || b.total - a.total);
  return { projects: rows, total, high };
}

// Recent edits to WBS / Cost / Risk across the portfolio — surfaced to ADMIN & PMO
// so they're notified of every change the PMs make. Reads the append-only audit log.
const CHANGE_ENTITIES = ['Task', 'CostItemDirect', 'CostItemIndirect', 'Risk'];
const ENTITY_AREA: Record<string, string> = {
  Task: 'WBS', CostItemDirect: 'Cost', CostItemIndirect: 'Cost', Risk: 'Risk',
};

export async function markChangesSeen(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { changesSeenAt: new Date() } });
  return { ok: true };
}

export async function getRecentChanges(userId: string, role: string, limit = 25) {
  if (!GLOBAL_ROLES.includes(role as Role)) return { changes: [], unread: 0 };

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { changesSeenAt: true } });
  const seenAt = me?.changesSeenAt?.getTime() ?? 0;

  const rows = await prisma.auditLog.findMany({
    where: { entity: { in: CHANGE_ENTITIES }, action: { in: ['CREATE', 'UPDATE', 'DELETE'] }, projectId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    include: { user: { select: { name: true, role: true } } },
  });

  const ids = [...new Set(rows.map((r) => r.projectId!).filter(Boolean))];
  const projects = await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } });
  const pmap = new Map(projects.map((p) => [p.id, p]));

  let unread = 0;
  const changes = rows.map((r) => {
    // A change is "new" if it's after the user last viewed the feed and not their own.
    const isNew = r.createdAt.getTime() > seenAt && r.userId !== userId;
    if (isNew) unread += 1;
    return {
      id: r.id,
      area: ENTITY_AREA[r.entity] ?? r.entity,
      action: r.action,
      projectId: r.projectId,
      projectCode: pmap.get(r.projectId!)?.code ?? '—',
      projectName: pmap.get(r.projectId!)?.name ?? '—',
      by: r.user?.name ?? '—',
      byRole: r.user?.role ?? null,
      at: r.createdAt,
      isNew,
    };
  });
  return { changes, unread };
}

// =====================================================================
// "Needs attention" — actionable items across the caller's visible
// projects (PM = own projects). Reuses live project alerts (overdue
// tasks, high risks, budget signals) and adds change requests awaiting
// a decision. Drives the PM dashboard action panel.
// =====================================================================
export interface AttentionItem {
  projectId: string;
  projectCode: string;
  projectName: string;
  type: AlertType | 'CHANGE_REQUEST';
  severity: AlertSeverity;
  tab: string;
  message: string;
}

export async function getAttentionItems(userId: string, role: string, now: Date) {
  const where: Prisma.ProjectWhereInput = { deletedAt: null, status: { not: 'DRAFT' } };
  if (!GLOBAL_ROLES.includes(role as Role)) where.pmUserId = userId;
  const projects = await prisma.project.findMany({ where, select: { id: true, code: true, name: true } });

  const items: AttentionItem[] = [];
  for (const p of projects) {
    const { alerts } = await getProjectAlerts(p.id, now);
    for (const a of alerts) {
      items.push({ projectId: p.id, projectCode: p.code, projectName: p.name, type: a.type, severity: a.severity, tab: a.tab, message: a.message });
    }
  }

  // Change requests still awaiting a decision.
  const crs = await prisma.changeRequest.findMany({
    where: { projectId: { in: projects.map((p) => p.id) }, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
    select: { title: true, projectId: true, project: { select: { code: true, name: true } } },
  });
  for (const cr of crs) {
    items.push({ projectId: cr.projectId, projectCode: cr.project.code, projectName: cr.project.name, type: 'CHANGE_REQUEST', severity: 'MEDIUM', tab: 'Change Req', message: `Change request “${cr.title}” awaiting a decision` });
  }

  const rank: Record<AlertSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  items.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { items, total: items.length, high: items.filter((i) => i.severity === 'HIGH').length };
}
