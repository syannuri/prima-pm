// Full-project bundle IMPORT — the inbound half of export.bundle.data.ts. Takes a bundle JSON and
// reconstructs it as a BRAND-NEW project (clone): a fresh DRAFT project with a new auto code, then
// every domain component re-created inside one transaction with all in-bundle references remapped to
// the new ids. User references resolve by email (unresolved → null + a warning, never a hard fail);
// Resources match an existing tenant resource by name (+email) or are created; Rate cards match by
// role name or are dropped (amounts are stored, so cost integrity holds). All-or-nothing.
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequest } from '../../lib/errors.js';
import { generateProjectCode, nextProjectSeq } from '../charter/charter.helpers.js';
import { SUPPORTED_BUNDLE_VERSIONS } from '../export/export.bundle.data.js';

// Lenient shape check: we validate the envelope + that a project name exists, and default every
// component array to []. Field-level typos surface as a transaction error (→ 400) at commit.
const arr = <T>(s: z.ZodType<T>) => z.array(s).default([]);
const obj = z.record(z.any());
const bundleSchema = z.object({
  formatVersion: z.number(),
  exportedFrom: z.object({ code: z.string().optional(), name: z.string().optional() }).partial().optional(),
  project: z.object({ name: z.string().min(2) }).passthrough(),
  pm: z.object({ email: z.string().email().optional().nullable(), name: z.string().optional().nullable() }).nullable().optional(),
  resources: arr(obj),
  charter: obj.nullable().optional(),
  tasks: arr(obj),
  taskDependencies: arr(obj),
  costDirect: arr(obj),
  costIndirect: arr(obj),
  actualCosts: arr(obj),
  mandayEntries: arr(obj),
  risks: arr(obj),
  issues: arr(obj),
  stakeholders: arr(obj),
  requirements: arr(obj),
  procurement: arr(obj),
  assumptions: arr(obj),
  uat: arr(obj),
  agile: z.object({ sprints: arr(obj), backlog: arr(obj) }).default({ sprints: [], backlog: [] }),
  lessons: arr(obj),
  acceptances: arr(obj),
  // v2 additions (absent in v1 bundles → default empty/null).
  costBaseline: obj.nullable().optional(),
  projectDependencies: arr(obj),
  customFieldValues: arr(obj),
}).passthrough();

export type ParsedBundle = z.infer<typeof bundleSchema>;

export interface BundlePreview {
  formatVersion: number;
  sourceName: string;
  sourceCode?: string;
  counts: Record<string, number>;
  warnings: string[];
}

const d = (v: unknown): Date | null => (v == null || v === '' ? null : new Date(v as string));
const dReq = (v: unknown): Date => new Date(v as string);

