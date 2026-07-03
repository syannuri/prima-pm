import { z } from 'zod';

export const PROJECT_CATEGORIES = ['NETWORK_INFRA', 'SERVER_INFRA', 'CLOUD_INFRA', 'CYBERSECURITY_INFRA', 'APP_DEV'] as const;
export const DELIVERY_APPROACHES = ['PREDICTIVE', 'AGILE', 'HYBRID'] as const;

export const createProjectSchema = z.object({
  name: z.string().min(2).max(160),
  code: z.string().trim().min(2).max(40).optional(), // override the auto-generated code
  clientName: z.string().max(160).optional(),
  sponsor: z.string().max(160).optional(),
  pmUserId: z.string().uuid().optional(),
  category: z.enum(PROJECT_CATEGORIES).optional(),
  deliveryApproach: z.enum(DELIVERY_APPROACHES).optional(),
  costBaselineIdr: z.coerce.number().nonnegative().optional(),
  totalRevenueIdr: z.coerce.number().nonnegative().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  code: z.string().trim().min(2).max(40).optional(),
  clientName: z.string().max(160).nullable().optional(),
  sponsor: z.string().max(160).nullable().optional(),
  category: z.enum(PROJECT_CATEGORIES).nullable().optional(),
  deliveryApproach: z.enum(DELIVERY_APPROACHES).optional(),
  costBaselineIdr: z.coerce.number().nonnegative().nullable().optional(),
  totalRevenueIdr: z.coerce.number().nonnegative().nullable().optional(),
  pmUserId: z.string().uuid().nullable().optional(),
  status: z.enum(['DRAFT', 'CHARTERED', 'IN_PROGRESS', 'ON_HOLD', 'CLOSED']).optional(),
  // Closure controls (only meaningful when status → CLOSED). forceClose lets an
  // ADMIN/PMO override the readiness gate; closureNote is the summary/reason (and
  // is mandatory when force-closing).
  forceClose: z.boolean().optional(),
  closureNote: z.string().trim().max(1000).optional(),
  // Reason for putting a project ON_HOLD (mandatory when status → ON_HOLD).
  holdReason: z.string().trim().max(500).optional(),
});

export const reassignPmSchema = z.object({
  pmUserId: z.string().uuid(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ReassignPmInput = z.infer<typeof reassignPmSchema>;
