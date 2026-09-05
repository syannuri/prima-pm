import type { Prisma, Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';

const GLOBAL_ROLES: Role[] = ['ADMIN', 'PMO'];
// Stable identity of a live "Needs attention" alert for the per-user dismissal store. The message
// encodes the alert's magnitude (days overdue, Rp overrun, severity), so a worsening alert yields a
// DIFFERENT signature → a followed-up alert re-appears when it changes.
const alertSignature = (projectId: string, type: string, message: string) =>
  createHash('sha256').update(`${projectId}|${type}|${message}`).digest('hex');
const dec = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));
const DAY = 86_400_000;
// Prune dismissals this old so the table can't grow unbounded (old signatures never match again).
const DISMISSAL_TTL = 60 * DAY;

export type AlertType = 'OVERDUE_TASK' | 'DUE_SOON_TASK' | 'HIGH_RISK' | 'BUDGET_OVERRUN' | 'OVERSPEND';
export type AlertSeverity = 'HIGH' | 'MEDIUM' | 'LOW';
// A leaf task/milestone is "due soon" when its planned finish falls within the next N whole days
// (proactive heads-up BEFORE it slips into OVERDUE). Kept in lock-step with the overdue rule.
const DUE_SOON_WINDOW_DAYS = 7;

export interface Alert {
  type: AlertType;
  severity: AlertSeverity;
  tab: 'Schedule' | 'Risk' | 'Cost';
  message: string;
  // Optional id of the specific entity the alert is about (e.g. the overdue task) so the client
  // can deep-link to it and scroll/highlight it, not just open the tab.
  entityId?: string;
}