// Validate the envelope and (for dry-run) surface resolvability warnings without writing anything.
export async function parseBundle(raw: unknown): Promise<{ bundle: ParsedBundle; preview: BundlePreview }> {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { throw BadRequest('The file is not valid JSON.'); }
  }
  const res = bundleSchema.safeParse(parsed);
  if (!res.success) {
    throw BadRequest(`This does not look like a project bundle: ${res.error.issues[0]?.message ?? 'invalid shape'}.`);
  }
  const bundle = res.data;
  if (!SUPPORTED_BUNDLE_VERSIONS.includes(bundle.formatVersion)) {
    throw BadRequest(`Unsupported bundle version ${bundle.formatVersion} (this server reads version ${SUPPORTED_BUNDLE_VERSIONS.join(', ')}).`);
  }

  const warnings: string[] = [];
  // Which referenced emails resolve to a user in this tenant?
  const emails = new Set<string>();
  const collect = (e: unknown) => { if (typeof e === 'string' && e) emails.add(e); };
  if (bundle.pm?.email) collect(bundle.pm.email);
  bundle.risks.forEach((r) => collect(r.ownerEmail));
  bundle.issues.forEach((i) => collect(i.ownerEmail));
  bundle.assumptions.forEach((a) => collect(a.ownerEmail));
  bundle.agile.backlog.forEach((b) => collect(b.assigneeEmail));
  bundle.costDirect.forEach((c) => collect(c.resourceUserEmail));
  const found = emails.size
    ? await prisma.user.findMany({ where: { email: { in: [...emails] } }, select: { email: true } })
    : [];
  const foundSet = new Set(found.map((u) => u.email));
  const missing = [...emails].filter((e) => !foundSet.has(e));
  if (bundle.pm?.email && !foundSet.has(bundle.pm.email)) {
    warnings.push(`PM "${bundle.pm.email}" not found — you will be assigned as PM.`);
  }
  const missingOwners = missing.filter((e) => e !== bundle.pm?.email);
  if (missingOwners.length) {
    warnings.push(`${missingOwners.length} owner/assignee email(s) not found in this workspace — those references will be left blank.`);
  }
  // Resources matched vs created.
  const names = bundle.resources.map((r) => String(r.name ?? '')).filter(Boolean);
  const existing = names.length
    ? await prisma.resource.findMany({ where: { name: { in: names } }, select: { name: true } })
    : [];
  const existingNames = new Set(existing.map((r) => r.name));
  const toCreate = bundle.resources.filter((r) => !existingNames.has(String(r.name ?? ''))).length;
  if (toCreate) warnings.push(`${toCreate} resource(s) not in this workspace will be created.`);

  const counts: Record<string, number> = {
    tasks: bundle.tasks.length,
    dependencies: bundle.taskDependencies.length,
    costDirect: bundle.costDirect.length,
    costIndirect: bundle.costIndirect.length,
    actualCosts: bundle.actualCosts.length,
    mandayEntries: bundle.mandayEntries.length,
    risks: bundle.risks.length,
    issues: bundle.issues.length,
    stakeholders: bundle.stakeholders.length,
    requirements: bundle.requirements.length,
    procurement: bundle.procurement.length,
    assumptions: bundle.assumptions.length,
    uat: bundle.uat.length,
    sprints: bundle.agile.sprints.length,
    backlog: bundle.agile.backlog.length,
    lessons: bundle.lessons.length,
    acceptances: bundle.acceptances.length,
    resources: bundle.resources.length,
    projectDependencies: bundle.projectDependencies.length,
    customFieldValues: bundle.customFieldValues.length,
    costBaseline: bundle.costBaseline ? 1 : 0,
  };

  return {
    bundle,
    preview: {
      formatVersion: bundle.formatVersion,
      sourceName: bundle.project.name as string,
      sourceCode: bundle.exportedFrom?.code,
      counts,
      warnings,
    },
  };
}

