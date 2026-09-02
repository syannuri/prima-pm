import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError, BadRequest, NotFound } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { getAiPort, aiNotEnabledError } from '../../lib/ai.js';
import { assertBaselineUnlocked } from '../projects/baseline.service.js';
import { generateTaskCode, hasDependencyCycle } from './schedule.helpers.js';
import { applyAutoSchedule } from './schedule.service.js';
import {
  parseHiResources,
  mergeResourcePool,
  type AvailableResource,
} from './scheduleResource.helpers.js';
import { resolveAssignments, planLevelingEdges, type LevelTask } from './resourceLeveling.js';

// ---------------------------------------------------------------------------
// AI-generated timeline (schedule draft) from the Project Charter.
//
// Mirrors the risk-suggest + apply-template patterns: the model NEVER writes to
// the DB. It returns a whitelisted, bounded DRAFT (phases → work packages with
// durations) that the PM reviews and edits; on accept the draft is materialised
// deterministically into the WBS (same date/code logic as curated templates).
// Two-level hierarchy only (phase → task). Money is never generated.
// ---------------------------------------------------------------------------

const MAX_PHASES = 8;
const MAX_TASKS_PER_PHASE = 12;
const MAX_TOTAL_TASKS = 40;
const MAX_DURATION_DAYS = 365;

// A single work package under a phase. durationDays 0 (or isMilestone) = milestone.
// `ref` is an AI-assigned token other tasks reference via `deps` (finish-to-start predecessors);
// links are validated (refs must exist) and made acyclic on apply.
export const DraftTaskSchema = z.object({
  name: z.string().min(2).max(200),
  durationDays: z.number().int().min(0).max(MAX_DURATION_DAYS),
  isMilestone: z.boolean().optional(),
  deliverable: z.string().max(1000).nullable().optional(),
  acceptanceCriteria: z.string().max(2000).nullable().optional(),
  weight: z.number().min(0).max(1000).nullable().optional(),
  ref: z.string().min(1).max(40).optional(),
  deps: z.array(z.string().min(1).max(40)).max(20).optional(),
  // Resource mapping (advisory from the model). `resourceRole` is the human role/name the task
  // needs; `resourceRef` points into the availableResources pool (e.g. "r2") when it maps to a
  // specific one. Both are validated/resolved later — never trusted for dates.
  resourceRole: z.string().max(120).nullable().optional(),
  resourceRef: z.string().max(40).nullable().optional(),
});

// A summary phase (WBS parent) grouping its work packages.
export const DraftPhaseSchema = z.object({
  name: z.string().min(2).max(200),
  deliverable: z.string().max(1000).nullable().optional(),
  weight: z.number().min(0).max(1000).nullable().optional(),
  tasks: z.array(DraftTaskSchema).min(1).max(MAX_TASKS_PER_PHASE),
});

const ScheduleDraftBase = z.object({ phases: z.array(DraftPhaseSchema).min(1).max(MAX_PHASES) });
const withinTotalCap = (d: z.infer<typeof ScheduleDraftBase>) =>
  d.phases.reduce((n, p) => n + p.tasks.length, 0) <= MAX_TOTAL_TASKS;
const totalCapIssue = { message: `A schedule may have at most ${MAX_TOTAL_TASKS} work packages`, path: ['phases'] };

export const ScheduleDraftSchema = ScheduleDraftBase.refine(withinTotalCap, totalCapIssue);

// Apply carries the (possibly PM-edited) draft plus an optional start date. Re-validated on the
// server so PM edits can't smuggle out-of-bounds values past the generate-time schema.
export const ApplyScheduleDraftSchema = ScheduleDraftBase.extend({
  startDate: z.coerce.date().optional(),
  // When true (default) create FS dependency links + auto-schedule (weekend-aware) so editing a
  // duration cascades downstream. When false, tasks keep the plain sequential calendar dates.
  link: z.boolean().optional(),
  // When true, scale durations so the timeline lands on the charter end (opt-in; distorts estimates).
  fit: z.boolean().optional(),
  // Resource-aware options (default ON). `level` adds capacity-respecting FS edges so same-resource
  // work serialises (needs `link`); `assign` sets the task owner from a matched register resource.
  level: z.boolean().optional(),
  assign: z.boolean().optional(),
}).refine(withinTotalCap, totalCapIssue);

