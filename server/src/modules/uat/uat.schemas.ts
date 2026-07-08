import { z } from 'zod';

export const UAT_STATUSES = ['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED'] as const;

// Create a UAT test case (the "given / when / then" template). Execution fields are set later
// via update.
export const createTestCaseSchema = z.object({
  title: z.string().min(1).max(200),
  scenario: z.string().max(2000).optional(), // context / preconditions (given)
  steps: z.string().max(4000).optional(), // steps to execute (when)
  expected: z.string().min(1).max(2000), // expected result (then)
});

// Update: edit the case and/or record an execution result.
export const updateTestCaseSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  scenario: z.string().max(2000).nullable().optional(),
  steps: z.string().max(4000).nullable().optional(),
  expected: z.string().min(1).max(2000).optional(),
  actual: z.string().max(2000).nullable().optional(),
  status: z.enum(UAT_STATUSES).optional(),
  testerName: z.string().max(120).nullable().optional(),
  executedAt: z.coerce.date().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type CreateTestCaseInput = z.infer<typeof createTestCaseSchema>;
export type UpdateTestCaseInput = z.infer<typeof updateTestCaseSchema>;
