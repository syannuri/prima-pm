import { z } from 'zod';

export const RISK_KINDS = ['THREAT', 'OPPORTUNITY'] as const;
export const RISK_STATUSES = [
  'IDENTIFIED',
  'ANALYZING',
  'PLANNED',
  'OPEN',
  'CLOSED',
  'OCCURRED',
] as const;
export const RESPONSE_STRATEGIES = [
  'AVOID',
  'MITIGATE',
  'TRANSFER',
  'ACCEPT',
  'EXPLOIT',
  'ENHANCE',
  'SHARE',
] as const;

export const upsertRiskSchema = z
  .object({
    title: z.string().min(3).max(200),
    description: z.string().max(4000).optional(),
    category: z.string().max(120).optional(),
    kind: z.enum(RISK_KINDS).default('THREAT'),
    status: z.enum(RISK_STATUSES).default('IDENTIFIED'),
    ownerUserId: z.string().uuid().optional(),

    // Qualitative
    probabilityScore: z.coerce.number().int().min(1).max(5),
    impactScore: z.coerce.number().int().min(1).max(5),

    // Quantitative (EMV)
    probabilityPct: z.coerce.number().min(0).max(1),
    impactCostIdr: z.coerce.number().nonnegative(),

    // Response
    responseStrategy: z.enum(RESPONSE_STRATEGIES).optional(),
    responseCost: z.coerce.number().nonnegative().optional(),
    residualProbabilityPct: z.coerce.number().min(0).max(1).optional(),
    residualImpactCost: z.coerce.number().nonnegative().optional(),

    includeInReserve: z.boolean().default(true),
  })
  .refine(
    (d) =>
      (d.residualProbabilityPct == null) === (d.residualImpactCost == null),
    {
      message: 'Provide both residualProbabilityPct and residualImpactCost, or neither',
      path: ['residualProbabilityPct'],
    },
  );

export type UpsertRiskInput = z.infer<typeof upsertRiskSchema>;
