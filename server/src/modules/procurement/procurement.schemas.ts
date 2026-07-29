import { z } from 'zod';

export const CONTRACT_TYPES = ['FIXED_PRICE', 'TIME_AND_MATERIALS', 'COST_PLUS', 'PURCHASE_ORDER'] as const;
export const PROCUREMENT_STATUSES = ['PLANNED', 'SOLICITATION', 'AWARDED', 'IN_PROGRESS', 'DELIVERED', 'CLOSED', 'CANCELLED'] as const;

export const upsertProcurementSchema = z
  .object({
    title: z.string().min(3).max(200),
    vendor: z.string().max(160).optional(),
    vendorContact: z.string().max(200).optional(),
    type: z.enum(CONTRACT_TYPES).default('PURCHASE_ORDER'),
    status: z.enum(PROCUREMENT_STATUSES).default('PLANNED'),
    amount: z.coerce.number().min(0).max(1e15).optional(),
    needBy: z.coerce.date().optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    scope: z.string().max(4000).optional(),
    notes: z.string().max(4000).optional(),
    // Committed-cost link: charge to ONE budget line (direct XOR indirect). null clears it.
    costDirectLineId: z.string().uuid().nullable().optional(),
    costIndirectLineId: z.string().uuid().nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.costDirectLineId && d.costIndirectLineId)
      ctx.addIssue({ code: 'custom', path: ['costIndirectLineId'], message: 'Charge to a direct OR an indirect line, not both' });
  });

export type UpsertProcurementInput = z.infer<typeof upsertProcurementSchema>;
