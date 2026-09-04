import { z } from 'zod';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { aiEnabled, getAiPort, aiNotEnabledError } from '../../lib/ai.js';
import { getResourceCapacity } from './resource.service.js';
import { eachBusinessDay, periodKey, type CapacityReport, type Granularity } from './resource.helpers.js';

// =====================================================================
// AI resource-conflict detection + reallocation.
//
// DETECTION is entirely deterministic and reuses the existing capacity engine
// (getResourceCapacity → buildCapacityReport): it already computes, cross-project, per-resource
// per-period over-allocation. Here we (a) attribute each over-period to the manpower lines that
// caused it, (b) find under-loaded peer resources that could take the work, and (c) optionally ask
// the AI to draft a concrete reallocation the PM can approve (Stage C → REASSIGN_MANPOWER).
//
// The AI part is advisory + gated (env key + Tenant.aiNarrativeEnabled). The reassignment itself
// only ever runs via the approval engine, through the existing audited updateDirectLine.
// =====================================================================

const GLOBAL_ROLES: Role[] = ['ADMIN', 'PMO'];
const EPSILON = 1e-6;
const round2 = (n: number) => Math.round((n + EPSILON) * 100) / 100;

// A candidate target must have MORE than this much slack in the over-period (utilization below it).
const CANDIDATE_SLACK = 0.85;
const MAX_CONFLICTS = 30;

export interface Contribution { costItemId: string; taskName: string; projectId: string; projectCode: string; planMandaysInPeriod: number }
export interface Candidate { resourceId: string; name: string; personnelRole: string | null; utilization: number; spareCapacity: number }
export interface Conflict {
  resourceKey: string;
  resourceName: string;
  personnelRole: string | null;
  period: string;
  allocated: number;
  capacity: number;
  utilization: number;
  overBy: number;
  contributions: Contribution[];
  candidates: Candidate[];
}

// Same resource identity the capacity engine uses (master resource > linked user > project+label).
function resourceKeyOf(i: { resourceId: string | null; resourceUserId: string | null; projectId: string; label: string }): string {
  return i.resourceId ? `R:${i.resourceId}` : i.resourceUserId ? `U:${i.resourceUserId}` : `L:${i.projectId}:${i.label}`;
}

// Caller-visible project ids — mirrors getResourceCapacity's role scoping (tenant scope handles orgs).
async function callerProjectIds(userId: string, role: string): Promise<string[]> {
  const where: Prisma.ProjectWhereInput = { deletedAt: null };
  if (role !== 'GUEST' && !GLOBAL_ROLES.includes(role as Role)) where.pmUserId = userId;
  const projects = await prisma.project.findMany({ where, select: { id: true } });
  return projects.map((p) => p.id);
}

// PURE: given the capacity report + the manpower lines' per-(resourceKey,period) contributions,
// bundle every over-allocated resource-period into a Conflict with its contributions + candidate
// peers. Unit-tested without a DB.
export function bundleConflicts(report: CapacityReport, contribByKeyPeriod: Map<string, Contribution[]>): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const r of report.resources) {
    if (!r.overAllocated) continue;
    for (const cell of r.cells) {
      if (!cell.over) continue;
      const contributions = (contribByKeyPeriod.get(`${r.key}|${cell.period}`) ?? [])
        .slice()
        .sort((a, b) => b.planMandaysInPeriod - a.planMandaysInPeriod)
        .slice(0, 8);
      // Under-loaded, reassignable peers (real master resources → a usable toResourceId) in the
      // SAME period; prefer the same personnel role, then most spare capacity.
      const candidates: Candidate[] = report.resources
        .filter((c) => c.key !== r.key && c.key.startsWith('R:'))
        .map((c) => ({ c, cell: c.cells.find((x) => x.period === cell.period) }))
        .filter((x): x is { c: typeof x.c; cell: NonNullable<typeof x.cell> } => !!x.cell && x.cell.utilization < CANDIDATE_SLACK)
        .map((x) => ({
          resourceId: x.c.key.slice(2),
          name: x.c.name,
          personnelRole: x.c.personnelRole,
          utilization: x.cell.utilization,
          spareCapacity: round2(x.cell.capacity - x.cell.allocated),
        }))
        .sort((a, b) =>
          Number(b.personnelRole === r.personnelRole) - Number(a.personnelRole === r.personnelRole) ||
          b.spareCapacity - a.spareCapacity)
        .slice(0, 5);
      conflicts.push({
        resourceKey: r.key, resourceName: r.name, personnelRole: r.personnelRole,
        period: cell.period, allocated: cell.allocated, capacity: cell.capacity, utilization: cell.utilization,
        overBy: round2(cell.allocated - cell.capacity),
        contributions, candidates,
      });
    }
  }
  // Worst overrun first; cap the volume.
  return conflicts.sort((a, b) => b.overBy - a.overBy).slice(0, MAX_CONFLICTS);
}

