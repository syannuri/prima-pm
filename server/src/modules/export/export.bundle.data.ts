// Full-project "bundle" serializer — a self-contained JSON snapshot of every DOMAIN component of a
// project across its whole lifecycle (Initiation → Closing), designed for a faithful round-trip via
// the bundle importer (clone / backup / migrate). Cross-entity foreign keys are rewritten as
// in-bundle references: rows keep their original id as `localId`, and FKs point at those ids so the
// importer can remap them to fresh ids. User references are serialised by EMAIL and Resource / Rate
// Card references by a small lookup table, so a clone can resolve (or recreate) them in the target
// tenant. Derived / operational data (EVM & sprint snapshots, baseline/charter version history,
// audit, AI, approvals, attachment binaries, bookmarks, commentary, change requests) is excluded.
import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { Prisma } from '@prisma/client';

// v2 added: costBaseline (frozen EVM baseline + reserves), scheduleBaselinedAt, projectDependencies
// (cross-project register), customFieldValues (Tier-3, project + task). The importer still reads v1
// bundles — the new sections just default to empty/null.
export const BUNDLE_FORMAT_VERSION = 2;
// Versions this server's importer can read.
export const SUPPORTED_BUNDLE_VERSIONS = [1, 2];

// Prisma Decimal → plain number (or null), so the JSON carries numbers, not Decimal strings.
const dec = (v: Prisma.Decimal | number | null | undefined): number | null =>
  v == null ? null : Number(v);