export type DraftTask = z.infer<typeof DraftTaskSchema>;
export type DraftPhase = z.infer<typeof DraftPhaseSchema>;
export type ScheduleDraft = z.infer<typeof ScheduleDraftSchema>;

const SCHEDULE_DRAFT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    phases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          deliverable: { type: 'string' },
          weight: { type: 'number' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                durationDays: { type: 'integer' },
                isMilestone: { type: 'boolean' },
                deliverable: { type: 'string' },
                acceptanceCriteria: { type: 'string' },
                weight: { type: 'number' },
                ref: { type: 'string' },
                deps: { type: 'array', items: { type: 'string' } },
                resourceRole: { type: 'string' },
                resourceRef: { type: 'string' },
              },
              required: ['name', 'durationDays', 'ref'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'tasks'],
        additionalProperties: false,
      },
    },
  },
  required: ['phases'],
  additionalProperties: false,
} as const;

// Both STABLE ⇒ prompt-cache per language. One prompt per app language so the generated schedule
// text (phase / task names, deliverables) matches the language the PM is working in.
const SYSTEM_PROMPT_ID = [
  'Anda adalah seorang perencana proyek (scheduler) PMO senior yang menyusun draft Work Breakdown Structure (WBS) dan timeline dari Project Charter sebuah proyek.',
  'Tulis dalam Bahasa Indonesia manajemen proyek yang natural dan ringkas (bukan terjemahan harfiah).',
  '',
  'ATURAN (WAJIB):',
  '- Susun jadwal dari lingkup (scope) dan deliverable pada payload. Jangan mengarang lingkup yang tidak ada.',
  '- Struktur DUA tingkat: beberapa FASE (ringkasan), tiap fase berisi beberapa WORK PACKAGE (tugas).',
  `- Maksimal ${MAX_PHASES} fase, maksimal ${MAX_TASKS_PER_PHASE} tugas per fase, total maksimal ${MAX_TOTAL_TASKS} tugas.`,
  '- durationDays = perkiraan durasi tugas dalam HARI KALENDER (bilangan bulat). Milestone: durationDays 0 dan isMilestone true (mis. "Kick-off", "Go-live").',
  '- USAHAKAN total durasi (jumlah durasi seluruh tugas yang berurutan) muat dalam scheduleWorkingDaysBudget. Jika lingkup terlalu besar, tetap realistis — jangan memaksa.',
  '- Petakan deliverable dari charter ke tugas/fase yang menghasilkannya (isi field deliverable).',
  '- Beri weight relatif per tugas/fase mencerminkan besarnya usaha (opsional; jumlah tidak harus 100). JANGAN sertakan angka biaya/uang apa pun.',
  '- KETERGANTUNGAN (dependency): beri tiap task `ref` unik & pendek (mis. "t1","t2"). Isi `deps` = daftar ref task yang harus SELESAI sebelum task ini mulai (finish-to-start). Boleh lintas-fase, boleh paralel (dua task ber-deps sama) dan merge (satu task ber-deps banyak). WAJIB acyclic (jangan melingkar). Kalau ragu, kosongkan `deps`.',
  '- MINIMALKAN CRITICAL PATH: beri `deps` HANYA jika ada ketergantungan nyata (output/deliverable task lain menjadi input task ini). JANGAN membuat rantai serial hanya karena task berada di fase yang sama. Task yang tidak saling bergantung harus dibiarkan PARALEL (deps kosong / berbagi predecessor yang sama).',
  '- ALOKASI RESOURCE: payload berisi `availableResources` = daftar {ref,label,capacityPerDay}. Untuk tiap task, isi `resourceRole` (peran/skill yang dibutuhkan) dan `resourceRef` (ref resource dari pool bila cocok dengan salah satu). Pakai ini untuk memutuskan paralelisme: task dengan resource BERBEDA dan tanpa ketergantungan logis boleh jalan bersamaan. Dua task yang butuh resource SAMA akan diserialkan otomatis di tahap berikutnya — JANGAN menambah `deps` buatan untuk itu.',
  '',
  'Untuk tiap fase hasilkan: name, deliverable (opsional), weight (opsional), dan tasks[]. Untuk tiap task: name, durationDays, isMilestone, deliverable (opsional), acceptanceCriteria (opsional), weight (opsional), ref, deps (opsional), resourceRole (opsional), resourceRef (opsional).',
].join('\n');

