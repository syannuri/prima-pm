import { z } from 'zod';

export const PROJECT_CATEGORIES = [
  'NETWORK_INFRA', 'SERVER_INFRA', 'CLOUD_INFRA', 'CYBERSECURITY_INFRA', 'DATACENTER',
  'APP_DEV', 'ENTERPRISE_APP', 'SYSTEM_INTEGRATION', 'DATA_ANALYTICS', 'AI_ML',
  'DIGITAL_TRANSFORMATION', 'MANAGED_SERVICES', 'IT_CONSULTING', 'OTHER',
] as const;
export const DELIVERY_APPROACHES = ['PREDICTIVE', 'AGILE', 'HYBRID'] as const;

// A free-text detail is required only when the category is OTHER; cleared/ignored otherwise.
const requireCategoryOther = (
  d: { category?: string | null; categoryOther?: string | null },
  ctx: z.RefinementCtx,
) => {
  if (d.category === 'OTHER' && !d.categoryOther?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Describe the category when choosing Other',
      path: ['categoryOther'],
    });
  }
};

export const createProjectSchema = z
  .object({
    name: z.string().min(2).max(160),
    code: z.string().trim().min(2).max(40).optional(), // override the auto-generated code
    clientName: z.string().max(160).optional(),
    sponsor: z.string().max(160).optional(),
    pmUserId: z.string().uuid().optional(),
    category: z.enum(PROJECT_CATEGORIES).optional(),
    categoryOther: z.string().trim().max(120).optional(),
    deliveryApproach: z.enum(DELIVERY_APPROACHES).optional(),
    costBaselineIdr: z.coerce.number().nonnegative().optional(),
    totalRevenueIdr: z.coerce.number().nonnegative().optional(),
  })
  .superRefine(requireCategoryOther);

export const updateProjectSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  code: z.string().trim().min(2).max(40).optional(),
  clientName: z.string().max(160).nullable().optional(),
  sponsor: z.string().max(160).nullable().optional(),
  category: z.enum(PROJECT_CATEGORIES).nullable().optional(),
  categoryOther: z.string().trim().max(120).nullable().optional(),
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
  // Reason for reopening a CLOSED project (mandatory when status CLOSED → IN_PROGRESS).
  reopenReason: z.string().trim().max(500).optional(),
  // Activation controls (only meaningful when status CHARTERED → IN_PROGRESS). forceActivate
  // lets an ADMIN/PMO override the baseline-readiness gate; activateReason is then mandatory.
  forceActivate: z.boolean().optional(),
  activateReason: z.string().trim().max(500).optional(),
}).superRefine(requireCategoryOther);

export const reassignPmSchema = z.object({
  pmUserId: z.string().uuid(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ReassignPmInput = z.infer<typeof reassignPmSchema>;
