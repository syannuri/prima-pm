import { prisma } from '../../lib/prisma.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import type { CreateFieldDefInput, UpdateFieldDefInput, SetValuesInput } from './customField.schemas.js';

// tenantId is NOT NULL on these models. The tenant extension also stamps it on create under a tenant
// context, but the generated Prisma types still require it, so we read it from the active context (as
// ProjectEmbedding does). Every route that reaches these writes runs under an authenticated tenant.
function tenantId(): string {
  const id = getTenantStore()?.tenantId;
  if (!id) throw BadRequest('No active workspace context');
  return id;
}

// Custom fields (Tier-3). Workspace admins define fields per entity ("project" | "task"); values are
// stored per entity instance and (de)serialized as text. Everything here runs under the active tenant
// context, so the Prisma tenant extension scopes reads and stamps tenantId on writes automatically.

type FieldType = 'text' | 'number' | 'date' | 'boolean' | 'select';

export interface FieldDefDto {
  id: string;
  entity: string;
  key: string;
  label: string;
  type: string;
  options: string[] | null;
  required: boolean;
  sortOrder: number;
  archived: boolean;
}

// A definition paired with its current value for a specific entity instance (what the entity form renders).
export interface FieldWithValue extends FieldDefDto {
  value: string | null;
}

function toDto(d: {
  id: string; entity: string; key: string; label: string; type: string;
  options: unknown; required: boolean; sortOrder: number; archived: boolean;
}): FieldDefDto {
  return {
    id: d.id,
    entity: d.entity,
    key: d.key,
    label: d.label,
    type: d.type,
    options: Array.isArray(d.options) ? (d.options as string[]) : null,
    required: d.required,
    sortOrder: d.sortOrder,
    archived: d.archived,
  };
}

// Turn a label into a stable, storage-friendly key (lowercase, underscores). Uniqueness within the
// (tenant, entity) pair is guaranteed by suffixing a counter if needed.
function slugify(label: string): string {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || 'field';
}

async function uniqueKey(entity: string, label: string): Promise<string> {
  const base = slugify(label);
  const existing = await prisma.customFieldDef.findMany({ where: { entity }, select: { key: true } });
  const taken = new Set(existing.map((e) => e.key));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const k = `${base}_${i}`;
    if (!taken.has(k)) return k;
  }
  return `${base}_${Date.now()}`;
}

// Validate + normalize a raw value against its definition. Returns the string to store, or null to clear.
function coerceValue(def: { label: string; type: string; required: boolean; options: unknown }, raw: string | null): string | null {
  if (raw == null || raw.trim() === '') {
    if (def.required) throw BadRequest(`"${def.label}" is required`);
    return null;
  }
  const v = raw.trim();
  const type = def.type as FieldType;
  switch (type) {
    case 'number':
      if (!Number.isFinite(Number(v))) throw BadRequest(`"${def.label}" must be a number`);
      return v;
    case 'date':
      if (Number.isNaN(Date.parse(v))) throw BadRequest(`"${def.label}" must be a valid date`);
      return v;
    case 'boolean':
      if (v !== 'true' && v !== 'false') throw BadRequest(`"${def.label}" must be true or false`);
      return v;
    case 'select': {
      const opts = Array.isArray(def.options) ? (def.options as string[]) : [];
      if (!opts.includes(v)) throw BadRequest(`"${def.label}" must be one of: ${opts.join(', ')}`);
      return v;
    }
    default:
      return v; // text
  }
}

// select fields must carry a non-empty option list; other types must not.
function normalizeOptions(type: string, options: string[] | null | undefined): string[] | null {
  if (type === 'select') {
    const opts = (options ?? []).map((o) => o.trim()).filter(Boolean);
    if (opts.length === 0) throw BadRequest('A "select" field needs at least one option');
    return [...new Set(opts)];
  }
  return null;
}

// ---- Definitions (ADMIN) -------------------------------------------------------------------------

