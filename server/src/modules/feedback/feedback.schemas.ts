import { z } from 'zod';

// In-app feedback submitted by any signed-in user (incl. sandbox guests). `role` and `tenantId`
// come from the auth context (not the client); `userAgent` is read from the request header.
export const createFeedbackSchema = z.object({
  type: z.enum(['BUG', 'IDEA', 'OTHER']),
  message: z.string().trim().min(3).max(4000),
  pageUrl: z.string().trim().max(512).optional(),
  release: z.string().trim().max(64).optional(),
});

export type CreateFeedbackBody = z.infer<typeof createFeedbackSchema>;
