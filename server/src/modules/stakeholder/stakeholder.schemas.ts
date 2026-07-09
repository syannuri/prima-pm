import { z } from 'zod';

export const STAKEHOLDER_CATEGORIES = ['SPONSOR', 'CUSTOMER', 'TEAM', 'VENDOR', 'REGULATOR', 'END_USER', 'OTHER'] as const;
export const INFLUENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const ENGAGEMENT_LEVELS = ['UNAWARE', 'RESISTANT', 'NEUTRAL', 'SUPPORTIVE', 'LEADING'] as const;

export const upsertStakeholderSchema = z.object({
  name: z.string().min(2).max(160),
  role: z.string().max(160).optional(),
  organization: z.string().max(160).optional(),
  category: z.enum(STAKEHOLDER_CATEGORIES).default('OTHER'),
  power: z.enum(INFLUENCE_LEVELS).default('MEDIUM'),
  interest: z.enum(INFLUENCE_LEVELS).default('MEDIUM'),
  currentEngagement: z.enum(ENGAGEMENT_LEVELS).default('NEUTRAL'),
  desiredEngagement: z.enum(ENGAGEMENT_LEVELS).default('SUPPORTIVE'),
  email: z.string().email().max(200).optional().or(z.literal('')),
  strategy: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
});

export type UpsertStakeholderInput = z.infer<typeof upsertStakeholderSchema>;
