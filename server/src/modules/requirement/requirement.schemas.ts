import { z } from 'zod';

export const REQUIREMENT_CATEGORIES = ['FUNCTIONAL', 'NON_FUNCTIONAL', 'BUSINESS', 'TECHNICAL', 'REGULATORY', 'OTHER'] as const;
// MoSCoW prioritisation.
export const REQUIREMENT_PRIORITIES = ['MUST', 'SHOULD', 'COULD', 'WONT'] as const;
export const REQUIREMENT_STATUSES = ['PROPOSED', 'APPROVED', 'IN_PROGRESS', 'VERIFIED', 'DEFERRED', 'REJECTED'] as const;

export const upsertRequirementSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(4000).optional(),
  category: z.enum(REQUIREMENT_CATEGORIES).default('FUNCTIONAL'),
  priority: z.enum(REQUIREMENT_PRIORITIES).default('MUST'),
  status: z.enum(REQUIREMENT_STATUSES).default('PROPOSED'),
  source: z.string().max(200).optional(),
  acceptanceCriteria: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
});

export const linkTaskSchema = z.object({
  taskId: z.string().uuid(),
});

export type UpsertRequirementInput = z.infer<typeof upsertRequirementSchema>;
export type LinkTaskInput = z.infer<typeof linkTaskSchema>;
