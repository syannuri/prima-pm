import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, Forbidden, NotFound } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { getAiPort } from '../../lib/ai.js';
import { getProjectForecast, eacScenarios } from './forecast.service.js';
import {
  autoSchedule, computeCpm, workingDaysBetween, addWorkingDays,
  type CpmDepType, type CpmEdgeInput, type AutoScheduleMode,
} from '../schedule/schedule.helpers.js';

// =====================================================================
// What-if scenario simulator — deterministic, ZERO DB writes.
//
// Re-runs the EXISTING pure engines (autoSchedule + computeCpm for the schedule/critical path;
// eacScenarios for cost) against an in-memory copy of the project with a whitelisted set of changes
// applied, then reports the before/after delta. Nothing is persisted. The AI layer (Phase 2) only
// translates a natural-language question into this bounded spec and narrates the computed numbers.
// =====================================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const floorDayMs = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

// All inputs bounded to keep the pure engines cheap (event-loop DoS guard, mirrors the scheduler).
export const WhatIfSpecSchema = z.object({
  taskChanges: z.array(z.object({
    taskId: z.string().uuid(),
    shiftDays: z.number().int().min(-3650).max(3650).optional(),      // move start+end by N calendar days
    durationScale: z.number().min(0.1).max(5).optional(),            // resize duration (0.7 = 30% shorter)
    newDurationDays: z.number().int().min(0).max(3650).optional(),   // set an explicit working-day duration
  })).max(50).optional(),
  assumeSpi: z.number().min(0.1).max(3).optional(),                   // go-forward schedule performance
  assumeCpi: z.number().min(0.1).max(3).optional(),                   // go-forward cost performance
  bacDeltaIdr: z.number().min(-1e15).max(1e15).optional(),           // add/remove budget
  mode: z.enum(['push', 'asap']).optional(),
});
export type WhatIfSpec = z.infer<typeof WhatIfSpecSchema>;

export interface Leaf { id: string; name: string; planStart: Date; planEnd: Date }
interface Metrics { bac: number; ev: number; ac: number; spi: number; cpi: number }

export interface WhatIfResult {
  baseline: { finish: string; forecastFinish: string; eac: number; vac: number; spi: number; cpi: number; bac: number };
  scenario: { finish: string; forecastFinish: string; eac: number; vac: number; spi: number; cpi: number; bac: number; movedTaskCount: number; criticalTaskCount: number };
  deltas: { finishDays: number; forecastFinishDays: number; eacIdr: number; vacIdr: number };
  applied: { taskChanges: { taskId: string; name: string; shiftDays?: number; durationScale?: number; newDurationDays?: number }[]; assumeSpi: number | null; assumeCpi: number | null; bacDeltaIdr: number; mode: AutoScheduleMode };
  notes: string[];
}

// SPI-stretched forecast finish: planned duration divided by schedule performance.
const forecastFinishMs = (startMs: number, finishMs: number, spi: number) =>
  spi > 0 ? Math.round(startMs + (finishMs - startMs) / spi) : finishMs;

