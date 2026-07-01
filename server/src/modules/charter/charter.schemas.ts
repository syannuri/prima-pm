import { z } from 'zod';
import { PROJECT_CATEGORIES } from './charter.helpers.js';

// Full charter payload — every field mandatory (matches the "all fields required + Commit" rule).
export const upsertCharterSchema = z
  .object({
    description: z.string().min(5).max(4000),
    goals: z.string().min(5).max(4000),
    category: z.enum(PROJECT_CATEGORIES as [string, ...string[]]),
    hiScope: z.string().min(5).max(4000),
    hiCostIdr: z.coerce.number().positive(),
    hiScheduleStart: z.coerce.date(),
    hiScheduleEnd: z.coerce.date(),
    hiDeliverables: z.string().min(5).max(4000),
    pmUserId: z.string().uuid(),
    deliveryApproach: z.enum(['PREDICTIVE', 'AGILE', 'HYBRID']).optional(),
  })
  .refine((d) => d.hiScheduleEnd.getTime() > d.hiScheduleStart.getTime(), {
    message: 'hiScheduleEnd must be after hiScheduleStart',
    path: ['hiScheduleEnd'],
  });

export const CHANGE_IMPACTS = ['COST', 'SCHEDULE', 'RESOURCE', 'QUALITY', 'RISK'] as const;

export const changeRequestSchema = z.object({
  title: z.string().min(3).max(160),
  description: z.string().min(5).max(4000),
  chargeable: z.boolean().default(false),
  magnitude: z.enum(['MINOR', 'MAJOR']).default('MINOR'),
  impactAreas: z.array(z.enum(CHANGE_IMPACTS)).default([]),
});

export const crDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
});

export type UpsertCharterInput = z.infer<typeof upsertCharterSchema>;
export type ChangeRequestInput = z.infer<typeof changeRequestSchema>;
export type CrDecisionInput = z.infer<typeof crDecisionSchema>;