// Reconstruct the bundle as a new DRAFT project. Runs in one interactive transaction so a failure
// anywhere leaves nothing behind. Returns the new project's id + code.
export async function commitBundleImport(
  bundle: ParsedBundle,
  actorId: string,
  actorRole?: Role,
): Promise<{ projectId: string; code: string; warnings: string[]; reconciliation: Record<string, { expected: number; imported: number }> }> {
  const warnings: string[] = [];
  let resourcesCreated = 0;
  let customDefsCreated = 0;
  const year = new Date().getFullYear();
  const p = bundle.project as Record<string, any>;

  return prisma.$transaction(async (tx) => {
    // --- email → userId cache (soft: unresolved returns null). ---
    const emailCache = new Map<string, string | null>();
    const resolveEmail = async (email: unknown): Promise<string | null> => {
      if (typeof email !== 'string' || !email) return null;
      if (emailCache.has(email)) return emailCache.get(email)!;
      const u = await tx.user.findFirst({ where: { email }, select: { id: true } });
      emailCache.set(email, u?.id ?? null);
      return u?.id ?? null;
    };

    // PM: bundle email → user, else the importing actor (a valid ADMIN/PMO).
    const pmUserId = (await resolveEmail(bundle.pm?.email)) ?? actorId;
    if (bundle.pm?.email && pmUserId === actorId && emailCache.get(bundle.pm.email) == null) {
      warnings.push(`PM "${bundle.pm.email}" not found — you were assigned as PM.`);
    }

    // --- new project code (highest existing seq for the year + 1, with a small retry margin). ---
    const existingCodes = await tx.project.findMany({ where: { code: { startsWith: `PRJ-${year}-` } }, select: { code: true } });
    const code = generateProjectCode(year, nextProjectSeq(existingCodes.map((c) => c.code), year));

    const project = await tx.project.create({
      data: {
        code, name: p.name, clientName: p.clientName ?? null, sponsor: p.sponsor ?? null,
        category: p.category ?? null, categoryOther: p.category === 'OTHER' ? (p.categoryOther ?? null) : null,
        deliveryApproach: p.deliveryApproach ?? 'PREDICTIVE',
        costBaselineIdr: p.costBaselineIdr ?? null, totalRevenueIdr: p.totalRevenueIdr ?? null,
        mandaysPerPoint: p.mandaysPerPoint ?? 1, autoPostLabourAc: p.autoPostLabourAc ?? false,
        // The clone is always DRAFT and editable, so it is NOT baseline-locked. We still carry the
        // schedule-baseline "captured" stamp (task baseline dates are imported) so EVM PV lines up.
        scheduleBaselinedAt: d(p.scheduleBaselinedAt),
        status: 'DRAFT', pmUserId,
      },
    });
    const pid = project.id;

    // Frozen cost baseline (reserves + BAC): carried so EVM/BAC reproduces (v2 bundles).
    if (bundle.costBaseline) {
      const cb = bundle.costBaseline as Record<string, any>;
      await tx.costBaseline.create({
        data: {
          projectId: pid, directTotal: cb.directTotal ?? 0, indirectTotal: cb.indirectTotal ?? 0,
          contingencyReserve: cb.contingencyReserve ?? 0, managementReserve: cb.managementReserve ?? 0,
          costBaseline: cb.costBaseline ?? 0, budgetAtCompletion: cb.budgetAtCompletion ?? 0,
        },
      });
    }

    // --- Resources: match by name (+email) or create. ref → new/existing id. ---
    const resourceMap = new Map<string, string>();
    const rateCardCache = new Map<string, string | null>();
    const resolveRateCard = async (roleName: unknown): Promise<string | null> => {
      if (typeof roleName !== 'string' || !roleName) return null;
      if (rateCardCache.has(roleName)) return rateCardCache.get(roleName)!;
      const rc = await tx.rateCard.findFirst({ where: { roleName }, select: { id: true } });
      rateCardCache.set(roleName, rc?.id ?? null);
      return rc?.id ?? null;
    };
    for (const r of bundle.resources as Record<string, any>[]) {
      const name = String(r.name ?? '').trim();
      if (!name || !r.ref) continue;
      const existing = await tx.resource.findFirst({ where: { name }, select: { id: true } });
      if (existing) { resourceMap.set(r.ref, existing.id); continue; }
      const userId = await resolveEmail(r.email);
      const created = await tx.resource.create({
        data: {
          name, resourceType: r.resourceType ?? 'NAMED', roleTitle: r.roleTitle ?? null,
          personnelRole: r.personnelRole ?? 'PROJECT_PERSONNEL',
          unitCostPerManday: r.unitCostPerManday ?? 0, capacityPerDay: r.capacityPerDay ?? 1,
          department: r.department ?? null, rateCardId: await resolveRateCard(r.rateCardRef), userId,
        },
        select: { id: true },
      });
      resourceMap.set(r.ref, created.id);
      resourcesCreated++;
    }
    const mapRes = (ref: unknown): string | null => (typeof ref === 'string' ? resourceMap.get(ref) ?? null : null);

    // --- Charter. ---
    if (bundle.charter) {
      const c = bundle.charter as Record<string, any>;
      await tx.projectCharter.create({
        data: {
          projectId: pid, description: c.description ?? '', goals: c.goals ?? '',
          category: c.category ?? p.category ?? 'OTHER', categoryOther: c.categoryOther ?? null,
          hiScope: c.hiScope ?? '', hiCostIdr: c.hiCostIdr ?? 0,
          hiScheduleStart: dReq(c.hiScheduleStart ?? new Date()), hiScheduleEnd: dReq(c.hiScheduleEnd ?? new Date()),
          hiDeliverables: c.hiDeliverables ?? '', hiResources: c.hiResources ?? null,
          // Coherence: the clone is a DRAFT project, so its charter must NOT be locked/committed
          // (charter.locked means "project active"). Ignore the source's locked/committedAt.
          version: c.version ?? 1, locked: false, committedAt: null, pmUserId,
        },
      });
    }

    // --- Tasks (pass A: create + pic; pass B: parent; then steps + owners). ---
    const taskMap = new Map<string, string>();
    for (const t of bundle.tasks as Record<string, any>[]) {
      const created = await tx.task.create({
        data: {
          projectId: pid, wbsCode: t.wbsCode ?? '', name: t.name ?? 'Task',
          description: t.description ?? null, deliverable: t.deliverable ?? null, acceptanceCriteria: t.acceptanceCriteria ?? null,
          planStart: dReq(t.planStart), planEnd: dReq(t.planEnd),
          baselineStart: d(t.baselineStart), baselineFinish: d(t.baselineFinish),
          actualStart: d(t.actualStart), actualFinish: d(t.actualFinish),
          picResourceId: mapRes(t.picResourceRef), progressPct: t.progressPct ?? 0,
          weight: t.weight ?? null, baselineWeight: t.baselineWeight ?? null,
          isMilestone: t.isMilestone ?? false, sortOrder: t.sortOrder ?? 0,
        },
        select: { id: true },
      });
      if (t.localId) taskMap.set(t.localId, created.id);
      // steps
      for (const s of (t.steps ?? []) as Record<string, any>[]) {
        await tx.taskStep.create({ data: { taskId: created.id, name: s.name ?? 'Step', weight: s.weight ?? 1, done: s.done ?? false, sortOrder: s.sortOrder ?? 0 } });
      }
      // owners
      for (const ref of (t.ownerResourceRefs ?? []) as unknown[]) {
        const rid = mapRes(ref);
        if (rid) await tx.taskOwner.create({ data: { taskId: created.id, resourceId: rid } });
      }
    }
    // pass B: parent links
    for (const t of bundle.tasks as Record<string, any>[]) {
      if (t.parentLocalId && t.localId) {
        const child = taskMap.get(t.localId); const parent = taskMap.get(t.parentLocalId);
        if (child && parent) await tx.task.update({ where: { id: child }, data: { parentTaskId: parent } });
      }
    }
    const mapTask = (ref: unknown): string | null => (typeof ref === 'string' ? taskMap.get(ref) ?? null : null);

    // --- Task dependencies. ---
    for (const dep of bundle.taskDependencies as Record<string, any>[]) {
      const pre = mapTask(dep.predecessorLocalId); const suc = mapTask(dep.successorLocalId);
      if (pre && suc) await tx.taskDependency.create({ data: { predecessorId: pre, successorId: suc, type: dep.type ?? 'FS', lagDays: dep.lagDays ?? 0 } });
    }

    // --- Cost lines. ---
    const directMap = new Map<string, string>();
    for (const c of bundle.costDirect as Record<string, any>[]) {
      const created = await tx.costItemDirect.create({
        data: {
          projectId: pid, type: c.type ?? 'OTHER', label: c.label ?? '', subCategory: c.subCategory ?? null, sortOrder: c.sortOrder ?? 0,
          qty: c.qty ?? null, unitCost: c.unitCost ?? null, amount: c.amount ?? null,
          personnelRole: c.personnelRole ?? null, resourceUserId: await resolveEmail(c.resourceUserEmail),
          rateCardId: await resolveRateCard(c.rateCardRef),
          unitCostPerManday: c.unitCostPerManday ?? null, planMandays: c.planMandays ?? null, manpowerCost: c.manpowerCost ?? null,
          taskId: mapTask(c.taskLocalId), resourceId: mapRes(c.resourceRef),
        },
        select: { id: true },
      });
      if (c.localId) directMap.set(c.localId, created.id);
    }
    const indirectMap = new Map<string, string>();
    for (const c of bundle.costIndirect as Record<string, any>[]) {
      const created = await tx.costItemIndirect.create({
        data: { projectId: pid, type: c.type ?? 'OTHER', description: c.description ?? '', subCategory: c.subCategory ?? null, amount: c.amount ?? 0 },
        select: { id: true },
      });
      if (c.localId) indirectMap.set(c.localId, created.id);
    }
    const mapDirect = (ref: unknown): string | null => (typeof ref === 'string' ? directMap.get(ref) ?? null : null);
    const mapIndirect = (ref: unknown): string | null => (typeof ref === 'string' ? indirectMap.get(ref) ?? null : null);

    // --- Actuals + mandays. ---
    for (const a of bundle.actualCosts as Record<string, any>[]) {
      await tx.actualCostEntry.create({ data: { projectId: pid, date: dReq(a.date), amount: a.amount ?? 0, description: a.description ?? null, category: a.category ?? 'DIRECT', directLineId: mapDirect(a.directLineLocalId), indirectLineId: mapIndirect(a.indirectLineLocalId) } });
    }
    for (const m of bundle.mandayEntries as Record<string, any>[]) {
      const lineId = mapDirect(m.costItemLocalId);
      if (lineId) await tx.mandayEntry.create({ data: { projectId: pid, costItemId: lineId, date: dReq(m.date), mandays: m.mandays ?? 0, note: m.note ?? null } });
    }

    // --- Registers. ---
    for (const r of bundle.risks as Record<string, any>[]) {
      await tx.risk.create({ data: { projectId: pid, code: r.code ?? '', title: r.title ?? '', description: r.description ?? null, category: r.category ?? null, status: r.status ?? 'IDENTIFIED', kind: r.kind ?? 'THREAT', ownerUserId: await resolveEmail(r.ownerEmail), probabilityScore: r.probabilityScore ?? 1, impactScore: r.impactScore ?? 1, riskScore: r.riskScore ?? 1, severity: r.severity ?? 'LOW', probabilityPct: r.probabilityPct ?? 0, impactCostIdr: r.impactCostIdr ?? 0, emv: r.emv ?? 0, responseStrategy: r.responseStrategy ?? null, responseCost: r.responseCost ?? null, residualEmv: r.residualEmv ?? null, includeInReserve: r.includeInReserve ?? true } });
    }
    for (const i of bundle.issues as Record<string, any>[]) {
      await tx.issue.create({ data: { projectId: pid, code: i.code ?? '', title: i.title ?? '', description: i.description ?? null, category: i.category ?? null, impact: i.impact ?? 'MEDIUM', status: i.status ?? 'OPEN', ownerUserId: await resolveEmail(i.ownerEmail), resolution: i.resolution ?? null, raisedAt: d(i.raisedAt) ?? new Date(), resolvedAt: d(i.resolvedAt) } });
    }
    for (const s of bundle.stakeholders as Record<string, any>[]) {
      await tx.stakeholder.create({ data: { projectId: pid, code: s.code ?? '', name: s.name ?? '', role: s.role ?? null, organization: s.organization ?? null, category: s.category ?? 'OTHER', power: s.power ?? 'MEDIUM', interest: s.interest ?? 'MEDIUM', currentEngagement: s.currentEngagement ?? 'NEUTRAL', desiredEngagement: s.desiredEngagement ?? 'SUPPORTIVE', email: s.email ?? null, strategy: s.strategy ?? null, notes: s.notes ?? null } });
    }
    for (const a of bundle.assumptions as Record<string, any>[]) {
      await tx.assumption.create({ data: { projectId: pid, code: a.code ?? '', statement: a.statement ?? '', category: a.category ?? null, status: a.status ?? 'OPEN', impact: a.impact ?? 'MEDIUM', ownerUserId: await resolveEmail(a.ownerEmail), notes: a.notes ?? null } });
    }
    for (const u of bundle.uat as Record<string, any>[]) {
      await tx.uatTestCase.create({ data: { projectId: pid, code: u.code ?? '', title: u.title ?? '', scenario: u.scenario ?? null, steps: u.steps ?? null, expected: u.expected ?? '', actual: u.actual ?? null, status: u.status ?? 'NOT_RUN', testerName: u.testerName ?? null, executedAt: d(u.executedAt), notes: u.notes ?? null, sortOrder: u.sortOrder ?? 0 } });
    }
    for (const l of bundle.lessons as Record<string, any>[]) {
      await tx.lessonLearned.create({ data: { projectId: pid, category: l.category ?? 'RECOMMENDATION', title: l.title ?? '', description: l.description ?? null } });
    }
    for (const a of bundle.acceptances as Record<string, any>[]) {
      await tx.acceptanceSignoff.create({ data: { projectId: pid, party: a.party ?? '', decision: a.decision ?? 'ACCEPTED', signedByName: a.signedByName ?? null, comments: a.comments ?? null, signedAt: d(a.signedAt) ?? new Date() } });
    }

    // --- Requirements + task links. ---
    for (const r of bundle.requirements as Record<string, any>[]) {
      const created = await tx.requirement.create({ data: { projectId: pid, code: r.code ?? '', title: r.title ?? '', description: r.description ?? null, category: r.category ?? 'FUNCTIONAL', priority: r.priority ?? 'MUST', status: r.status ?? 'PROPOSED', source: r.source ?? null, acceptanceCriteria: r.acceptanceCriteria ?? null, notes: r.notes ?? null }, select: { id: true } });
      for (const ref of (r.taskLocalIds ?? []) as unknown[]) {
        const tid = mapTask(ref);
        if (tid) await tx.requirementTaskLink.create({ data: { requirementId: created.id, taskId: tid } });
      }
    }

    // --- Procurement (references cost lines). ---
    for (const pr of bundle.procurement as Record<string, any>[]) {
      await tx.procurement.create({ data: { projectId: pid, code: pr.code ?? '', title: pr.title ?? '', vendor: pr.vendor ?? null, vendorContact: pr.vendorContact ?? null, type: pr.type ?? 'PURCHASE_ORDER', status: pr.status ?? 'PLANNED', amount: pr.amount ?? null, needBy: d(pr.needBy), startDate: d(pr.startDate), endDate: d(pr.endDate), scope: pr.scope ?? null, notes: pr.notes ?? null, costDirectLineId: mapDirect(pr.costDirectLineLocalId), costIndirectLineId: mapIndirect(pr.costIndirectLineLocalId) } });
    }

    // --- Agile: sprints then backlog. ---
    const sprintMap = new Map<string, string>();
    for (const s of bundle.agile.sprints as Record<string, any>[]) {
      const created = await tx.sprint.create({ data: { projectId: pid, name: s.name ?? 'Sprint', goal: s.goal ?? null, startDate: d(s.startDate), endDate: d(s.endDate), status: s.status ?? 'PLANNED', sortOrder: s.sortOrder ?? 0 }, select: { id: true } });
      if (s.localId) sprintMap.set(s.localId, created.id);
    }
    for (const b of bundle.agile.backlog as Record<string, any>[]) {
      const sid = typeof b.sprintLocalId === 'string' ? sprintMap.get(b.sprintLocalId) ?? null : null;
      await tx.backlogItem.create({ data: { projectId: pid, sprintId: sid, type: b.type ?? 'STORY', title: b.title ?? '', description: b.description ?? null, acceptanceCriteria: b.acceptanceCriteria ?? null, storyPoints: b.storyPoints ?? null, priority: b.priority ?? 0, status: b.status ?? 'TODO', assigneeUserId: await resolveEmail(b.assigneeEmail), sortOrder: b.sortOrder ?? 0 } });
    }

    // --- Cross-project dependency register (v2). ---
    for (const dp of bundle.projectDependencies as Record<string, any>[]) {
      await tx.projectDependency.create({ data: { projectId: pid, code: dp.code ?? '', description: dp.description ?? '', direction: dp.direction ?? 'INBOUND', counterparty: dp.counterparty ?? null, dueDate: d(dp.dueDate), status: dp.status ?? 'PENDING', impact: dp.impact ?? 'MEDIUM', ownerUserId: await resolveEmail(dp.ownerEmail), notes: dp.notes ?? null } });
    }

    // --- Tier-3 custom-field values (v2): resolve/create the def by (entity, key), then the value
    // against the new project id (project-scoped) or the remapped task id (task-scoped). CustomFieldDef
    // / CustomFieldValue carry a non-null tenantId, so we set it from the (tenant-scoped) new project.
    // Skipped only when there is no tenant context (e.g. the tenant-less test harness). ---
    const cfTenantId = project.tenantId;
    if (cfTenantId && (bundle.customFieldValues as unknown[]).length) {
      const defCache = new Map<string, string>(); // `${entity}:${key}` → defId
      for (const cf of bundle.customFieldValues as Record<string, any>[]) {
        const entity = cf.entity === 'task' ? 'task' : 'project';
        const key = String(cf.key ?? '').trim();
        if (!key) continue;
        const cacheKey = `${entity}:${key}`;
        let defId = defCache.get(cacheKey);
        if (!defId) {
          const existing = await tx.customFieldDef.findFirst({ where: { entity, key }, select: { id: true } });
          if (existing) defId = existing.id;
          else {
            const createdDef = await tx.customFieldDef.create({ data: { tenantId: cfTenantId, entity, key, label: cf.label ?? key, type: cf.type ?? 'text', options: cf.options ?? undefined, required: cf.required ?? false, sortOrder: cf.sortOrder ?? 0 }, select: { id: true } });
            defId = createdDef.id;
            customDefsCreated++;
          }
          defCache.set(cacheKey, defId);
        }
        const entityId = entity === 'task' ? mapTask(cf.taskLocalId) : pid;
        if (!entityId) continue; // task-scoped value whose task didn't map — skip
        if (cf.value != null) await tx.customFieldValue.create({ data: { tenantId: cfTenantId, defId, entityId, value: String(cf.value) } });
      }
    }

    // --- Reconciliation: expected (from bundle) vs actually imported (counted in the new project),
    // so any silent drop surfaces. Plus soft warnings for lossy resolutions. ---
    const unresolvedEmails = [...emailCache.values()].filter((v) => v == null).length;
    const rateCardsDropped = [...rateCardCache.entries()].filter(([k, v]) => k && v == null).length;
    if (resourcesCreated) warnings.push(`${resourcesCreated} resource(s) created in this workspace.`);
    if (rateCardsDropped) warnings.push(`${rateCardsDropped} rate card(s) not found — left blank (amounts kept).`);
    if (customDefsCreated) warnings.push(`${customDefsCreated} custom-field definition(s) created.`);
    // Owner/assignee emails that fell through to null (excludes the PM, already reported).
    const ownerNulls = unresolvedEmails - (bundle.pm?.email && emailCache.get(bundle.pm.email) == null ? 1 : 0);
    if (ownerNulls > 0) warnings.push(`${ownerNulls} owner/assignee reference(s) not found — left blank.`);

    const reconciliation: Record<string, { expected: number; imported: number }> = {
      tasks: { expected: bundle.tasks.length, imported: await tx.task.count({ where: { projectId: pid } }) },
      taskDependencies: { expected: bundle.taskDependencies.length, imported: await tx.taskDependency.count({ where: { predecessor: { projectId: pid } } }) },
      costDirect: { expected: bundle.costDirect.length, imported: await tx.costItemDirect.count({ where: { projectId: pid } }) },
      costIndirect: { expected: bundle.costIndirect.length, imported: await tx.costItemIndirect.count({ where: { projectId: pid } }) },
      actualCosts: { expected: bundle.actualCosts.length, imported: await tx.actualCostEntry.count({ where: { projectId: pid } }) },
      mandayEntries: { expected: bundle.mandayEntries.length, imported: await tx.mandayEntry.count({ where: { projectId: pid } }) },
      risks: { expected: bundle.risks.length, imported: await tx.risk.count({ where: { projectId: pid } }) },
      issues: { expected: bundle.issues.length, imported: await tx.issue.count({ where: { projectId: pid } }) },
      stakeholders: { expected: bundle.stakeholders.length, imported: await tx.stakeholder.count({ where: { projectId: pid } }) },
      requirements: { expected: bundle.requirements.length, imported: await tx.requirement.count({ where: { projectId: pid } }) },
      procurement: { expected: bundle.procurement.length, imported: await tx.procurement.count({ where: { projectId: pid } }) },
      assumptions: { expected: bundle.assumptions.length, imported: await tx.assumption.count({ where: { projectId: pid } }) },
      uat: { expected: bundle.uat.length, imported: await tx.uatTestCase.count({ where: { projectId: pid } }) },
      sprints: { expected: bundle.agile.sprints.length, imported: await tx.sprint.count({ where: { projectId: pid } }) },
      backlog: { expected: bundle.agile.backlog.length, imported: await tx.backlogItem.count({ where: { projectId: pid } }) },
      lessons: { expected: bundle.lessons.length, imported: await tx.lessonLearned.count({ where: { projectId: pid } }) },
      acceptances: { expected: bundle.acceptances.length, imported: await tx.acceptanceSignoff.count({ where: { projectId: pid } }) },
      projectDependencies: { expected: bundle.projectDependencies.length, imported: await tx.projectDependency.count({ where: { projectId: pid } }) },
      customFieldValues: { expected: bundle.customFieldValues.length, imported: await tx.customFieldValue.count({ where: { entityId: { in: [pid, ...taskMap.values()] } } }) },
      costBaseline: { expected: bundle.costBaseline ? 1 : 0, imported: await tx.costBaseline.count({ where: { projectId: pid } }) },
    };

    // Any component where fewer rows landed than expected is worth flagging.
    for (const [name, { expected, imported }] of Object.entries(reconciliation)) {
      if (imported < expected) warnings.push(`${name}: ${imported}/${expected} imported (${expected - imported} skipped).`);
    }

    return { projectId: pid, code, warnings, reconciliation };
  }, { timeout: 60_000, maxWait: 10_000 });
}
