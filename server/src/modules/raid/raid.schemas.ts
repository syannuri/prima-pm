import { z } from 'zod';

export const IMPACTS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const ASSUMPTION_STATUSES = ['OPEN', 'VALIDATED', 'INVALIDATED'] as const;
export const DEPENDENCY_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export const DEPENDENCY_STATUSES = ['PENDING', 'ON_TRACK', 'AT_RISK', 'RESOLVED'] as const;

export const upsertAssumptionSchema = z.object({
  statement: z.string().min(3).max(2000),
  category: z.string().max(120).optional(),
  status: z.enum(ASSUMPTION_STATUSES).default('OPEN'),
  impact: z.enum(IMPACTS).default('MEDIUM'),
  ownerUserId: z.string().uuid().optional(),
  notes: z.string().max(4000).optional(),
});

export const upsertDependencySchema = z.object({
  description: z.string().min(3).max(2000),
  direction: z.enum(DEPENDENCY_DIRECTIONS).default('INBOUND'),
  counterparty: z.string().max(200).optional(),
  dueDate: z.coerce.date().optional(),
  status: z.enum(DEPENDENCY_STATUSES).default('PENDING'),
  impact: z.enum(IMPACTS).default('MEDIUM'),
  ownerUserId: z.string().uuid().optional(),
  notes: z.string().max(4000).optional(),
});

export type UpsertAssumptionInput = z.infer<typeof upsertAssumptionSchema>;
export type UpsertDependencyInput = z.infer<typeof upsertDependencySchema>;