const SYSTEM_PROMPT_EN = [
  'You are a senior PMO project scheduler drafting a Work Breakdown Structure (WBS) and timeline from a project Project Charter.',
  'Write in natural, concise project-management English (not a literal translation).',
  '',
  'RULES (MANDATORY):',
  '- Build the schedule from the scope and deliverables in the payload. Do not invent scope that is not present.',
  '- Use a TWO-level structure: several PHASES (summaries), each phase containing several WORK PACKAGES (tasks).',
  `- At most ${MAX_PHASES} phases, at most ${MAX_TASKS_PER_PHASE} tasks per phase, at most ${MAX_TOTAL_TASKS} tasks total.`,
  '- durationDays = estimated task duration in CALENDAR DAYS (integer). Milestones: durationDays 0 and isMilestone true (e.g. "Kick-off", "Go-live").',
  '- TRY to keep the total duration (sum of the sequential task durations) within scheduleWorkingDaysBudget. If the scope is too large, stay realistic — do not force it.',
  '- Map the charter deliverables to the tasks/phases that produce them (fill the deliverable field).',
  '- Give a relative weight per task/phase reflecting effort (optional; the sum need not be 100). Do NOT include any cost/money figures.',
  '- DEPENDENCIES: give each task a short unique `ref` (e.g. "t1","t2"). Fill `deps` = the refs of the tasks that must FINISH before this task starts (finish-to-start). Cross-phase is allowed, as are parallel branches (two tasks sharing a predecessor) and merges (one task with several deps). It MUST stay acyclic (no loops). If unsure, leave `deps` empty.',
  '- MINIMISE THE CRITICAL PATH: add `deps` ONLY when there is a real dependency (another task\'s output/deliverable is an input to this one). Do NOT create a serial chain just because tasks share a phase. Tasks that do not depend on each other must be left PARALLEL (empty deps / sharing the same predecessor).',
  '- RESOURCE ALLOCATION: the payload has `availableResources` = a list of {ref,label,capacityPerDay}. For each task, fill `resourceRole` (the role/skill it needs) and `resourceRef` (a pool ref when it maps to a specific one). Use this to decide parallelism: tasks on DIFFERENT resources with no logical dependency may run concurrently. Two tasks needing the SAME resource will be serialised automatically in a later step — do NOT add an artificial `dep` for that.',
  '',
  'For each phase produce: name, deliverable (optional), weight (optional), and tasks[]. For each task: name, durationDays, isMilestone, deliverable (optional), acceptanceCriteria (optional), weight (optional), ref, deps (optional), resourceRole (optional), resourceRef (optional).',
].join('\n');

export type SuggestLang = 'id' | 'en';

interface CharterContext {
  project: { code: string; name: string; approach: string };
  charter: {
    description: string;
    goals: string;
    category: string;
    scope: string;
    deliverables: string;
    scheduleStart: Date;
    scheduleEnd: Date;
  };
  scheduleWorkingDaysBudget: number;
  // The bounded resource pool (register + charter hiResources) the model maps tasks onto.
  availableResources: AvailableResource[];
}