// PURE: apply a scenario to in-memory leaves+edges+baseline metrics and compute the before/after.
// No IO — unit-tested directly.
export function applyScenario(leaves: Leaf[], edges: CpmEdgeInput[], m: Metrics, spec: WhatIfSpec): WhatIfResult {
  const byId = new Map(leaves.map((l) => [l.id, l]));
  const changes = (spec.taskChanges ?? []).filter((c) => byId.has(c.taskId));

  // No scheduled tasks → only the cost levers apply; anchor dates to today so date math stays finite.
  const baseStart = leaves.length ? Math.min(...leaves.map((l) => +l.planStart)) : floorDayMs(Date.now());
  const baseFinish = leaves.length ? Math.max(...leaves.map((l) => +l.planEnd)) : baseStart;
  const baseFF = forecastFinishMs(baseStart, baseFinish, m.spi || 1);
  const baseEac = eacScenarios(m.bac, m.ev, m.ac, m.cpi, m.spi).likely;
  const baseVac = m.bac - baseEac;

  // Apply task changes in memory.
  const changeById = new Map(changes.map((c) => [c.taskId, c]));
  const mutated = leaves.map((l) => {
    const ch = changeById.get(l.id);
    let s = +l.planStart, e = +l.planEnd;
    if (ch) {
      if (ch.shiftDays) { s += ch.shiftDays * DAY_MS; e += ch.shiftDays * DAY_MS; }
      if (ch.newDurationDays != null) e = addWorkingDays(floorDayMs(s), ch.newDurationDays);
      else if (ch.durationScale != null) e = addWorkingDays(floorDayMs(s), Math.max(0, Math.round(workingDaysBetween(s, e) * ch.durationScale)));
    }
    return { id: l.id, planStart: new Date(s), planEnd: new Date(e) };
  });

  const sched = autoSchedule(mutated, edges, spec.mode ?? 'push');
  const ends = Object.values(sched.tasks).map((t) => t.end);
  const starts = Object.values(sched.tasks).map((t) => t.start);
  const scStart = starts.length ? Math.min(...starts) : baseStart;
  const scFinish = ends.length ? Math.max(...ends) : baseFinish;

  const assumeSpi = spec.assumeSpi ?? (m.spi || 1);
  const assumeCpi = spec.assumeCpi ?? (m.cpi || 1);
  const scBac = m.bac + (spec.bacDeltaIdr ?? 0);
  const scFF = forecastFinishMs(scStart, scFinish, assumeSpi);
  const scEac = eacScenarios(scBac, m.ev, m.ac, assumeCpi, assumeSpi).likely;
  const scVac = scBac - scEac;

  const cpm = computeCpm(mutated.map((t) => ({ id: t.id, duration: workingDaysBetween(+t.planStart, +t.planEnd) })), edges);

  const notes: string[] = [];
  if (sched.cyclic) notes.push('A dependency cycle was detected — schedule dates were left unchanged.');
  if (edges.length === 0 && changes.length > 0) notes.push('This project has no task dependencies, so only the edited tasks move — there is no downstream propagation.');
  if (changes.some((c) => c.durationScale != null || c.newDurationDays != null)) notes.push('Durations are treated as given: the schedule is date-driven, not auto-levelled from resource capacity, so a headcount change must be expressed as an explicit duration change.');

  const round = (n: number) => Math.round(n);
  return {
    baseline: { finish: new Date(baseFinish).toISOString(), forecastFinish: new Date(baseFF).toISOString(), eac: baseEac, vac: baseVac, spi: m.spi, cpi: m.cpi, bac: m.bac },
    scenario: { finish: new Date(scFinish).toISOString(), forecastFinish: new Date(scFF).toISOString(), eac: scEac, vac: scVac, spi: assumeSpi, cpi: assumeCpi, bac: scBac, movedTaskCount: sched.moved.length, criticalTaskCount: cpm.criticalTaskIds.length },
    deltas: { finishDays: round((scFinish - baseFinish) / DAY_MS), forecastFinishDays: round((scFF - baseFF) / DAY_MS), eacIdr: round(scEac - baseEac), vacIdr: round(scVac - baseVac) },
    applied: {
      taskChanges: changes.map((c) => ({ taskId: c.taskId, name: byId.get(c.taskId)!.name, shiftDays: c.shiftDays, durationScale: c.durationScale, newDurationDays: c.newDurationDays })),
      assumeSpi: spec.assumeSpi ?? null, assumeCpi: spec.assumeCpi ?? null, bacDeltaIdr: spec.bacDeltaIdr ?? 0, mode: spec.mode ?? 'push',
    },
    notes,
  };
}