// Raw inputs the alert rules need, per project. Loaded in bulk (loadAlertInputs) so many
// projects share a FIXED number of queries instead of ~9 per project via getCostSummary.
interface AlertInput {
  tasks: { id: string; name: string; parentTaskId: string | null; planEnd: Date; progressPct: number; isMilestone: boolean }[];
  risks: { id: string; code: string; title: string; severity: string; status: string }[];
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
    prisma.task.findMany({ where: { projectId: { in: ids } }, select: { id: true, projectId: true, name: true, parentTaskId: true, planEnd: true, progressPct: true, isMilestone: true } }),
    prisma.risk.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, id: true, code: true, title: true, severity: true, status: true } }),
    prisma.costBaseline.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, costBaseline: true } }),
    prisma.projectCharter.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, hiCostIdr: true } }),
    prisma.actualCostEntry.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _sum: { amount: true } }),
  ]);

  const tasksBy = new Map<string, AlertInput['tasks']>();
  for (const t of taskRows) {
    let arr = tasksBy.get(t.projectId);
    if (!arr) tasksBy.set(t.projectId, (arr = []));
    arr.push({ id: t.id, name: t.name, parentTaskId: t.parentTaskId, planEnd: t.planEnd, progressPct: t.progressPct, isMilestone: t.isMilestone });
  }
  const risksBy = new Map<string, AlertInput['risks']>();
  for (const r of riskRows) {
    let arr = risksBy.get(r.projectId);
    if (!arr) risksBy.set(r.projectId, (arr = []));
    arr.push({ id: r.id, code: r.code, title: r.title, severity: r.severity, status: r.status });
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

  // 1) Overdue leaf tasks (planned end passed, not complete) + a proactive "due soon" heads-up for
  // leaf tasks/milestones whose finish is within the next window (before they slip into overdue).
  const parentIds = new Set(tasks.filter((t) => t.parentTaskId).map((t) => t.parentTaskId!));
  const today = Math.floor(now.getTime() / DAY);
  for (const t of tasks) {
    if (parentIds.has(t.id)) continue; // skip summary rows
    if (t.progressPct >= 100) continue;
    // WHOLE calendar days late — a task due TODAY is not overdue until tomorrow (floor to the day,
    // matching the Gantt + report.service). Prevents a confusing "0d overdue" alert. daysLate<0 = the
    // finish is still ahead (−daysLate = days until due).
    const daysLate = today - Math.floor(new Date(t.planEnd).getTime() / DAY);
    const noun = t.isMilestone ? 'Milestone' : 'Task';
    if (daysLate >= 1) {
      alerts.push({
        type: 'OVERDUE_TASK',
        severity: daysLate > 14 ? 'HIGH' : 'MEDIUM',
        tab: 'Schedule',
        message: `${noun} "${t.name}" is ${daysLate}d overdue (${t.progressPct}% done)`,
        entityId: t.id,
      });
    } else if (daysLate >= -DUE_SOON_WINDOW_DAYS) {
      // Due within the window (daysLate in [−7, 0]). "Due today/tomorrow" is the more urgent MEDIUM;
      // the rest is a low-priority LOW so it never drowns out genuinely-late work.
      const daysUntil = -daysLate;
      const when = daysUntil === 0 ? 'due today' : daysUntil === 1 ? 'due tomorrow' : `due in ${daysUntil}d`;
      alerts.push({
        type: 'DUE_SOON_TASK',
        severity: daysUntil <= 1 ? 'MEDIUM' : 'LOW',
        tab: 'Schedule',
        message: `${noun} "${t.name}" is ${when} (${t.progressPct}% done)`,
        entityId: t.id,
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
        entityId: r.id,
      });
    }
  }

  // 3) Budget signals. BAC = PMB (cost baseline, excl. management reserve).
  // The charter estimate is a rough order-of-magnitude figure, so ignore trivial (rounding-level)
  // overages — only flag a MATERIAL overrun (more than Rp 1jt or 0.5% of the charter). Without a
  // tolerance a Rp 200 delta on a Rp 1B budget cried "wolf" as a MEDIUM alert.
  const bacOverCharter = bac - charterCost;
  if (charterCost > 0 && bacOverCharter > Math.max(1_000_000, charterCost * 0.005)) {
    alerts.push({
      type: 'BUDGET_OVERRUN',
      severity: 'MEDIUM',
      tab: 'Cost',
      message: `Detailed budget (BAC) exceeds the charter estimate by Rp ${Math.round(bacOverCharter).toLocaleString('id-ID')}`,
      // Project-level budget signal — no single line to point at, so focus the charter↔baseline banner.
      entityId: 'baseline',
    });
  }
  if (bac > 0 && actualCostTotal > bac) {
    alerts.push({
      type: 'OVERSPEND',
      severity: 'HIGH',
      tab: 'Cost',
      message: `Actual cost has exceeded BAC by Rp ${Math.round(actualCostTotal - bac).toLocaleString('id-ID')}`,
      // Project-level overspend — focus the Spent/Available summary tiles.
      entityId: 'spent',
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
  const where: Prisma.ProjectWhereInput = { deletedAt: null, archivedAt: null, status: { not: 'DRAFT' } };
  // Guest sandboxes are kept out of corporate feeds by tenant scoping (guests are their own tenant);
  // only the role rule remains — a non-global role (PM/guest) sees only projects they manage.
  if (!GLOBAL_ROLES.includes(role as Role)) where.pmUserId = userId;

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

export interface PortfolioAlertDetail {
  projectId: string;
  code: string;
  name: string;
  alerts: Alert[];
  counts: Record<AlertSeverity, number>;
}

// Like getPortfolioAlerts but keeps the actual Alert[] per project (messages + deep-link entityId),
// not just counts — the alert-digest email needs the individual lines. Same single-batch query path
// and same visibility scoping (a non-global role sees only projects they manage). Projects with no
// alerts are omitted; most-severe project first (HIGH count, then total).
export async function getPortfolioAlertDetail(userId: string, role: string, now: Date): Promise<PortfolioAlertDetail[]> {
  const where: Prisma.ProjectWhereInput = { deletedAt: null, archivedAt: null, status: { not: 'DRAFT' } };
  if (!GLOBAL_ROLES.includes(role as Role)) where.pmUserId = userId;

  const projects = await prisma.project.findMany({ where, select: { id: true, code: true, name: true } });
  const inputs = await loadAlertInputs(projects.map((p) => p.id));

  const out: PortfolioAlertDetail[] = [];
  projects.forEach((p) => {
    const { alerts, counts } = computeAlerts(inputs.get(p.id)!, now);
    if (alerts.length === 0) return;
    out.push({ projectId: p.id, code: p.code, name: p.name, alerts, counts });
  });
  out.sort((a, b) => b.counts.HIGH - a.counts.HIGH || b.alerts.length - a.alerts.length);
  return out;
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
export async function createNotification(input: { userId: string; type: string; title: string; body?: string | null; projectId?: string | null; link?: string | null }) {
  try {
    await prisma.notification.create({
      data: { userId: input.userId, type: input.type, title: input.title, body: input.body ?? null, projectId: input.projectId ?? null, link: input.link ?? null },
    });
  } catch (err) {
    // Notifications must never break the business operation that triggered them.
    console.error('[notification] failed to create', err);
  }
}

// The inbox shows only items NOT yet followed up (readAt = the "followed up / done" marker, set
// per-item via the ✓ button). A handled item never comes back.
export async function getInbox(userId: string, limit = 20) {
  const items = await prisma.notification.findMany({ where: { userId, readAt: null }, orderBy: { createdAt: 'desc' }, take: Math.min(limit, 50) });
  return { items, unread: items.length };
}

// ---- Notification categories (shared by the Center's filters + the email prefs) ----
// Derived from the stored `type`. Only STORED notification types appear here; the derived project
// alerts (OVERDUE_TASK/DUE_SOON_TASK/… from computeAlerts) live in the bell's live "Attention" feed,
// never as rows, so they aren't a history category.
export type NotifCategory = 'approvals' | 'assignments' | 'account' | 'other';
const APPROVAL_TYPES = ['APPROVAL_PENDING', 'APPROVAL_OVERDUE', 'CR_SUBMITTED', 'CR_APPROVED', 'CR_REJECTED', 'ACTIVATION_APPROVED', 'ACTIVATION_READY', 'ACTIVATION_REVISION'];
const ASSIGNMENT_TYPES = ['PROJECT_ASSIGNED'];
const ACCOUNT_TYPES = ['ORG_SIGNUP_PENDING', 'SECURITY_GHOST_LOGIN'];
const KNOWN_TYPES = [...APPROVAL_TYPES, ...ASSIGNMENT_TYPES, ...ACCOUNT_TYPES];

export function notifCategory(type: string): NotifCategory {
  if (APPROVAL_TYPES.includes(type)) return 'approvals';
  if (ASSIGNMENT_TYPES.includes(type)) return 'assignments';
  if (ACCOUNT_TYPES.includes(type) || type.startsWith('trial-reminder')) return 'account';
  return 'other';
}

// Prisma filter for a category tab (undefined/'all' = no filter). Done in-DB so pagination stays
// correct. 'account' also matches the dynamically-suffixed trial-reminder:<bucket> types.
function categoryFilter(category?: string): Prisma.NotificationWhereInput {
  switch (category) {
    case 'approvals': return { type: { in: APPROVAL_TYPES } };
    case 'assignments': return { type: { in: ASSIGNMENT_TYPES } };
    case 'account': return { OR: [{ type: { in: ACCOUNT_TYPES } }, { type: { startsWith: 'trial-reminder' } }] };
    case 'other': return { AND: [{ type: { notIn: KNOWN_TYPES } }, { NOT: { type: { startsWith: 'trial-reminder' } } }] };
    default: return {};
  }
}

// Full notification history (read + unread), newest first, cursor-paginated. The Notification Center
// page uses this (the bell keeps its unread-only getInbox). Each item carries its derived category.
export async function getNotificationHistory(userId: string, opts: { cursor?: string | null; limit?: number; category?: string } = {}) {
  const limit = Math.min(opts.limit ?? 25, 50);
  const rows = await prisma.notification.findMany({
    where: { userId, ...categoryFilter(opts.category) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map((n) => ({ ...n, category: notifCategory(n.type) }));
  return { items, nextCursor: hasMore ? page[page.length - 1].id : null };
}

// Mark ONE inbox notification followed up (✓). Scoped to the caller so nobody can clear another
// user's inbox.
export async function markNotificationRead(userId: string, id: string) {
  await prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
  return { ok: true };
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

  // Tenant scoping keeps a guest's personal-project activity out of the corporate feed (AuditLog is
  // tenant-scoped, and guests live in their own tenant).
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
  entityId?: string; // specific entity (e.g. overdue task id) for deep-link + highlight
  key: string; // dismissal signature (POST /attention/dismiss to follow it up)
}

// Record that the caller has followed up an attention item (✓). Idempotent; only re-appears if the
// underlying alert changes (→ new signature). Best-effort prune of stale dismissals.
export async function dismissAttention(userId: string, signature: string) {
  await prisma.alertDismissal.upsert({
    where: { userId_signature: { userId, signature } },
    create: { userId, signature },
    update: {},
  });
  await prisma.alertDismissal.deleteMany({ where: { userId, createdAt: { lt: new Date(Date.now() - DISMISSAL_TTL) } } });
  return { ok: true };
}

export async function getAttentionItems(userId: string, role: string, now: Date) {
  const where: Prisma.ProjectWhereInput = { deletedAt: null, archivedAt: null, status: { not: 'DRAFT' } };
  // Guest sandboxes are kept out by tenant scoping; only the role rule remains — a non-global role
  // (PM/guest) sees only projects they manage.
  if (!GLOBAL_ROLES.includes(role as Role)) where.pmUserId = userId;
  const projects = await prisma.project.findMany({ where, select: { id: true, code: true, name: true } });

  // Alert inputs for ALL managed projects in one batch (5 bulk queries), derived in memory.
  // Replaces the per-project Promise.all on the PM dashboard's attention feed.
  const inputs = await loadAlertInputs(projects.map((p) => p.id));

  const items: AttentionItem[] = [];
  const push = (i: Omit<AttentionItem, 'key'>) => items.push({ ...i, key: alertSignature(i.projectId, i.type, i.message) });
  projects.forEach((p) => {
    for (const a of computeAlerts(inputs.get(p.id)!, now).alerts) {
      push({ projectId: p.id, projectCode: p.code, projectName: p.name, type: a.type, severity: a.severity, tab: a.tab, message: a.message, entityId: a.entityId });
    }
  });

  // Change requests still awaiting a decision.
  const crs = await prisma.changeRequest.findMany({
    where: { projectId: { in: projects.map((p) => p.id) }, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
    select: { title: true, projectId: true, project: { select: { code: true, name: true } } },
  });
  for (const cr of crs) {
    push({ projectId: cr.projectId, projectCode: cr.project.code, projectName: cr.project.name, type: 'CHANGE_REQUEST', severity: 'MEDIUM', tab: 'Change Req', message: `Change request “${cr.title}” awaiting a decision` });
  }

  // Drop items the caller has already followed up (✓) — unless the alert changed (→ new signature).
  const dismissed = new Set((await prisma.alertDismissal.findMany({ where: { userId }, select: { signature: true } })).map((d) => d.signature));
  const visible = dismissed.size ? items.filter((i) => !dismissed.has(i.key)) : items;

  const rank: Record<AlertSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  visible.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { items: visible, total: visible.length, high: visible.filter((i) => i.severity === 'HIGH').length };
}
