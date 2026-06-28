import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(2).max(160),
  sponsor: z.string().max(160).optional(),
  pmUserId: z.string().uuid().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  sponsor: z.string().max(160).nullable().optional(),
  pmUserId: z.string().uuid().nullable().optional(),
  status: z.enum(['DRAFT', 'CHARTERED', 'IN_PROGRESS', 'ON_HOLD', 'CLOSED']).optional(),
});

export const reassignPmSchema = z.object({
  pmUserId: z.string().uuid(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ReassignPmInput = z.infer<typeof reassignPmSchema>;