const MS_PER_DAY = 86_400_000;

// Whole calendar days between the charter start and end (>= 1). Given to the model as the duration
// budget so it fits the timeline to the chartered window.
function scheduleDayBudget(start: Date, end: Date): number {
  return Math.max(1, Math.round((+end - +start) / MS_PER_DAY));
}

// PURE: builds the {system,user} pair. Unit-testable without a DB or the LLM. The system prompt
// (and therefore the generated schedule language) follows the caller's app language.
export function buildScheduleSuggestPrompt(ctx: CharterContext, lang: SuggestLang = 'en'): { system: string; user: string } {
  const payload = {
    project: ctx.project,
    charter: {
      description: ctx.charter.description,
      goals: ctx.charter.goals,
      category: ctx.charter.category,
      scope: ctx.charter.scope,
      deliverables: ctx.charter.deliverables,
      scheduleStart: ctx.charter.scheduleStart,
      scheduleEnd: ctx.charter.scheduleEnd,
    },
    scheduleWorkingDaysBudget: ctx.scheduleWorkingDaysBudget,
    // Only the fields the model needs to map roles — the register id stays server-side.
    availableResources: ctx.availableResources.map((r) => ({ ref: r.ref, label: r.label, capacityPerDay: r.capacityPerDay })),
  };
  return { system: lang === 'id' ? SYSTEM_PROMPT_ID : SYSTEM_PROMPT_EN, user: JSON.stringify(payload) };
}

// Per-tenant opt-in — reuses Tenant.aiNarrativeEnabled (one switch for all AI), same as riskSuggest.
async function loadCharterContext(projectId: string): Promise<CharterContext> {
  const proj = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { code: true, name: true, deliveryApproach: true, status: true, tenantId: true, tenant: { select: { aiNarrativeEnabled: true } } },
  });
  if (!proj) throw NotFound('Project not found');
  const hasTenant = Boolean(getTenantStore()?.tenantId || proj.tenantId);
  if (hasTenant && proj.tenant?.aiNarrativeEnabled !== true) throw aiNotEnabledError();
  if (proj.status === 'DRAFT') throw BadRequest('Commit the Project Charter before generating a schedule');

  const charter = await prisma.projectCharter.findUnique({ where: { projectId } });
  if (!charter) throw BadRequest('The Project Charter is required to generate a schedule');

  const availableResources = await assembleResourcePool(charter.hiResources);

  return {
    project: { code: proj.code, name: proj.name, approach: proj.deliveryApproach },
    charter: {
      description: charter.description,
      goals: charter.goals,
      category: charter.category,
      scope: charter.hiScope,
      deliverables: charter.hiDeliverables,
      scheduleStart: charter.hiScheduleStart,
      scheduleEnd: charter.hiScheduleEnd,
    },
    scheduleWorkingDaysBudget: scheduleDayBudget(charter.hiScheduleStart, charter.hiScheduleEnd),
    availableResources,
  };
}

// Build the AI resource pool: the tenant's Resource register (structured capacity) merged with the
// roles parsed out of the charter's hiResources narrative. Register rows come first (real ids +
// capacity); narrative roles supplement what the register doesn't already cover. Tenant scoping is
// applied by the Prisma extension. Bounded by mergeResourcePool.
export async function assembleResourcePool(hiResources: string | null): Promise<AvailableResource[]> {
  const register = await prisma.resource.findMany({
    select: { id: true, name: true, roleTitle: true, capacityPerDay: true },
    orderBy: { name: 'asc' },
  });
  return mergeResourcePool(
    register.map((r) => ({ id: r.id, name: r.name, roleTitle: r.roleTitle, capacityPerDay: Number(r.capacityPerDay) })),
    parseHiResources(hiResources),
  );
}

