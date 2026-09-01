import { z } from 'zod';

export const DEPENDENCY_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;

// Plan dates and dependency lag feed the working-day scheduler, which walks calendar days one at a
// time (see schedule.helpers). Bounding them here keeps a single request from spinning the Node
// event loop for billions of iterations (a DoS on the shared, pooled multi-tenant server).
const PLAN_MIN = new Date('2000-01-01T00:00:00.000Z');
const PLAN_MAX = new Date('2100-12-31T00:00:00.000Z');
const planDate = () => z.coerce.date().min(PLAN_MIN, 'date is out of the supported range').max(PLAN_MAX, 'date is out of the supported range');
const LAG_MAX = 3650; // ±10 years of working days — far beyond any real lag/lead

export const upsertTaskSchema = z
  .object({
    name: z.string().min(2).max(200),
    wbsCode: z.string().max(40).optional(), // auto-generated if omitted
    // WBS dictionary
    description: z.string().max(2000).nullable().optional(),
    deliverable: z.string().max(1000).nullable().optional(),
    acceptanceCriteria: z.string().max(2000).nullable().optional(),
    parentTaskId: z.string().uuid().nullable().optional(),
    planStart: planDate(),
    planEnd: planDate(),
    actualStart: planDate().nullable().optional(),
    actualFinish: planDate().nullable().optional(),
    picUserId: z.string().uuid().nullable().optional(),
    // picResourceId = the LEAD owner. ownerResourceIds = the FULL owner set (lead + co-owners).
    // When ownerResourceIds is provided the task's owner links are replaced with it; when omitted
    // the existing owners are left untouched (so unrelated edits don't drop assignments).
    picResourceId: z.string().uuid().nullable().optional(),
    ownerResourceIds: z.array(z.string().uuid()).max(20).optional(),
    progressPct: z.coerce.number().int().min(0).max(100).default(0),
    // Manual relative work-package weight (Model B). null/omitted = derive from cost/duration.
    weight: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
    isMilestone: z.boolean().default(false),
    sortOrder: z.coerce.number().int().default(0),
  })
  .refine((d) => d.planEnd.getTime() >= d.planStart.getTime(), {
    message: 'planEnd must be on/after planStart',
    path: ['planEnd'],
  })
  .refine(
    (d) => !d.actualFinish || !d.actualStart || d.actualFinish.getTime() >= d.actualStart.getTime(),
    { message: 'actualFinish must be on/after actualStart', path: ['actualFinish'] },
  );

export const dependencySchema = z.object({
  predecessorId: z.string().uuid(),
  type: z.enum(DEPENDENCY_TYPES).default('FS'),
  lagDays: z.coerce.number().int().min(-LAG_MAX).max(LAG_MAX).default(0),
});

// Edit an existing link's type/lag (the predecessor↔successor pair is immutable).
export const dependencyEditSchema = z.object({
  type: z.enum(DEPENDENCY_TYPES),
  lagDays: z.coerce.number().int().min(-LAG_MAX).max(LAG_MAX),
});

export const evmQuerySchema = z.object({
  // Optional override; when omitted, EVM uses the stored time-phased Actual Cost.
  actualCost: z.coerce.number().nonnegative().optional(),
  statusDate: z.coerce.date().optional(),
});

// Lightweight progress update (drives the WBS "% complete" / status) without a full
// task replace, so parent/sortOrder/dependencies are never clobbered.
export const progressSchema = z.object({
  progressPct: z.coerce.number().int().min(0).max(100),
});

// Actual-date tracking update — execution data that keeps evolving during delivery, so it's
// editable even under a locked baseline (unlike plan dates / structure). Either field may be
// sent; a null clears it, an omitted field is left untouched. At least one must be present.
export const taskActualsSchema = z
  .object({
    actualStart: z.coerce.date().nullable().optional(),
    actualFinish: z.coerce.date().nullable().optional(),
  })
  .refine((d) => d.actualStart !== undefined || d.actualFinish !== undefined, {
    message: 'Provide actualStart and/or actualFinish',
  })
  .refine(
    (d) => !d.actualFinish || !d.actualStart || d.actualFinish.getTime() >= d.actualStart.getTime(),
    { message: 'actualFinish must be on/after actualStart', path: ['actualFinish'] },
  );

// Bulk-replace a task's weighted progress steps. progressPct is then DERIVED from the done steps'
// weights (see setTaskSteps), so this is both a definition edit and a progress update.
export const taskStepsSchema = z.object({
  steps: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        weight: z.coerce.number().min(0).max(1_000_000).default(1),
        done: z.boolean().default(false),
      }),
    )
    .max(50),
});

export const applyTemplateSchema = z.object({
  templateId: z.string().min(1),
  startDate: z.coerce.date().optional(),
});

// Bulk-delete selected tasks (each expanded to its subtree). Bounded to avoid an unbounded IN list.
export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(2000),
});

export type TaskStepsInput = z.infer<typeof taskStepsSchema>;
export type UpsertTaskInput = z.infer<typeof upsertTaskSchema>;
export type DependencyInput = z.infer<typeof dependencySchema>;
export type DependencyEditInput = z.infer<typeof dependencyEditSchema>;
export type ProgressInput = z.infer<typeof progressSchema>;
export type TaskActualsInput = z.infer<typeof taskActualsSchema>;
