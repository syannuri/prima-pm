import { z } from 'zod';

// A timesheet entry logs actual man-days against a specific MANPOWER cost line.
export const mandayEntrySchema = z.object({
  costItemId: z.string().uuid(),
  date: z.coerce.date(),
  mandays: z.coerce.number().positive().max(100000),
  note: z.string().trim().max(500).optional(),
});

export type MandayEntryInput = z.infer<typeof mandayEntrySchema>;