// Detect resource over-allocation conflicts for the caller's visible projects.
export async function detectConflicts(userId: string, role: string, q: { from?: Date; to?: Date; granularity?: Granularity }): Promise<Conflict[]> {
  const report = await getResourceCapacity(userId, role, q);
  const projectIds = await callerProjectIds(userId, role);
  if (!projectIds.length) return [];

  const lines = await prisma.costItemDirect.findMany({
    where: { type: 'MANPOWER', projectId: { in: projectIds }, planMandays: { gt: 0 }, taskId: { not: null } },
    select: {
      id: true, label: true, planMandays: true, resourceId: true, resourceUserId: true,
      projectId: true, project: { select: { code: true } },
      task: { select: { name: true, planStart: true, planEnd: true } },
    },
  });

  // Attribute each line's man-days to (resourceKey, period): rate × the line's business days in that
  // period — identical time-phasing to buildCapacityReport, so contributions reconcile with the cells.
  const contribByKeyPeriod = new Map<string, Contribution[]>();
  const gran = q.granularity ?? report.granularity;
  for (const l of lines) {
    if (!l.task?.planStart || !l.task?.planEnd) continue;
    const days = eachBusinessDay(l.task.planStart, l.task.planEnd);
    if (!days.length) continue;
    const rate = Number(l.planMandays) / days.length;
    const perPeriod = new Map<string, number>();
    for (const d of days) { const k = periodKey(d, gran); perPeriod.set(k, (perPeriod.get(k) ?? 0) + rate); }
    const key = resourceKeyOf(l);
    for (const [period, mandays] of perPeriod) {
      const bucket = `${key}|${period}`;
      const arr = contribByKeyPeriod.get(bucket) ?? contribByKeyPeriod.set(bucket, []).get(bucket)!;
      arr.push({ costItemId: l.id, taskName: l.task.name, projectId: l.projectId, projectCode: l.project.code, planMandaysInPeriod: round2(mandays) });
    }
  }

  return bundleConflicts(report, contribByKeyPeriod);
}

// --- AI advisory draft --------------------------------------------------------------------------

export const ReallocationSchema = z.object({
  summary: z.string(),
  moves: z.array(z.object({
    costItemId: z.string(),
    toResourceId: z.string(),
    toResourceName: z.string(),
    taskName: z.string(),
    fromResourceName: z.string(),
    projectId: z.string(),
    rationale: z.string(),
  })),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
});
export type ReallocationDraft = z.infer<typeof ReallocationSchema>;

const REALLOC_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    moves: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          costItemId: { type: 'string' }, toResourceId: { type: 'string' }, toResourceName: { type: 'string' },
          taskName: { type: 'string' }, fromResourceName: { type: 'string' }, projectId: { type: 'string' }, rationale: { type: 'string' },
        },
        required: ['costItemId', 'toResourceId', 'toResourceName', 'taskName', 'fromResourceName', 'projectId', 'rationale'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
  },
  required: ['summary', 'moves'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  'Anda adalah seorang manajer sumber daya (resource manager) PMO. Sebuah resource kelebihan beban (over-allocated) pada satu periode, dan Anda menyarankan realokasi konkret.',
  'Tulis dalam Bahasa Indonesia manajemen proyek yang natural & ringkas.',
  '',
  'ATURAN GROUNDING (WAJIB):',
  '- HANYA usulkan pemindahan yang memakai costItemId dari daftar "contributions" dan toResourceId dari daftar "candidates" pada payload. Jangan mengarang id, nama, atau angka.',
  '- Pindahkan cukup beban agar over-allocation mereda; hindari membuat kandidat penerima jadi kelebihan beban.',
  '- Utamakan penerima dengan peran (personnelRole) yang sama dan kapasitas sisa (spareCapacity) paling besar.',
  '- Bila tak ada kandidat yang layak, kembalikan moves kosong dan jelaskan singkat di summary (mis. sarankan menggeser jadwal atau menambah kapasitas).',
  '',
  'Hasilkan: summary (1-2 kalimat kondisi & rekomendasi), moves[] (pemindahan konkret + rationale singkat per move), confidence.',
].join('\n');

// PURE: builds the {system,user} pair for a single conflict. Unit-testable.
export function buildReallocationPrompt(conflict: Conflict): { system: string; user: string } {
  return { system: SYSTEM_PROMPT, user: JSON.stringify(conflict) };
}

// Tenant advisory opt-in (reuses Tenant.aiNarrativeEnabled). Applies only when a tenant exists.
async function assertAdvisoryOptedIn(): Promise<void> {
  const tid = getTenantStore()?.tenantId;
  if (!tid) return; // personal/guest workspace — no tenant gate
  const t = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiNarrativeEnabled: true } });
  if (t?.aiNarrativeEnabled !== true) throw aiNotEnabledError();
}

// Whether the advisory AI is usable for the caller (env + tenant opt-in) — drives client show/hide.
export async function reallocationAiAvailable(): Promise<boolean> {
  if (!aiEnabled()) return false;
  const tid = getTenantStore()?.tenantId;
  if (!tid) return true;
  const t = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiNarrativeEnabled: true } });
  return t?.aiNarrativeEnabled === true;
}

// Draft a reallocation for one conflict. Assumes the route already checked the env gate (503).
// Post-validates against the conflict so hallucinated ids are dropped (grounding guard).
export async function draftReallocation(conflict: Conflict): Promise<ReallocationDraft> {
  await assertAdvisoryOptedIn();
  const { system, user } = buildReallocationPrompt(conflict);
  const raw = await getAiPort().draftJson({ system, user, jsonSchema: REALLOC_JSON_SCHEMA, maxTokens: 1200, feature: 'resource_realloc' });
  const parsed = raw == null ? null : ReallocationSchema.safeParse(raw);
  if (!parsed || !parsed.success) {
    throw new AppError(502, 'AI tidak dapat menyusun realokasi saat ini. Silakan atur ulang secara manual.', 'AI_UNAVAILABLE');
  }
  const validCostItems = new Set(conflict.contributions.map((c) => c.costItemId));
  const validTargets = new Set(conflict.candidates.map((c) => c.resourceId));
  return {
    ...parsed.data,
    moves: parsed.data.moves.filter((m) => validCostItems.has(m.costItemId) && validTargets.has(m.toResourceId)),
  };
}
