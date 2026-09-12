import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { listProjects } from '../projects/projects.service.js';
import { formatIdrHuman } from '../../lib/citationCheck.js';

// Natural-language data query engine for Anett (see docs/AI-NL-QUERY-PLAN.md). The AI emits a
// STRUCTURED spec (never SQL); this validates it against a per-entity whitelist and runs it
// deterministically over the caller's ACCESSIBLE set. Read-only, no AI in the data path.

export type QueryEntity = 'projects' | 'tasks';
export type QueryOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';
export interface QueryFilter { field: string; op: QueryOp; value: unknown }
export interface QuerySpec {
  entity: QueryEntity;
  filters?: QueryFilter[];
  sort?: { field: string; dir: 'asc' | 'desc' };
  limit?: number;
  columns?: string[];
}
export interface QueryColumn { key: string; label: string }
export interface QueryTable {
  entity: QueryEntity;
  columns: QueryColumn[];
  rows: Record<string, string | number | boolean | null>[];
  total: number;
  limit: number;
  // Server-computed sums (in raw IDR) of money columns over ALL matching rows — so the model quotes an
  // exact total instead of hand-summing/rescaling rupiah (a recurring source of Juta/Miliar/Triliun slips).
  sums?: Record<string, number>;
  // Same sums pre-rendered as ready-to-quote Indonesian strings ("Rp 6,8 miliar") — quote VERBATIM. The
  // model must NOT convert the raw `sums` integers to miliar/juta itself (that hand-scaling slips 1000×).
  sumsText?: Record<string, string>;
}

// Columns whose sum is a meaningful money total. Others (spi/cpi/%/counts) are not summed.
const MONEY_FIELDS = new Set(['bac', 'ev', 'ac']);

type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'enum';
interface FieldDef { type: FieldType; label: string }

