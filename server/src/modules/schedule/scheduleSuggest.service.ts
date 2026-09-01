import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError, BadRequest, NotFound } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { getAiPort, aiNotEnabledError } from '../../lib/ai.js';
import { assertBaselineUnlocked } from '../projects/baseline.service.js';
import { generateTaskCode } from './schedule.helpers.js';

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
export const DraftTaskSchema = z.object({
  name: z.string().min(2).max(200),
  durationDays: z.number().int().min(0).max(MAX_DURATION_DAYS),
  isMilestone: z.boolean().optional(),
  deliverable: z.string().max(1000).nullable().optional(),
  acceptanceCriteria: z.string().max(2000).nullable().optional(),
  weight: z.number().min(0).max(1000).nullable().optional(),
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
              },
              required: ['name', 'durationDays'],
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
  '',
  'Untuk tiap fase hasilkan: name, deliverable (opsional), weight (opsional), dan tasks[]. Untuk tiap task: name, durationDays, isMilestone, deliverable (opsional), acceptanceCriteria (opsional), weight (opsional).',
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
  '',
  'For each phase produce: name, deliverable (optional), weight (optional), and tasks[]. For each task: name, durationDays, isMilestone, deliverable (optional), acceptanceCriteria (optional), weight (optional).',
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
  };
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
): { rows: PlannedRow[]; projectedEnd: Date } {
  const base = new Date(startDate);
  base.setUTCHours(0, 0, 0, 0);
  let cursor = +base; // epoch ms of the next task's start
  let seq = startCount; // drives the T-NNN wbs code
  let sort = startSort;
  const parents: PlannedRow[] = [];
  const children: PlannedRow[] = [];

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
      children.push({
        id: randomUUID(),
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
  return { rows: [...parents, ...children], projectedEnd: new Date(cursor) };
}

// Materialise a (possibly PM-edited) draft into the WBS. Re-checks the gates + baseline lock, then
// creates the phase parents and their work packages in one transaction. Appends when the schedule
// already has tasks (WBS codes / sortOrder continue from the current max).
export async function applyScheduleDraft(
  projectId: string,
  draft: ScheduleDraft,
  startDate: Date | undefined,
  actorId: string,
): Promise<{ created: number; phases: number; projectedEnd: Date }> {
  await loadCharterContext(projectId); // gate + opt-in + chartered
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

  const { rows, projectedEnd } = planScheduleRows(projectId, draft, base, startCount, startSort);
  const parents = rows.filter((r) => r.parentTaskId === null);
  const children = rows.filter((r) => r.parentTaskId !== null);

  await prisma.$transaction([
    prisma.task.createMany({ data: parents }),
    prisma.task.createMany({ data: children }),
  ]);
  await writeAudit({
    projectId,
    userId: actorId,
    entity: 'Task',
    entityId: projectId,
    action: 'CREATE',
    after: { aiGeneratedSchedule: true, phases: parents.length, taskCount: rows.length },
  });
  return { created: rows.length, phases: parents.length, projectedEnd };
}
