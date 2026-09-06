import { z } from 'zod';

export const FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'select'] as const;
export const FIELD_ENTITIES = ['project', 'task'] as const;

// Create a field definition. `key` is derived server-side from the label (stable slug), so it is not
// accepted here. Options are only meaningful for the "select" type.
export const createFieldDefSchema = z.object({
  entity: z.enum(FIELD_ENTITIES).default('project'),
  label: z.string().trim().min(1).max(80),
  type: z.enum(FIELD_TYPES).default('text'),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const updateFieldDefSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  type: z.enum(FIELD_TYPES).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(50).nullable().optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  archived: z.boolean().optional(),
});

// Bulk set of values for one entity instance. A null/empty value clears that field.
export const setValuesSchema = z.object({
  values: z.array(z.object({
    defId: z.string().min(1),
    value: z.string().max(2000).nullable(),
  })).max(200),
});

export type CreateFieldDefInput = z.infer<typeof createFieldDefSchema>;
export type UpdateFieldDefInput = z.infer<typeof updateFieldDefSchema>;
export type SetValuesInput = z.infer<typeof setValuesSchema>;
