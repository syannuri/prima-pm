import { z } from 'zod';

// Closing artifacts: lessons-learned register + acceptance sign-offs.

export const LESSON_CATEGORIES = ['WENT_WELL', 'WENT_WRONG', 'RECOMMENDATION'] as const;
export const ACCEPTANCE_DECISIONS = ['ACCEPTED', 'ACCEPTED_WITH_CONDITIONS', 'REJECTED'] as const;

export const upsertLessonSchema = z.object({
  category: z.enum(LESSON_CATEGORIES).default('RECOMMENDATION'),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional(),
});

export const upsertAcceptanceSchema = z.object({
  party: z.string().trim().min(2).max(160), // who accepts: e.g. "Sponsor", "Customer — Bank X"
  decision: z.enum(ACCEPTANCE_DECISIONS).default('ACCEPTED'),
  signedByName: z.string().trim().max(160).optional(),
  comments: z.string().trim().max(4000).optional(),
  // Optional back-dating of when the sign-off was given (defaults to now on create).
  signedAt: z.coerce.date().optional(),
});

export type UpsertLessonInput = z.infer<typeof upsertLessonSchema>;
export type UpsertAcceptanceInput = z.infer<typeof upsertAcceptanceSchema>;
