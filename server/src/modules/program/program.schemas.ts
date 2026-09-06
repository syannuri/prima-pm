import { z } from 'zod';

export const createProgramSchema = z.object({
  code: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000).optional(),
  sponsor: z.string().trim().max(120).optional(),
  managerUserId: z.string().max(64).optional(),
});

export const updateProgramSchema = z.object({
  code: z.string().trim().max(40).nullable().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  sponsor: z.string().trim().max(120).nullable().optional(),
  managerUserId: z.string().max(64).nullable().optional(),
  archived: z.boolean().optional(),
});

export const assignProjectSchema = z.object({ projectId: z.string().min(1) });

export type CreateProgramInput = z.infer<typeof createProgramSchema>;
export type UpdateProgramInput = z.infer<typeof updateProgramSchema>;
