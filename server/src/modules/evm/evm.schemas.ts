import { z } from 'zod';

// Capture (or re-capture) a project's EVM as-of a status date. statusDate defaults
// to today on the server; re-capturing the same date upserts that snapshot.
export const captureSnapshotSchema = z.object({
  statusDate: z.coerce.date().optional(),
  note: z.string().trim().max(500).optional(),
});

export type CaptureSnapshotInput = z.infer<typeof captureSnapshotSchema>;
