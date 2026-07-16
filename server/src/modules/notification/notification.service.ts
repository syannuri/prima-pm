import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

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

// Raw inputs the alert rules need, per project. Loaded in bulk (loadAlertInputs) so many
// projects share a FIXED number of queries instead of ~9 per project via getCostSummary.
interface AlertInput {
  tasks: { id: string; name: string; parentTaskId: string | null; planEnd: Date; progressPct: number }[];
  risks: { code: string; title: string; severity: string; status: string }[];
  bac: number;            // cost baseline (PMB) = costBaseline.costBaseline
  charterCost: number;    // charter high-level estimate (hiCostIdr)
  actualCostTotal: number; // Σ ActualCostEntry.amount — same value getCostSummary sums
}

// Batch-load alert inputs for many projects in a FIXED 5 bulk queries (was 3 queries — one of
// them a full getCostSummary ≈ 7 more — PER project). The per-project cost fields read here
// (costBaseline.costBaseline, charter.hiCostIdr, Σ actualCost.amount) are exactly the three
// values getProjectAlerts used from getCostSummary, so alerts are unchanged.
async function loadAlertInputs(ids: string[]): Promise<Map<string, AlertInput>> {
  const out = new Map<string, AlertInput>();
  if (ids.length === 0) return out;

  const [taskRows, riskRows, baselines, charters, acAgg] = await Promise.all([
    prisma.task.findMany({ where: { projectId: { in: ids } }, select: { id: true, projectId: true, name: true, parentTaskId: true, planEnd: true, progressPct: true } }),
    prisma.risk.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, code: true, title: true, severity: true, status: true } }),
    prisma.costBaseline.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, costBaseline: true } }),
    prisma.projectCharter.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, hiCostIdr: true } }),
    prisma.actualCostEntry.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _sum: { amount: true } }),
  ]);

  const tasksBy = new Map<string, AlertInput['tasks']>();
  for (const t of taskRows) {
    let arr = tasksBy.get(t.projectId);
    if (!arr) tasksBy.set(t.projectId, (arr = []));
    arr.push({ id: t.id, name: t.name, parentTaskId: t.parentTaskId, planEnd: t.planEnd, progressPct: t.progressPct });
  }
  const risksBy = new Map<string, AlertInput['risks']>();
  for (const r of riskRows) {
    let arr = risksBy.get(r.projectId);
    if (!arr) risksBy.set(r.projectId, (arr = []));
    arr.push({ code: r.code, title: r.title, severity: r.severity, status: r.status });
  }
  const bacBy = new Map(baselines.map((b) => [b.projectId, dec(b.costBaseline)] as const));
  const charterBy = new Map(charters.map((c) => [c.projectId, dec(c.hiCostIdr)] as const));
  const acBy = new Map(acAgg.map((a) => [a.projectId, dec(a._sum.amount)] as const));

  for (const id of ids) {
    out.set(id, {
      tasks: tasksBy.get(id) ?? [],
      risks: risksBy.get(id) ?? [],
      bac: bacBy.get(id) ?? 0,
      charterCost: charterBy.get(id) ?? 0,
      actualCostTotal: acBy.get(id) ?? 0,
    });
  }
  return out;
}

// PURE alert rules from already-loaded inputs. The single-project (getProjectAlerts) and the
// batched (portfolio bell / attention feed) paths both funnel through this ONE function, so
// their alerts are identical by construction.
function computeAlerts(input: AlertInput, now: Date): { alerts: Alert[]; counts: Record<AlertSeverity, number> } {
  const { tasks, risks, bac, charterCost, actualCostTotal } = input;
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
  if (charterCost > 0 && bac > charterCost) {
    alerts.push({
      type: 'BUDGET_OVERRUN',
      severity: 'MEDIUM',
      tab: 'Cost',
      message: `Detailed budget (BAC) exceeds the charter estimate by Rp ${Math.round(bac - charterCost).toLocaleString('id-ID')}`,
    });
  }
  if (bac > 0 && actualCostTotal > bac) {
    alerts.push({
      type: 'OVERSPEND',
      severity: 'HIGH',
      tab: 'Cost',
      message: `Actual cost has exceeded BAC by Rp ${Math.round(actualCostTotal - bac).toLocaleString('id-ID')}`,
    });
  }

  const counts: Record<AlertSeverity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const a of alerts) counts[a.severity] += 1;
  return { alerts, counts };
}