// Generate a schedule DRAFT. Does NOT persist. Assumes the global env gate (aiEnabled) was already
// checked by the route (→ 503 when off). Returns the draft plus charter meta for the review banner.
export async function generateScheduleDraft(projectId: string, lang: SuggestLang = 'en'): Promise<{
  draft: ScheduleDraft;
  charter: { scheduleStart: Date; scheduleEnd: Date; scheduleWorkingDaysBudget: number };
}> {
  const ctx = await loadCharterContext(projectId);
  const { system, user } = buildScheduleSuggestPrompt(ctx, lang);
  const raw = await getAiPort().draftJson({ system, user, jsonSchema: SCHEDULE_DRAFT_JSON_SCHEMA, maxTokens: 4000 });
  const parsed = raw == null ? null : ScheduleDraftSchema.safeParse(raw);
  if (!parsed || !parsed.success) {
    throw new AppError(
      502,
      lang === 'id'
        ? 'AI tidak dapat menyusun draft jadwal saat ini. Silakan buat jadwal secara manual.'
        : 'AI could not compose a schedule draft right now. Please build the schedule manually.',
      'AI_UNAVAILABLE',
    );
  }
  return {
    draft: parsed.data,
    charter: {
      scheduleStart: ctx.charter.scheduleStart,
      scheduleEnd: ctx.charter.scheduleEnd,
      scheduleWorkingDaysBudget: ctx.scheduleWorkingDaysBudget,
    },
  };
}

// A row ready for prisma.task.createMany. Parents carry an explicit id so children can reference it.
export interface PlannedRow {
  id: string;
  parentTaskId: string | null;
  projectId: string;
  wbsCode: string;
  sortOrder: number;
  name: string;
  isMilestone: boolean;
  planStart: Date;
  planEnd: Date;
  deliverable: string | null;
  acceptanceCriteria: string | null;
  progressPct: number;
  weight: number | null;
  // Lead owner, set during materialise when the task's role maps to a register resource.
  picResourceId?: string | null;
}

// PURE: turn a draft into createMany rows. Sequential calendar-day dates (parity with templates):
// each work package starts when the previous finishes; a phase spans its children. WBS codes and
// sortOrder continue from `startCount`/`startSort` so this appends cleanly onto an existing schedule.
// Unit-tested without a DB.
export function planScheduleRows(
  projectId: string,
  draft: ScheduleDraft,
  startDate: Date,
  startCount: number,
  startSort: number,
): { rows: PlannedRow[]; projectedEnd: Date; refToId: Map<string, string>; orderedLeafIds: string[] } {
  const base = new Date(startDate);
  base.setUTCHours(0, 0, 0, 0);
  let cursor = +base; // epoch ms of the next task's start
  let seq = startCount; // drives the T-NNN wbs code
  let sort = startSort;
  const parents: PlannedRow[] = [];
  const children: PlannedRow[] = [];
  const refToId = new Map<string, string>(); // AI ref → created work-package id (first ref wins)
  const orderedLeafIds: string[] = []; // work packages in creation order (sequential-chain fallback)

  for (const phase of draft.phases) {
    const phaseId = randomUUID();
    // The phase (parent) takes the next code/sortOrder, then its work packages follow in order.
    const phaseCode = generateTaskCode(++seq);
    const phaseSort = ++sort;
    const phaseStart = cursor;
    for (const task of phase.tasks) {
      const milestone = task.isMilestone === true || task.durationDays === 0;
      const start = cursor;
      const end = cursor + task.durationDays * MS_PER_DAY;
      cursor = end; // next work package starts when this one finishes
      const taskId = randomUUID();
      if (task.ref && !refToId.has(task.ref)) refToId.set(task.ref, taskId);
      orderedLeafIds.push(taskId);
      children.push({
        id: taskId,
        parentTaskId: phaseId,
        projectId,
        wbsCode: generateTaskCode(++seq),
        sortOrder: ++sort,
        name: task.name,
        isMilestone: milestone,
        planStart: new Date(start),
        planEnd: new Date(end),
        deliverable: task.deliverable ?? null,
        acceptanceCriteria: task.acceptanceCriteria ?? null,
        progressPct: 0,
        weight: task.weight ?? null,
      });
    }
    parents.push({
      id: phaseId,
      parentTaskId: null,
      projectId,
      wbsCode: phaseCode,
      sortOrder: phaseSort,
      name: phase.name,
      isMilestone: false,
      planStart: new Date(phaseStart),
      planEnd: new Date(cursor),
      deliverable: phase.deliverable ?? null,
      acceptanceCriteria: null,
      progressPct: 0,
      weight: phase.weight ?? null,
    });
  }
  // Parents must be inserted before children (self-referencing FK).
  return { rows: [...parents, ...children], projectedEnd: new Date(cursor), refToId, orderedLeafIds };
}

