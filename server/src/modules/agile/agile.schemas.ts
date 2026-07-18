import { z } from 'zod';

export const sprintSchema = z.object({
  name: z.string().trim().min(1).max(120),
  goal: z.string().trim().max(2000).optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  status: z.enum(['PLANNED', 'ACTIVE', 'CLOSED']).optional(),
});
export const sprintUpdateSchema = sprintSchema.partial();

export const backlogItemSchema = z.object({
  type: z.enum(['EPIC', 'STORY', 'TASK', 'BUG']).optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(5000).optional().nullable(),
  acceptanceCriteria: z.string().trim().max(5000).optional().nullable(),
  storyPoints: z.number().int().min(0).max(999).optional().nullable(),
  priority: z.number().int().min(0).max(9999).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'DEFERRED']).optional(),
  assigneeUserId: z.string().uuid().optional().nullable(),
  sprintId: z.string().uuid().optional().nullable(),
});
export const backlogItemUpdateSchema = backlogItemSchema.partial();

// Story-point → man-days conversion factor used by the capacity/utilization view.
export const agileSettingsSchema = z.object({
  mandaysPerPoint: z.coerce.number().positive().max(100),
});

export type SprintInput = z.infer<typeof sprintSchema>;
export type BacklogItemInput = z.infer<typeof backlogItemSchema>;
