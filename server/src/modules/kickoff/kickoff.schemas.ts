import { z } from 'zod';

export const KICKOFF_ACTION_STATUSES = ['OPEN', 'DONE'] as const;

// Meeting details (upsert — one record per project).
export const upsertMeetingSchema = z.object({
  meetingDate: z.coerce.date().nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  facilitator: z.string().max(120).nullable().optional(),
  agenda: z.string().max(4000).nullable().optional(),
  objectives: z.string().max(4000).nullable().optional(),
  decisions: z.string().max(4000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const attendeeSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().max(120).nullable().optional(), // role / organization
  present: z.boolean().optional(),
});
export const attendeePatchSchema = attendeeSchema.partial();

export const actionItemSchema = z.object({
  description: z.string().min(1).max(1000),
  ownerName: z.string().max(120).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  status: z.enum(KICKOFF_ACTION_STATUSES).optional(),
});
export const actionItemPatchSchema = actionItemSchema.partial();

export type UpsertMeetingInput = z.infer<typeof upsertMeetingSchema>;
export type AttendeeInput = z.infer<typeof attendeeSchema>;
export type ActionItemInput = z.infer<typeof actionItemSchema>;