// PURE: derive finish-to-start dependency edges from the draft. Prefers the AI's `deps` graph
// (validated: refs must resolve, no self-loops, deduped) and drops any edge that would introduce a
// cycle. Falls back to a sequential chain (each work package after the previous) ONLY when the AI
// supplied no usable links at all. Unit-tested without a DB.
export function planDependencies(
  draft: ScheduleDraft,
  refToId: Map<string, string>,
  orderedLeafIds: string[],
): { predecessorId: string; successorId: string }[] {
  const aiEdges: { predecessorId: string; successorId: string }[] = [];
  const seen = new Set<string>();
  for (const phase of draft.phases) {
    for (const task of phase.tasks) {
      const succ = task.ref ? refToId.get(task.ref) : undefined;
      if (!succ || !task.deps?.length) continue;
      for (const depRef of task.deps) {
        const pred = refToId.get(depRef);
        if (!pred || pred === succ) continue; // dangling ref or self-loop
        const key = `${pred}->${succ}`;
        if (seen.has(key)) continue;
        seen.add(key);
        aiEdges.push({ predecessorId: pred, successorId: succ });
      }
    }
  }

  const candidate = aiEdges.length
    ? aiEdges
    : orderedLeafIds.slice(1).map((id, i) => ({ predecessorId: orderedLeafIds[i], successorId: id }));

  // Add edges one at a time, skipping any that would close a cycle (defense-in-depth).
  const accepted: { predecessorId: string; successorId: string }[] = [];
  for (const e of candidate) {
    const edges = [...accepted, e].map((x) => ({ from: x.predecessorId, to: x.successorId }));
    if (!hasDependencyCycle(edges)) accepted.push(e);
  }
  return accepted;
}

// PURE: scale non-milestone task durations proportionally so the sequential timeline spans exactly
// `windowDays` (calendar). Milestones stay 0. The integer-rounding residual is folded into the
// longest task so the total lands on windowDays (each task stays >= 1 day). Returns a NEW draft;
// the input is untouched. No-op when there is nothing to scale or the window is non-positive.
export function fitDraftToWindow(draft: ScheduleDraft, windowDays: number): ScheduleDraft {
  const nm: { pi: number; ti: number; dd: number }[] = [];
  draft.phases.forEach((p, pi) => p.tasks.forEach((tk, ti) => {
    if (!(tk.isMilestone === true || tk.durationDays === 0)) nm.push({ pi, ti, dd: tk.durationDays });
  }));
  const total = nm.reduce((s, x) => s + x.dd, 0);
  if (total <= 0 || windowDays <= 0) return draft;

  const factor = windowDays / total;
  const scaled = nm.map((x) => ({ pi: x.pi, ti: x.ti, v: Math.max(1, Math.round(x.dd * factor)) }));
  let residual = windowDays - scaled.reduce((s, x) => s + x.v, 0);
  if (residual !== 0 && scaled.length) {
    let idx = 0;
    for (let i = 1; i < scaled.length; i++) if (scaled[i].v > scaled[idx].v) idx = i;
    scaled[idx].v = Math.max(1, scaled[idx].v + residual);
  }
  const byKey = new Map(scaled.map((x) => [`${x.pi}:${x.ti}`, x.v]));
  return {
    phases: draft.phases.map((p, pi) => ({
      ...p,
      tasks: p.tasks.map((tk, ti) => {
        const v = byKey.get(`${pi}:${ti}`);
        return v == null ? tk : { ...tk, durationDays: v };
      }),
    })),
  };
}