export async function listDefs(entity: string, opts: { includeArchived?: boolean } = {}): Promise<FieldDefDto[]> {
  const rows = await prisma.customFieldDef.findMany({
    where: { entity, ...(opts.includeArchived ? {} : { archived: false }) },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toDto);
}

export async function createDef(input: CreateFieldDefInput): Promise<FieldDefDto> {
  const options = normalizeOptions(input.type, input.options);
  const key = await uniqueKey(input.entity, input.label);
  const row = await prisma.customFieldDef.create({
    data: {
      tenantId: tenantId(),
      entity: input.entity,
      key,
      label: input.label,
      type: input.type,
      options: options ?? undefined,
      required: input.required ?? false,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  return toDto(row);
}

export async function updateDef(id: string, input: UpdateFieldDefInput): Promise<FieldDefDto> {
  const existing = await prisma.customFieldDef.findUnique({ where: { id } });
  if (!existing) throw NotFound('Custom field not found');
  const nextType = input.type ?? existing.type;
  // Recompute options when either the type or the options change so a select always has choices and a
  // non-select never carries stale ones.
  const options =
    input.type !== undefined || input.options !== undefined
      ? normalizeOptions(nextType, input.options === undefined ? (existing.options as string[] | null) : input.options)
      : undefined;
  const row = await prisma.customFieldDef.update({
    where: { id },
    data: {
      label: input.label,
      type: input.type,
      options: options === undefined ? undefined : options ?? undefined,
      required: input.required,
      sortOrder: input.sortOrder,
      archived: input.archived,
    },
  });
  return toDto(row);
}

export async function deleteDef(id: string): Promise<void> {
  const existing = await prisma.customFieldDef.findUnique({ where: { id } });
  if (!existing) throw NotFound('Custom field not found');
  await prisma.customFieldDef.delete({ where: { id } }); // values cascade
}

// ---- Values (per entity instance) ----------------------------------------------------------------

// The active (non-archived) definitions for an entity, each paired with the current value for this
// specific instance — the shape the entity form binds to.
export async function getValues(entity: string, entityId: string): Promise<FieldWithValue[]> {
  const defs = await prisma.customFieldDef.findMany({
    where: { entity, archived: false },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  if (defs.length === 0) return [];
  const values = await prisma.customFieldValue.findMany({
    where: { entityId, defId: { in: defs.map((d) => d.id) } },
    select: { defId: true, value: true },
  });
  const byDef = new Map(values.map((v) => [v.defId, v.value]));
  return defs.map((d) => ({ ...toDto(d), value: byDef.get(d.id) ?? null }));
}

// Set (upsert/clear) values for an entity instance. Only definitions belonging to `entity` are accepted;
// each value is validated against its definition. Uses explicit create/update/delete (no upsert) so the
// tenant extension scopes every write cleanly.
export async function setValues(entity: string, entityId: string, input: SetValuesInput): Promise<FieldWithValue[]> {
  const defs = await prisma.customFieldDef.findMany({ where: { entity, archived: false } });
  const defById = new Map(defs.map((d) => [d.id, d]));
  const existing = await prisma.customFieldValue.findMany({
    where: { entityId, defId: { in: defs.map((d) => d.id) } },
    select: { id: true, defId: true },
  });
  const rowByDef = new Map(existing.map((e) => [e.defId, e.id]));

  for (const item of input.values) {
    const def = defById.get(item.defId);
    if (!def) throw BadRequest('Unknown or archived custom field for this entity');
    const coerced = coerceValue(def, item.value);
    const rowId = rowByDef.get(item.defId);
    if (coerced == null) {
      if (rowId) await prisma.customFieldValue.delete({ where: { id: rowId } });
    } else if (rowId) {
      await prisma.customFieldValue.update({ where: { id: rowId }, data: { value: coerced } });
    } else {
      await prisma.customFieldValue.create({ data: { tenantId: tenantId(), defId: def.id, entityId, value: coerced } });
    }
  }
  return getValues(entity, entityId);
}
