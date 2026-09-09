import { z } from 'zod';
import { PROJECT_CATEGORIES, DELIVERY_APPROACHES } from '../projects/projects.schemas.js';

const money = z.coerce.number().nonnegative().max(1e15);
const score = z.coerce.number().int().min(1).max(5);
const weight = z.coerce.number().min(0).max(10);

// Create / edit a proposal (intake idea). Only the title is required — the rest is progressively
// filled in as the idea matures. OTHER category needs a free-text detail (mirrors project create).
export const upsertProposalSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    summary: z.string().trim().max(4000).optional(),
    sponsor: z.string().trim().max(120).optional(),
    clientName: z.string().trim().max(160).optional(),
    category: z.enum(PROJECT_CATEGORIES).optional(),
    categoryOther: z.string().trim().max(120).optional(),
    deliveryApproach: z.enum(DELIVERY_APPROACHES).optional(),
    estCostIdr: money.optional(),
    estRevenueIdr: money.optional(),
    targetStart: z.coerce.date().optional(),
    targetFinish: z.coerce.date().optional(),
    programId: z.string().uuid().nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.category === 'OTHER' && !d.categoryOther?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Describe the category when choosing Other', path: ['categoryOther'] });
    }
    if (d.targetStart && d.targetFinish && d.targetFinish < d.targetStart) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Target finish must be on or after target start', path: ['targetFinish'] });
    }
  });
export type UpsertProposalInput = z.infer<typeof upsertProposalSchema>;

// Partial scoring — any subset of the five criteria (1..5), or null to clear one.
export const scoreSchema = z.object({
  scoreStrategic: score.nullable().optional(),
  scoreValue: score.nullable().optional(),
  scoreRisk: score.nullable().optional(),
  scoreCost: score.nullable().optional(),
  scoreUrgency: score.nullable().optional(),
});
export type ScoreInput = z.infer<typeof scoreSchema>;

export const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'DEFER']),
  note: z.string().trim().max(2000).optional(),
});
export type DecisionInput = z.infer<typeof decisionSchema>;

// Optional PM to assign to the project created on convert.
export const convertSchema = z.object({ pmUserId: z.string().uuid().nullable().optional() });

// Per-tenant scoring weights (ADMIN/PMO). Risk & cost are cost-type criteria (inverted in the total).
export const weightsSchema = z.object({
  strategic: weight,
  value: weight,
  risk: weight,
  cost: weight,
  urgency: weight,
});
export type WeightsInput = z.infer<typeof weightsSchema>;

// Reorder the priority ranking — an array of proposal ids in the desired order.
export const rankSchema = z.object({ order: z.array(z.string().uuid()).max(1000) });