const daysBetween = (a: Date, b: Date): number => Math.round((+b - +a) / MS_PER_DAY);

// Materialise a (possibly PM-edited) draft into the WBS. Re-checks the gates + baseline lock, then
// creates the phase parents and their work packages in one transaction. Appends when the schedule
// already has tasks (WBS codes / sortOrder continue from the current max).
export async function applyScheduleDraft(
  projectId: string,
  inputDraft: ScheduleDraft,
  startDate: Date | undefined,
  actorId: string,
  opts: { link?: boolean; fit?: boolean; level?: boolean; assign?: boolean } = {},
): Promise<{ created: number; phases: number; projectedEnd: Date; links: number; levelingLinks: number; assigned: number }> {
  const ctx = await loadCharterContext(projectId); // gate + opt-in + chartered
  await assertBaselineUnlocked(projectId);

  const existing = await prisma.task.findMany({
    where: { projectId },
    select: { sortOrder: true, planEnd: true },
    orderBy: { planEnd: 'desc' },
  });
  const startCount = existing.length;
  const startSort = existing.reduce((m, t) => Math.max(m, t.sortOrder), -1);

  // Default start: append after the latest existing task, else the charter start date.
  let base = startDate;
  if (!base) {
    if (existing.length > 0) {
      base = new Date(+existing[0].planEnd + MS_PER_DAY);
    } else {
      const c = await prisma.projectCharter.findUnique({ where: { projectId }, select: { hiScheduleStart: true } });
      base = c?.hiScheduleStart ?? new Date();
    }
  }

  // Hard-fit (opt-in): scale durations so the timeline lands on the charter end from the chosen start.
  const draft = opts.fit ? fitDraftToWindow(inputDraft, daysBetween(base, ctx.charter.scheduleEnd)) : inputDraft;

  const { rows, projectedEnd, refToId, orderedLeafIds } = planScheduleRows(projectId, draft, base, startCount, startSort);
  const parents = rows.filter((r) => r.parentTaskId === null);
  const children = rows.filter((r) => r.parentTaskId !== null);

  const link = opts.link !== false;
  const doAssign = opts.assign !== false;
  const doLevel = opts.level !== false;

  // Pair each draft task with its created leaf id (planScheduleRows visits tasks in this same order,
  // so orderedLeafIds[k] is the k-th draft task) and resolve it to a pool resource.
  const pool = ctx.availableResources;
  const poolByRef = new Map(pool.map((r) => [r.ref, r]));
  const pairs: { task: DraftTask; id: string; order: number }[] = [];
  let k = 0;
  for (const phase of draft.phases) for (const task of phase.tasks) { pairs.push({ task, id: orderedLeafIds[k], order: k }); k++; }
  const assign = resolveAssignments(pairs.map((p) => ({ id: p.id, resourceRole: p.task.resourceRole, resourceRef: p.task.resourceRef })), pool);

  // Owner assignment: set the lead owner only when the resolved pool entry is a real register
  // resource (narrative-only roles have no id → left unassigned for the PM to fill).
  const ownerRows: { taskId: string; resourceId: string }[] = [];
  if (doAssign) {
    const childById = new Map(children.map((c) => [c.id, c]));
    for (const p of pairs) {
      const ref = assign.get(p.id);
      const res = ref ? poolByRef.get(ref) : undefined;
      if (!res?.resourceId) continue;
      const row = childById.get(p.id);
      if (row) { row.picResourceId = res.resourceId; ownerRows.push({ taskId: p.id, resourceId: res.resourceId }); }
    }
  }

  // Hybrid dependencies: the AI's validated FS graph, else a sequential chain. Only for the tasks
  // this call creates (existing tasks are never re-linked).
  const aiDeps = link ? planDependencies(draft, refToId, orderedLeafIds) : [];
  // Resource leveling: add the minimum FS edges so no resource is booked past capacity (same-resource
  // work serialises; different resources stay parallel). Layered on the logical graph, acyclic-guarded.
  let deps = aiDeps;
  if (link && doLevel && pool.length) {
    const levelTasks: LevelTask[] = pairs.map((p) => ({
      id: p.id,
      durationDays: p.task.durationDays,
      sortOrder: p.order,
      poolRef: assign.get(p.id) ?? null,
      isMilestone: p.task.isMilestone === true || p.task.durationDays === 0,
    }));
    const capMap = new Map(pool.map((r) => [r.ref, r.capacityPerDay]));
    const accepted = [...aiDeps];
    for (const e of planLevelingEdges(levelTasks, aiDeps, capMap)) {
      const edges = [...accepted, e].map((x) => ({ from: x.predecessorId, to: x.successorId }));
      if (!hasDependencyCycle(edges)) accepted.push(e);
    }
    deps = accepted;
  }
  const levelingLinks = deps.length - aiDeps.length;

  await prisma.$transaction([
    prisma.task.createMany({ data: parents }),
    prisma.task.createMany({ data: children }),
    ...(ownerRows.length ? [prisma.taskOwner.createMany({ data: ownerRows })] : []),
    ...(deps.length
      ? [prisma.taskDependency.createMany({ data: deps.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId, type: 'FS' as const, lagDays: 0 })) })]
      : []),
  ]);
  await writeAudit({
    projectId,
    userId: actorId,
    entity: 'Task',
    entityId: projectId,
    action: 'CREATE',
    after: { aiGeneratedSchedule: true, phases: parents.length, taskCount: rows.length, links: deps.length, levelingLinks, assigned: ownerRows.length },
  });

  // Weekend-aware auto-schedule so the FS network drives the dates, then roll the phase spans up
  // from their (possibly shifted) work packages.
  if (deps.length) {
    await applyAutoSchedule(projectId, { actorId, mode: 'asap' });
    await recomputeParentSpans(projectId);
  }
  return { created: rows.length, phases: parents.length, projectedEnd, links: deps.length, levelingLinks, assigned: ownerRows.length };
}

// After leaves move (auto-schedule), a summary phase should span its work packages. Updates only
// the parents whose min-child-start / max-child-end drifted from what's stored.
async function recomputeParentSpans(projectId: string): Promise<void> {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: { id: true, parentTaskId: true, planStart: true, planEnd: true },
  });
  const childrenByParent = new Map<string, { planStart: Date; planEnd: Date }[]>();
  for (const t of tasks) {
    if (!t.parentTaskId) continue;
    const arr = childrenByParent.get(t.parentTaskId) ?? [];
    arr.push({ planStart: t.planStart, planEnd: t.planEnd });
    childrenByParent.set(t.parentTaskId, arr);
  }
  const updates = [];
  for (const p of tasks) {
    const kids = childrenByParent.get(p.id);
    if (!kids?.length) continue;
    const start = new Date(Math.min(...kids.map((k) => +k.planStart)));
    const end = new Date(Math.max(...kids.map((k) => +k.planEnd)));
    if (+start !== +p.planStart || +end !== +p.planEnd) {
      updates.push(prisma.task.update({ where: { id: p.id }, data: { planStart: start, planEnd: end } }));
    }
  }
  if (updates.length) await prisma.$transaction(updates);
}
