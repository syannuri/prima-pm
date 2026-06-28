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

  // 3) Budget signals.
  const bac = dec(cost.baseline?.budgetAtCompletion);
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