export async function gatherProjectBundle(projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    include: { pm: { select: { email: true, name: true } } },
  });
  if (!project) throw NotFound('Project not found');

  const [
    charter, tasks, deps, costDirect, costIndirect, actualCosts, mandayEntries,
    risks, issues, stakeholders, requirements, reqLinks, procurement, assumptions,
    uat, sprints, backlog, lessons, acceptances, costBaseline, projectDeps,
  ] = await Promise.all([
    prisma.projectCharter.findUnique({ where: { projectId } }),
    prisma.task.findMany({
      where: { projectId },
      include: { owners: { select: { resourceId: true } }, steps: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.taskDependency.findMany({ where: { predecessor: { projectId } } }),
    prisma.costItemDirect.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' } }),
    prisma.costItemIndirect.findMany({ where: { projectId } }),
    prisma.actualCostEntry.findMany({ where: { projectId }, orderBy: { date: 'asc' } }),
    prisma.mandayEntry.findMany({ where: { projectId }, orderBy: { date: 'asc' } }),
    prisma.risk.findMany({ where: { projectId }, orderBy: { code: 'asc' } }),
    prisma.issue.findMany({ where: { projectId }, orderBy: { code: 'asc' } }),
    prisma.stakeholder.findMany({ where: { projectId }, orderBy: { code: 'asc' } }),
    prisma.requirement.findMany({ where: { projectId }, orderBy: { code: 'asc' } }),
    prisma.requirementTaskLink.findMany({ where: { requirement: { projectId } } }),
    prisma.procurement.findMany({ where: { projectId }, orderBy: { code: 'asc' } }),
    prisma.assumption.findMany({ where: { projectId }, orderBy: { code: 'asc' } }),
    prisma.uatTestCase.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' } }),
    prisma.sprint.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' } }),
    prisma.backlogItem.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' } }),
    prisma.lessonLearned.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
    prisma.acceptanceSignoff.findMany({ where: { projectId }, orderBy: { signedAt: 'asc' } }),
    prisma.costBaseline.findUnique({ where: { projectId } }),
    prisma.projectDependency.findMany({ where: { projectId }, orderBy: { code: 'asc' } }),
  ]);

  // Tier-3 custom-field values for this project + its tasks (entityId = projectId or taskId), with
  // their definition so the importer can resolve/create the def in the target tenant.
  const taskIds = tasks.map((t) => t.id);
  const customFieldValues = await prisma.customFieldValue.findMany({
    where: { entityId: { in: [projectId, ...taskIds] } },
    include: { def: { select: { entity: true, key: true, label: true, type: true, options: true, required: true, sortOrder: true } } },
  });

  // --- Resolve referenced Resources → a lookup table keyed by their original id. ---
  const resourceIds = new Set<string>();
  for (const t of tasks) {
    if (t.picResourceId) resourceIds.add(t.picResourceId);
    for (const o of t.owners) resourceIds.add(o.resourceId);
  }
  for (const c of costDirect) if (c.resourceId) resourceIds.add(c.resourceId);
  const resourceRows = resourceIds.size
    ? await prisma.resource.findMany({
        where: { id: { in: [...resourceIds] } },
        include: { user: { select: { email: true } }, rateCard: { select: { roleName: true } } },
      })
    : [];

  // --- Resolve referenced Users (by id) → email, for owner/assignee/manpower refs. ---
  const userIds = new Set<string>();
  const addUser = (id: string | null | undefined) => { if (id) userIds.add(id); };
  risks.forEach((r) => addUser(r.ownerUserId));
  issues.forEach((i) => addUser(i.ownerUserId));
  assumptions.forEach((a) => addUser(a.ownerUserId));
  backlog.forEach((b) => addUser(b.assigneeUserId));
  costDirect.forEach((c) => addUser(c.resourceUserId));
  projectDeps.forEach((d) => addUser(d.ownerUserId));
  const userRows = userIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, email: true } })
    : [];
  const emailOf = new Map(userRows.map((u) => [u.id, u.email] as const));
  const userRef = (id: string | null | undefined) => (id ? emailOf.get(id) ?? null : null);

  // --- Rate cards referenced by cost lines → serialise by role name. ---
  const rateCardIds = new Set<string>();
  costDirect.forEach((c) => { if (c.rateCardId) rateCardIds.add(c.rateCardId); });
  const rateCardRows = rateCardIds.size
    ? await prisma.rateCard.findMany({ where: { id: { in: [...rateCardIds] } }, select: { id: true, roleName: true } })
    : [];
  const rateCardRef = new Map(rateCardRows.map((r) => [r.id, r.roleName] as const));

  return {
    formatVersion: BUNDLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedFrom: { code: project.code, name: project.name },

    project: {
      name: project.name,
      clientName: project.clientName,
      sponsor: project.sponsor,
      category: project.category,
      categoryOther: project.categoryOther,
      deliveryApproach: project.deliveryApproach,
      costBaselineIdr: dec(project.costBaselineIdr),
      totalRevenueIdr: dec(project.totalRevenueIdr),
      mandaysPerPoint: dec(project.mandaysPerPoint),
      autoPostLabourAc: project.autoPostLabourAc,
      scheduleBaselinedAt: project.scheduleBaselinedAt,
    },
    pm: project.pm ? { email: project.pm.email, name: project.pm.name } : null,

    // Frozen cost baseline (PMB): reserves are entered, not derivable from cost lines — so EVM/BAC
    // only reproduces in a clone if this is carried.
    costBaseline: costBaseline && {
      directTotal: dec(costBaseline.directTotal), indirectTotal: dec(costBaseline.indirectTotal),
      contingencyReserve: dec(costBaseline.contingencyReserve), managementReserve: dec(costBaseline.managementReserve),
      costBaseline: dec(costBaseline.costBaseline), budgetAtCompletion: dec(costBaseline.budgetAtCompletion),
    },

    resources: resourceRows.map((r) => ({
      ref: r.id,
      name: r.name,
      email: r.user?.email ?? null,
      resourceType: r.resourceType,
      roleTitle: r.roleTitle,
      personnelRole: r.personnelRole,
      unitCostPerManday: dec(r.unitCostPerManday),
      capacityPerDay: dec(r.capacityPerDay),
      department: r.department,
      rateCardRef: r.rateCard?.roleName ?? null,
    })),

    charter: charter && {
      description: charter.description, goals: charter.goals,
      category: charter.category, categoryOther: charter.categoryOther,
      hiScope: charter.hiScope, hiCostIdr: dec(charter.hiCostIdr),
      hiScheduleStart: charter.hiScheduleStart, hiScheduleEnd: charter.hiScheduleEnd,
      hiDeliverables: charter.hiDeliverables, hiResources: charter.hiResources,
      version: charter.version, locked: charter.locked,
      committedAt: charter.committedAt,
    },

    tasks: tasks.map((t) => ({
      localId: t.id,
      parentLocalId: t.parentTaskId,
      wbsCode: t.wbsCode, name: t.name,
      description: t.description, deliverable: t.deliverable, acceptanceCriteria: t.acceptanceCriteria,
      planStart: t.planStart, planEnd: t.planEnd,
      baselineStart: t.baselineStart, baselineFinish: t.baselineFinish,
      actualStart: t.actualStart, actualFinish: t.actualFinish,
      picResourceRef: t.picResourceId,
      ownerResourceRefs: t.owners.map((o) => o.resourceId),
      progressPct: t.progressPct, weight: t.weight, baselineWeight: t.baselineWeight,
      isMilestone: t.isMilestone, sortOrder: t.sortOrder,
      steps: t.steps.map((s) => ({ name: s.name, weight: s.weight, done: s.done, sortOrder: s.sortOrder })),
    })),
    taskDependencies: deps.map((d) => ({
      predecessorLocalId: d.predecessorId, successorLocalId: d.successorId,
      type: d.type, lagDays: d.lagDays,
    })),

    costDirect: costDirect.map((c) => ({
      localId: c.id, type: c.type, label: c.label, subCategory: c.subCategory, sortOrder: c.sortOrder,
      qty: dec(c.qty), unitCost: dec(c.unitCost), amount: dec(c.amount),
      personnelRole: c.personnelRole, resourceUserEmail: userRef(c.resourceUserId),
      rateCardRef: c.rateCardId ? rateCardRef.get(c.rateCardId) ?? null : null,
      unitCostPerManday: dec(c.unitCostPerManday), planMandays: dec(c.planMandays), manpowerCost: dec(c.manpowerCost),
      taskLocalId: c.taskId, resourceRef: c.resourceId,
    })),
    costIndirect: costIndirect.map((c) => ({
      localId: c.id, type: c.type, description: c.description, subCategory: c.subCategory, amount: dec(c.amount),
    })),
    actualCosts: actualCosts.map((a) => ({
      date: a.date, amount: dec(a.amount), description: a.description, category: a.category,
      directLineLocalId: a.directLineId, indirectLineLocalId: a.indirectLineId,
    })),
    mandayEntries: mandayEntries.map((m) => ({
      costItemLocalId: m.costItemId, date: m.date, mandays: dec(m.mandays), note: m.note,
    })),

    risks: risks.map((r) => ({
      code: r.code, title: r.title, description: r.description, category: r.category,
      status: r.status, kind: r.kind, ownerEmail: userRef(r.ownerUserId),
      probabilityScore: r.probabilityScore, impactScore: r.impactScore, riskScore: r.riskScore, severity: r.severity,
      probabilityPct: dec(r.probabilityPct), impactCostIdr: dec(r.impactCostIdr), emv: dec(r.emv),
      responseStrategy: r.responseStrategy, responseCost: dec(r.responseCost), residualEmv: dec(r.residualEmv),
      includeInReserve: r.includeInReserve,
    })),
    issues: issues.map((i) => ({
      code: i.code, title: i.title, description: i.description, category: i.category,
      impact: i.impact, status: i.status, ownerEmail: userRef(i.ownerUserId), resolution: i.resolution,
      raisedAt: i.raisedAt, resolvedAt: i.resolvedAt,
    })),
    stakeholders: stakeholders.map((s) => ({
      code: s.code, name: s.name, role: s.role, organization: s.organization, category: s.category,
      power: s.power, interest: s.interest, currentEngagement: s.currentEngagement, desiredEngagement: s.desiredEngagement,
      email: s.email, strategy: s.strategy, notes: s.notes,
    })),
    requirements: requirements.map((r) => ({
      localId: r.id, code: r.code, title: r.title, description: r.description, category: r.category,
      priority: r.priority, status: r.status, source: r.source, acceptanceCriteria: r.acceptanceCriteria, notes: r.notes,
      taskLocalIds: reqLinks.filter((l) => l.requirementId === r.id).map((l) => l.taskId),
    })),
    procurement: procurement.map((p) => ({
      code: p.code, title: p.title, vendor: p.vendor, vendorContact: p.vendorContact, type: p.type, status: p.status,
      amount: dec(p.amount), needBy: p.needBy, startDate: p.startDate, endDate: p.endDate, scope: p.scope, notes: p.notes,
      costDirectLineLocalId: p.costDirectLineId, costIndirectLineLocalId: p.costIndirectLineId,
    })),
    assumptions: assumptions.map((a) => ({
      code: a.code, statement: a.statement, category: a.category, status: a.status,
      impact: a.impact, ownerEmail: userRef(a.ownerUserId), notes: a.notes,
    })),
    uat: uat.map((u) => ({
      code: u.code, title: u.title, scenario: u.scenario, steps: u.steps, expected: u.expected, actual: u.actual,
      status: u.status, testerName: u.testerName, executedAt: u.executedAt, notes: u.notes, sortOrder: u.sortOrder,
    })),
    agile: {
      sprints: sprints.map((s) => ({
        localId: s.id, name: s.name, goal: s.goal, startDate: s.startDate, endDate: s.endDate,
        status: s.status, sortOrder: s.sortOrder,
      })),
      backlog: backlog.map((b) => ({
        sprintLocalId: b.sprintId, type: b.type, title: b.title, description: b.description,
        acceptanceCriteria: b.acceptanceCriteria, storyPoints: b.storyPoints, priority: b.priority,
        status: b.status, assigneeEmail: userRef(b.assigneeUserId), sortOrder: b.sortOrder,
      })),
    },
    lessons: lessons.map((l) => ({
      category: l.category, title: l.title, description: l.description,
    })),
    acceptances: acceptances.map((a) => ({
      party: a.party, decision: a.decision, signedByName: a.signedByName, comments: a.comments, signedAt: a.signedAt,
    })),
    // Cross-project dependency register (INBOUND/OUTBOUND external deps).
    projectDependencies: projectDeps.map((d) => ({
      code: d.code, description: d.description, direction: d.direction, counterparty: d.counterparty,
      dueDate: d.dueDate, status: d.status, impact: d.impact, ownerEmail: userRef(d.ownerUserId), notes: d.notes,
    })),
    // Tier-3 custom-field values (project- and task-scoped). Carries the def so the importer can
    // resolve or create it by (entity, key) in the target tenant. taskLocalId set for task-scoped.
    customFieldValues: customFieldValues.map((v) => ({
      entity: v.def.entity, key: v.def.key, label: v.def.label, type: v.def.type,
      options: v.def.options, required: v.def.required, sortOrder: v.def.sortOrder,
      value: v.value,
      taskLocalId: v.def.entity === 'task' ? v.entityId : null, // task-scoped points at the task's localId
    })),
  };
}

export type ProjectBundle = Awaited<ReturnType<typeof gatherProjectBundle>>;