// Compute live alerts for ONE project (per-project route). Thin wrapper over the batched loader.
export async function getProjectAlerts(projectId: string, now: Date): Promise<{ alerts: Alert[]; counts: Record<AlertSeverity, number> }> {
  const input = (await loadAlertInputs([projectId])).get(projectId);
  if (!input) return { alerts: [], counts: { HIGH: 0, MEDIUM: 0, LOW: 0 } };
  return computeAlerts(input, now);
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
  // Corporate roles (ADMIN/PMO) see the corporate portfolio only — never a guest's personal
  // sandbox. A PM (or a guest) sees only projects they manage (a guest's personal projects have
  // pmUserId = self, so this scopes them to their own without leaking corporate work).
  if (GLOBAL_ROLES.includes(role as Role)) where.personalOwnerId = null;
  else where.pmUserId = userId;

  const projects = await prisma.project.findMany({ where, select: { id: true, code: true, name: true } });

  // Alert inputs for ALL visible projects in one batch (5 bulk queries) instead of ~9 per
  // project; alerts derived in memory. Replaces the per-project Promise.all on the header bell.
  const inputs = await loadAlertInputs(projects.map((p) => p.id));

  const rows: PortfolioAlertRow[] = [];
  let total = 0;
  let high = 0;
  projects.forEach((p) => {
    const { alerts, counts } = computeAlerts(inputs.get(p.id)!, now);
    if (alerts.length === 0) return;
    rows.push({ projectId: p.id, code: p.code, name: p.name, total: alerts.length, high: counts.HIGH });
    total += alerts.length;
    high += counts.HIGH;
  });
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

// ---- Persistent per-user inbox (discrete events, e.g. project assignment) ----
export async function createNotification(input: { userId: string; type: string; title: string; body?: string | null; projectId?: string | null }) {
  try {
    await prisma.notification.create({
      data: { userId: input.userId, type: input.type, title: input.title, body: input.body ?? null, projectId: input.projectId ?? null },
    });
  } catch (err) {
    // Notifications must never break the business operation that triggered them.
    console.error('[notification] failed to create', err);
  }
}

export async function getInbox(userId: string, limit = 20) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: Math.min(limit, 50) }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markInboxSeen(userId: string) {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return { ok: true };
}

const CR_INCLUDE = {
  requester: { select: { name: true } },
  reviewer: { select: { name: true } },
  decider: { select: { name: true } },
  project: { select: { id: true, code: true, name: true } },
} as const;

// Change requests awaiting a PMO/ADMIN decision, across all live projects.
export async function getPendingApprovals(role: string) {
  if (!GLOBAL_ROLES.includes(role as Role)) return { items: [], count: 0 };
  const items = await prisma.changeRequest.findMany({
    where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] }, project: { deletedAt: null } },
    orderBy: { createdAt: 'asc' },
    include: CR_INCLUDE,
  });
  return { items, count: items.length };
}

export async function getRecentChanges(userId: string, role: string, limit = 25) {
  if (!GLOBAL_ROLES.includes(role as Role)) return { changes: [], unread: 0 };

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { changesSeenAt: true } });
  const seenAt = me?.changesSeenAt?.getTime() ?? 0;

  // Corporate-only feed: never surface a guest's personal-project activity to ADMIN/PMO.
  const personalIds = (await prisma.project.findMany({ where: { personalOwnerId: { not: null } }, select: { id: true } })).map((p) => p.id);

  const rows = await prisma.auditLog.findMany({
    where: { entity: { in: CHANGE_ENTITIES }, action: { in: ['CREATE', 'UPDATE', 'DELETE'] }, projectId: { not: null, notIn: personalIds } },
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
  // Corporate feed excludes guest sandboxes; a PM/guest sees only projects they manage.
  if (GLOBAL_ROLES.includes(role as Role)) where.personalOwnerId = null;
  else where.pmUserId = userId;
  const projects = await prisma.project.findMany({ where, select: { id: true, code: true, name: true } });

  // Alert inputs for ALL managed projects in one batch (5 bulk queries), derived in memory.
  // Replaces the per-project Promise.all on the PM dashboard's attention feed.
  const inputs = await loadAlertInputs(projects.map((p) => p.id));

  const items: AttentionItem[] = [];
  projects.forEach((p) => {
    for (const a of computeAlerts(inputs.get(p.id)!, now).alerts) {
      items.push({ projectId: p.id, projectCode: p.code, projectName: p.name, type: a.type, severity: a.severity, tab: a.tab, message: a.message });
    }
  });

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