// Load the project's leaf tasks + dependencies + baseline metrics, then simulate. Read-only.
export async function simulateScenario(projectId: string, spec: WhatIfSpec): Promise<WhatIfResult> {
  const [tasks, deps, forecast] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, select: { id: true, parentTaskId: true, name: true, planStart: true, planEnd: true } }),
    prisma.taskDependency.findMany({ where: { predecessor: { projectId } }, select: { predecessorId: true, successorId: true, type: true, lagDays: true } }),
    getProjectForecast(projectId, new Date()),
  ]);
  // Only leaf tasks carry real dates (parents roll up) — same rule as applyAutoSchedule.
  const parentIds = new Set(tasks.map((t) => t.parentTaskId).filter(Boolean) as string[]);
  const leaves: Leaf[] = tasks.filter((t) => !parentIds.has(t.id)).map((t) => ({ id: t.id, name: t.name, planStart: t.planStart, planEnd: t.planEnd }));
  const edges: CpmEdgeInput[] = deps.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId, type: d.type as CpmDepType, lagDays: d.lagDays }));

  const m: Metrics = { bac: forecast.bac, ev: forecast.ev, ac: forecast.ac, spi: forecast.spi || 1, cpi: forecast.cpi || 1 };
  return applyScenario(leaves, edges, m, spec);
}

// Leaf-task tree for grounding the AI's NL→spec translation (Phase 2). Working-day durations so the
// model can reason about "add people / compress" as a duration change.
export async function whatIfContext(projectId: string) {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: { id: true, parentTaskId: true, wbsCode: true, name: true, planStart: true, planEnd: true },
    orderBy: { sortOrder: 'asc' },
  });
  const parentIds = new Set(tasks.map((t) => t.parentTaskId).filter(Boolean) as string[]);
  const nameById = new Map(tasks.map((t) => [t.id, t.name]));
  return tasks.filter((t) => !parentIds.has(t.id)).map((t) => ({
    taskId: t.id, wbs: t.wbsCode, name: t.name,
    phase: t.parentTaskId ? nameById.get(t.parentTaskId) ?? null : null,
    start: t.planStart.toISOString().slice(0, 10), end: t.planEnd.toISOString().slice(0, 10),
    durationWorkingDays: workingDaysBetween(+t.planStart, +t.planEnd),
  }));
}

// =====================================================================
// AI layer — translate a natural-language question into a bounded spec, run the deterministic
// simulation, then narrate the computed trade-off. Advisory + gated (env + Tenant.aiNarrativeEnabled),
// mirrors evmExplain.service. Two draftJson calls: NL→spec, then narrate the real numbers.
// =====================================================================

const WHATIF_SPEC_JSON_SCHEMA = {
  type: 'object',
  properties: {
    taskChanges: {
      type: 'array',
      items: {
        type: 'object',
        properties: { taskId: { type: 'string' }, shiftDays: { type: 'number' }, durationScale: { type: 'number' }, newDurationDays: { type: 'number' } },
        required: ['taskId'], additionalProperties: false,
      },
    },
    assumeSpi: { type: 'number' }, assumeCpi: { type: 'number' }, bacDeltaIdr: { type: 'number' },
    mode: { type: 'string', enum: ['push', 'asap'] },
  },
  additionalProperties: false,
} as const;

const SPEC_SYSTEM = [
  'Anda menerjemahkan pertanyaan "bagaimana jika" seorang Project Manager menjadi SPEC skenario terstruktur untuk sebuah simulator deterministik.',
  'Keluaran HARUS memakai HANYA taskId yang ada di daftar tugas pada payload. Jangan mengarang id.',
  'Pemetaan:',
  '- "mundur/geser tugas X N hari" → taskChanges[{taskId, shiftDays:N}] (negatif = maju).',
  '- "percepat/tambah orang di fase/tugas X" → taskChanges[{taskId, durationScale}] pada tugas fase itu (mis. 30% lebih cepat = durationScale 0.7). Jadwal bersifat berbasis-tanggal, jadi headcount HARUS dinyatakan sebagai perubahan durasi.',
  '- "durasi X jadi N hari kerja" → {taskId, newDurationDays:N}.',
  '- "kalau SPI/CPI jadi X ke depan" → assumeSpi / assumeCpi.',
  '- "tambah/kurangi anggaran N" → bacDeltaIdr.',
  'Batasan: shiftDays ±3650, durationScale 0.1–5, assumeSpi/assumeCpi 0.1–3. Kembalikan spec kosong bila pertanyaan tak dapat dipetakan.',
].join('\n');