const PROJECT_FIELDS: Record<string, FieldDef> = {
  code: { type: 'string', label: 'Code' },
  name: { type: 'string', label: 'Name' },
  status: { type: 'enum', label: 'Status' },
  pm: { type: 'string', label: 'PM' },
  approach: { type: 'enum', label: 'Approach' },
  bac: { type: 'number', label: 'BAC' },
  ev: { type: 'number', label: 'EV' },
  ac: { type: 'number', label: 'AC' },
  spi: { type: 'number', label: 'SPI' },
  cpi: { type: 'number', label: 'CPI' },
  percentComplete: { type: 'number', label: '% Complete' },
  overdueTasks: { type: 'number', label: 'Overdue tasks' },
  openRisks: { type: 'number', label: 'Open risks' },
  pendingCRs: { type: 'number', label: 'Pending CRs' },
};
const TASK_FIELDS: Record<string, FieldDef> = {
  project: { type: 'string', label: 'Project' },
  wbs: { type: 'string', label: 'WBS' },
  name: { type: 'string', label: 'Task' },
  pct: { type: 'number', label: '% Progress' },
  planEnd: { type: 'date', label: 'Due' },
  overdue: { type: 'boolean', label: 'Overdue' },
  milestone: { type: 'boolean', label: 'Milestone' },
  owner: { type: 'string', label: 'Owner' },
  status: { type: 'enum', label: 'Status' },
};
const ENTITY_FIELDS: Record<QueryEntity, Record<string, FieldDef>> = { projects: PROJECT_FIELDS, tasks: TASK_FIELDS };
const DEFAULT_COLUMNS: Record<QueryEntity, string[]> = {
  projects: ['code', 'name', 'status', 'pm', 'spi', 'cpi', 'bac', 'overdueTasks'],
  tasks: ['project', 'wbs', 'name', 'pct', 'planEnd', 'overdue', 'owner'],
};
const OPS_BY_TYPE: Record<FieldType, QueryOp[]> = {
  string: ['eq', 'ne', 'contains', 'in'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'],
  boolean: ['eq', 'ne'],
  date: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'],
  enum: ['eq', 'ne', 'in'],
};
const MAX_LIMIT = 200;

// A short, model-facing description of what can be queried — folded into the tool description so
// Anett builds valid specs without guessing field names.
export function queryCatalog(): string {
  const fmt = (fields: Record<string, FieldDef>) => Object.entries(fields).map(([k, d]) => `${k}(${d.type})`).join(', ');
  return `projects: ${fmt(PROJECT_FIELDS)} | tasks: ${fmt(TASK_FIELDS)}`;
}

function coerce(type: FieldType, op: QueryOp, value: unknown): unknown {
  if (op === 'in') {
    if (!Array.isArray(value)) throw new AppError(400, 'Nilai operator "in" harus berupa array.', 'QUERY_INVALID');
    return value.map((v) => coerceScalar(type, v));
  }
  return coerceScalar(type, value);
}
function coerceScalar(type: FieldType, value: unknown): string | number | boolean | Date {
  if (type === 'number') { const n = Number(value); if (Number.isNaN(n)) throw new AppError(400, `Nilai numerik tidak valid: ${String(value)}.`, 'QUERY_INVALID'); return n; }
  if (type === 'boolean') return value === true || value === 'true' || value === 1 || value === '1';
  if (type === 'date') { const d = new Date(String(value)); if (Number.isNaN(d.getTime())) throw new AppError(400, `Tanggal tidak valid: ${String(value)}.`, 'QUERY_INVALID'); return d; }
  return String(value);
}

interface NormFilter { field: string; op: QueryOp; type: FieldType; value: unknown }
interface NormSpec { entity: QueryEntity; filters: NormFilter[]; sort?: { field: string; dir: 'asc' | 'desc' }; limit: number; columns: string[] }

export function validateSpec(spec: QuerySpec): NormSpec {
  const entity = spec.entity;
  const fields = ENTITY_FIELDS[entity];
  if (!fields) throw new AppError(400, `Entity tidak dikenal: ${String(entity)}. Pilih: projects, tasks.`, 'QUERY_INVALID');
  const filters: NormFilter[] = (spec.filters ?? []).map((f) => {
    const def = fields[f.field];
    if (!def) throw new AppError(400, `Field "${f.field}" tidak ada di ${entity}.`, 'QUERY_INVALID');
    if (!OPS_BY_TYPE[def.type].includes(f.op)) throw new AppError(400, `Operator "${f.op}" tidak berlaku untuk ${f.field}.`, 'QUERY_INVALID');
    return { field: f.field, op: f.op, type: def.type, value: coerce(def.type, f.op, f.value) };
  });
  let sort: NormSpec['sort'];
  if (spec.sort) {
    if (!fields[spec.sort.field]) throw new AppError(400, `Tidak bisa mengurutkan by "${spec.sort.field}".`, 'QUERY_INVALID');
    sort = { field: spec.sort.field, dir: spec.sort.dir === 'asc' ? 'asc' : 'desc' };
  }
  const columns = (spec.columns?.length ? spec.columns : DEFAULT_COLUMNS[entity]).filter((c) => fields[c]);
  const limit = Math.min(Math.max(1, Math.floor(spec.limit ?? 50)), MAX_LIMIT);
  return { entity, filters, sort, limit, columns: columns.length ? columns : DEFAULT_COLUMNS[entity] };
}

type Row = Record<string, string | number | boolean | Date | null>;

function matches(row: Row, f: NormFilter): boolean {
  const cell = row[f.field];
  if (f.op === 'in') return Array.isArray(f.value) && f.value.some((v) => equalish(cell, v, f.type));
  if (f.op === 'eq') return equalish(cell, f.value, f.type);
  if (f.op === 'ne') return !equalish(cell, f.value, f.type);
  if (f.op === 'contains') return cell != null && String(cell).toLowerCase().includes(String(f.value).toLowerCase());
  // ordered comparisons (number/date)
  if (cell == null) return false;
  const a = f.type === 'date' ? new Date(cell as string).getTime() : Number(cell);
  const b = f.type === 'date' ? (f.value as Date).getTime() : Number(f.value);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return f.op === 'gt' ? a > b : f.op === 'gte' ? a >= b : f.op === 'lt' ? a < b : a <= b;
}
function equalish(cell: unknown, value: unknown, type: FieldType): boolean {
  if (cell == null) return false;
  if (type === 'number') return Number(cell) === Number(value);
  if (type === 'boolean') return Boolean(cell) === Boolean(value);
  if (type === 'date') return new Date(cell as string).getTime() === (value as Date).getTime();
  return String(cell).toLowerCase() === String(value).toLowerCase();
}

async function projectRows(userId: string, role: Role): Promise<Row[]> {
  const projects = await listProjects(userId, role);
  const ids = projects.map((p) => p.id);
  if (!ids.length) return [];
  const now = new Date();
  const [snaps, overdue, risks, crs] = await Promise.all([
    prisma.evmSnapshot.findMany({ where: { projectId: { in: ids } }, orderBy: { statusDate: 'desc' }, select: { projectId: true, ev: true, ac: true, spi: true, cpi: true, weightedProgress: true } }),
    prisma.task.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, progressPct: { lt: 100 }, planEnd: { lt: now } }, _count: { _all: true } }),
    prisma.risk.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, status: { notIn: ['CLOSED', 'OCCURRED'] } }, _count: { _all: true } }),
    prisma.changeRequest.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }, _count: { _all: true } }),
  ]);
  const latest = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (!latest.has(s.projectId)) latest.set(s.projectId, s); // findMany is statusDate desc → first per project is latest
  const cnt = (g: { projectId: string; _count: { _all: number } }[]) => new Map(g.map((x) => [x.projectId, x._count._all]));
  const overdueM = cnt(overdue); const risksM = cnt(risks); const crsM = cnt(crs);
  return projects.map((p) => {
    const s = latest.get(p.id);
    return {
      code: p.code, name: p.name, status: p.status, pm: p.pm?.name ?? null, approach: p.deliveryApproach,
      bac: p.costBaseline?.budgetAtCompletion == null ? null : Number(p.costBaseline.budgetAtCompletion),
      ev: s ? Number(s.ev) : null, ac: s ? Number(s.ac) : null, spi: s ? s.spi : null, cpi: s ? s.cpi : null,
      percentComplete: s ? Math.round(s.weightedProgress * 100) : null,
      overdueTasks: overdueM.get(p.id) ?? 0, openRisks: risksM.get(p.id) ?? 0, pendingCRs: crsM.get(p.id) ?? 0,
    } as Row;
  });
}

