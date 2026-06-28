import { z } from 'zod';

export const PROJECT_CATEGORIES = ['NETWORK_INFRA', 'SERVER_INFRA', 'CLOUD_INFRA', 'CYBERSECURITY_INFRA', 'APP_DEV'] as const;

export const createProjectSchema = z.object({
  name: z.string().min(2).max(160),
  clientName: z.string().max(160).optional(),
  sponsor: z.string().max(160).optional(),
  pmUserId: z.string().uuid().optional(),
  category: z.enum(PROJECT_CATEGORIES).optional(),
  costBaselineIdr: z.coerce.number().nonnegative().optional(),
  totalRevenueIdr: z.coerce.number().nonnegative().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  clientName: z.string().max(160).nullable().optional(),
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
