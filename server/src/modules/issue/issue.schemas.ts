import { z } from 'zod';

export const ISSUE_IMPACTS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const ISSUE_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

export const upsertIssueSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(4000).optional(),
  category: z.string().max(120).optional(),
  impact: z.enum(ISSUE_IMPACTS).default('MEDIUM'),
  status: z.enum(ISSUE_STATUSES).default('OPEN'),
  ownerUserId: z.string().uuid().optional(),
  resolution: z.string().max(4000).optional(),
  // Optional back-dating: when the issue actually occurred (defaults to now on create).
  raisedAt: z.coerce.date().optional(),
});

export type UpsertIssueInput = z.infer<typeof upsertIssueSchema>;
