import { z } from 'zod';

// Every non-MANPOWER direct type is priced as "material" (qty × unit cost).
export const MATERIAL_TYPES = [
  'TECHNOLOGY_ONPREM',
  'TECHNOLOGY_CLOUD',
  'HARDWARE_LICENSE',
  'SOFTWARE_LICENSE',
  'SUBCONTRACTOR',
  'TRAINING_CERTIFICATION',
  'SUPPORT_MAINTENANCE',
  'HARDWARE_EQUIPMENT',
  'OTHER',
] as const;

export const DIRECT_TYPES = [...MATERIAL_TYPES, 'MANPOWER'] as const;
export const INDIRECT_TYPES = [
  'TRANSPORTATION',
  'ACCOMMODATION',
  'ENTERTAINMENT',
  'MEALS_PERDIEM',
  'COMMUNICATION',
  'OFFICE_SUPPLIES',
  'MEETING_VENUE',
  'OTHER',
] as const;
export const PERSONNEL_ROLES = ['PM', 'PROJECT_PERSONNEL'] as const;

// One schema for all direct lines; conditional requirements enforced via superRefine.
export const directLineSchema = z
  .object({
    type: z.enum(DIRECT_TYPES),
    // Optional: a manpower line may inherit its label from the chosen resource.
    label: z.string().max(200).optional(),
    // Free-text classification, required when type = OTHER (e.g. "Insurance").
    subCategory: z.string().max(120).optional(),

    // Material fields
    qty: z.coerce.number().positive().optional(),
    unitCost: z.coerce.number().nonnegative().optional(),

    // Manpower fields
    personnelRole: z.enum(PERSONNEL_ROLES).optional(),
    resourceId: z.string().uuid().optional(), // master resource pool (preferred)
    resourceUserId: z.string().uuid().optional(), // legacy: link to a user account
    rateCardId: z.string().uuid().optional(),
    unitCostPerManday: z.coerce.number().nonnegative().optional(),
    planMandays: z.coerce.number().nonnegative().optional(),
    taskId: z.string().uuid().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.type === 'MANPOWER') {
      if (d.planMandays === undefined)
        ctx.addIssue({ code: 'custom', path: ['planMandays'], message: 'Required for manpower' });
      // With a pooled resource the server fills role, rate & label; else they're required.
      if (!d.resourceId) {
        if (!d.label)
          ctx.addIssue({ code: 'custom', path: ['label'], message: 'Required' });
        if (!d.personnelRole)
          ctx.addIssue({ code: 'custom', path: ['personnelRole'], message: 'Required for manpower' });
        if (d.unitCostPerManday === undefined)
          ctx.addIssue({ code: 'custom', path: ['unitCostPerManday'], message: 'Required for manpower' });
      }
    } else {
      if (!d.label)
        ctx.addIssue({ code: 'custom', path: ['label'], message: 'Required' });
      // Material line
      if (d.qty === undefined)
        ctx.addIssue({ code: 'custom', path: ['qty'], message: 'Required for material' });
      if (d.unitCost === undefined)
        ctx.addIssue({ code: 'custom', path: ['unitCost'], message: 'Required for material' });
      if (d.type === 'OTHER' && !d.subCategory?.trim())
        ctx.addIssue({ code: 'custom', path: ['subCategory'], message: 'Specify the category for "Other"' });
    }
  });

export const indirectLineSchema = z
  .object({
    type: z.enum(INDIRECT_TYPES),
    description: z.string().min(1).max(300),
    // Free-text classification, required when type = OTHER.
    subCategory: z.string().max(120).optional(),
    amount: z.coerce.number().nonnegative(),
  })
  .superRefine((d, ctx) => {
    if (d.type === 'OTHER' && !d.subCategory?.trim())
      ctx.addIssue({ code: 'custom', path: ['subCategory'], message: 'Specify the category for "Other"' });
  });

export const managementReserveSchema = z.object({
  managementReserve: z.coerce.number().nonnegative(),
});

export const actualCostSchema = z
  .object({
    date: z.coerce.date(),
    amount: z.coerce.number().positive(),
    description: z.string().max(300).optional(),
    // Which budget this spend draws down. Defaults to DIRECT when omitted.
    category: z.enum(['DIRECT', 'INDIRECT']).optional(),
    // Optional per-component attribution: bill this spend to one budget line. At most one
    // may be set; the drawn-down category is then derived from which line was picked.
    directLineId: z.string().uuid().optional(),
    indirectLineId: z.string().uuid().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.directLineId && d.indirectLineId)
      ctx.addIssue({ code: 'custom', path: ['indirectLineId'], message: 'Attribute to a direct OR an indirect line, not both' });
  });

export const autoPostLabourSchema = z.object({
  enabled: z.boolean(),
});

export type ActualCostInput = z.infer<typeof actualCostSchema>;

export type DirectLineInput = z.infer<typeof directLineSchema>;
export type IndirectLineInput = z.infer<typeof indirectLineSchema>;