async function taskRows(userId: string, role: Role): Promise<Row[]> {
  const projects = await listProjects(userId, role);
  const codeById = new Map(projects.map((p) => [p.id, p.code]));
  const ids = projects.map((p) => p.id);
  if (!ids.length) return [];
  const now = new Date();
  const tasks = await prisma.task.findMany({
    where: { projectId: { in: ids } },
    orderBy: { planEnd: 'asc' },
    take: 5000,
    select: { projectId: true, wbsCode: true, name: true, progressPct: true, planEnd: true, isMilestone: true, picResource: { select: { name: true } } },
  });
  return tasks.map((t) => {
    const overdue = t.progressPct < 100 && t.planEnd < now;
    return {
      project: codeById.get(t.projectId) ?? null, wbs: t.wbsCode, name: t.name, pct: t.progressPct,
      planEnd: t.planEnd, overdue, milestone: t.isMilestone, owner: t.picResource?.name ?? null,
      status: t.progressPct >= 100 ? 'DONE' : overdue ? 'OVERDUE' : 'IN_PROGRESS',
    } as Row;
  });
}

function serialize(v: string | number | boolean | Date | null): string | number | boolean | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v;
}

// Validate + execute a spec, returning a display-ready table scoped to the caller. Throws AppError
// (message the tool relays) on an invalid spec.
export async function runQuery(spec: QuerySpec, userId: string, role: Role): Promise<QueryTable> {
  const norm = validateSpec(spec);
  const fields = ENTITY_FIELDS[norm.entity];
  const all = norm.entity === 'projects' ? await projectRows(userId, role) : await taskRows(userId, role);
  let rows = all.filter((r) => norm.filters.every((f) => matches(r, f)));
  if (norm.sort) {
    const { field, dir } = norm.sort;
    const type = fields[field].type;
    rows = [...rows].sort((a, b) => {
      const av = a[field]; const bv = b[field];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; if (bv == null) return -1; // nulls last
      let c: number;
      if (type === 'number') c = Number(av) - Number(bv);
      else if (type === 'date') c = new Date(av as string).getTime() - new Date(bv as string).getTime();
      else c = String(av).localeCompare(String(bv));
      return dir === 'asc' ? c : -c;
    });
  }
  const total = rows.length;
  const columns = norm.columns.map((k) => ({ key: k, label: fields[k].label }));
  const out = rows.slice(0, norm.limit).map((r) => {
    const o: Record<string, string | number | boolean | null> = {};
    for (const c of columns) o[c.key] = serialize(r[c.key]);
    return o;
  });
  // Sum money columns over ALL matching rows (not just the displayed slice) so the model can quote an
  // exact rupiah total. Only when >1 row matches — a single-row "total" is just that row's value.
  let sums: Record<string, number> | undefined;
  let sumsText: Record<string, string> | undefined;
  if (rows.length > 1) {
    for (const k of norm.columns) {
      if (!MONEY_FIELDS.has(k)) continue;
      const s = rows.reduce((acc, r) => acc + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0);
      (sums ??= {})[k] = s;
      (sumsText ??= {})[k] = formatIdrHuman(s);
    }
  }
  return { entity: norm.entity, columns, rows: out, total, limit: norm.limit, sums, sumsText };
}
