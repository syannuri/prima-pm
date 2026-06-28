import { z } from 'zod';

export const DEPENDENCY_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;

export const upsertTaskSchema = z
  .object({
    name: z.string().min(2).max(200),
    wbsCode: z.string().max(40).optional(), // auto-generated if omitted
    parentTaskId: z.string().uuid().nullable().optional(),
    planStart: z.coerce.date(),
    planEnd: z.coerce.date(),
    actualStart: z.coerce.date().nullable().optional(),
    actualFinish: z.coerce.date().nullable().optional(),
    picUserId: z.string().uuid().nullable().optional(),
    progressPct: z.coerce.number().int().min(0).max(100).default(0),
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
  lagDays: z.coerce.number().int().default(0),
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

export type UpsertTaskInput = z.infer<typeof upsertTaskSchema>;
export type DependencyInput = z.infer<typeof dependencySchema>;
export type ProgressInput = z.infer<typeof progressSchema>;