const NARRATE_SYSTEM = [
  'Anda seorang analis PMO yang menjelaskan hasil simulasi "bagaimana jika" kepada Project Manager, secara ringkas & jujur, dalam Bahasa Indonesia manajemen proyek.',
  'HANYA gunakan angka pada payload (baseline vs scenario + deltas). Jangan mengarang.',
  'summary: 1-2 kalimat dampak utama (finish, forecast finish, EAC/VAC). tradeoffs: poin-poin trade-off. recommendation: 1 kalimat saran.',
  'Bila ada catatan (notes), sampaikan caveat-nya (mis. jadwal berbasis tanggal, bukan kapasitas).',
].join('\n');

const NARRATE_JSON_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' }, tradeoffs: { type: 'array', items: { type: 'string' } }, recommendation: { type: 'string' } },
  required: ['summary', 'tradeoffs', 'recommendation'], additionalProperties: false,
} as const;

export interface WhatIfNarrative { summary: string; tradeoffs: string[]; recommendation: string }

// Per-tenant advisory opt-in (reuses Tenant.aiNarrativeEnabled), like evmExplain.assertTenantOptedIn.
async function assertTenantOptedIn(projectId: string): Promise<void> {
  const proj = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { tenantId: true, tenant: { select: { aiNarrativeEnabled: true } } } });
  if (!proj) throw NotFound('Project not found');
  const hasTenant = Boolean(getTenantStore()?.tenantId || proj.tenantId);
  if (hasTenant && proj.tenant?.aiNarrativeEnabled !== true) throw Forbidden('Fitur AI belum diaktifkan untuk workspace ini.');
}

// NL question → bounded WhatIfSpec (grounded to real task ids; unknown ids are dropped at simulate).
async function draftScenarioSpec(projectId: string, question: string): Promise<WhatIfSpec> {
  const [tasks, forecast] = await Promise.all([whatIfContext(projectId), getProjectForecast(projectId, new Date())]);
  const user = JSON.stringify({ question, tasks, forecast: { bac: forecast.bac, spi: forecast.spi, cpi: forecast.cpi, plannedFinish: forecast.schedule.plannedFinish } });
  const raw = await getAiPort().draftJson({ system: SPEC_SYSTEM, user, jsonSchema: WHATIF_SPEC_JSON_SCHEMA, maxTokens: 900 });
  const parsed = raw == null ? null : WhatIfSpecSchema.safeParse(raw);
  if (!parsed || !parsed.success) throw new AppError(502, 'AI tidak dapat menerjemahkan pertanyaan menjadi skenario. Coba lebih spesifik.', 'AI_UNAVAILABLE');
  return parsed.data;
}

async function narrateScenario(question: string, result: WhatIfResult): Promise<WhatIfNarrative> {
  const raw = await getAiPort().draftJson({ system: NARRATE_SYSTEM, user: JSON.stringify({ question, ...result }), jsonSchema: NARRATE_JSON_SCHEMA, maxTokens: 900 });
  const parsed = raw == null ? null : z.object({ summary: z.string(), tradeoffs: z.array(z.string()), recommendation: z.string() }).safeParse(raw);
  if (!parsed || !parsed.success) throw new AppError(502, 'AI tidak dapat menarasikan hasil simulasi.', 'AI_UNAVAILABLE');
  return parsed.data;
}

// Full AI what-if: translate → simulate (deterministic) → narrate. Assumes the route checked the env
// gate (503). Read-only.
export async function runWhatIfAi(projectId: string, question: string): Promise<{ spec: WhatIfSpec; result: WhatIfResult; narrative: WhatIfNarrative }> {
  await assertTenantOptedIn(projectId);
  const spec = await draftScenarioSpec(projectId, question);
  const result = await simulateScenario(projectId, spec);
  const narrative = await narrateScenario(question, result);
  return { spec, result, narrative };
}
