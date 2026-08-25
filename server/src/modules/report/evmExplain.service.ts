import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, Forbidden, NotFound } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { getAiPort } from '../../lib/ai.js';
import { getProjectReport } from './report.service.js';

type Report = Awaited<ReturnType<typeof getProjectReport>>;

// The structured EVM explanation the model returns. Advisory: it interprets the current EVM/forecast
// picture and proposes concrete recovery actions for the PM.
export const EvmExplainSchema = z.object({
  verdict: z.string(),
  scheduleDrivers: z.array(z.string()),
  costDrivers: z.array(z.string()),
  recovery: z.array(z.string()),
});
export type EvmExplainDraft = z.infer<typeof EvmExplainSchema>;

const EVM_EXPLAIN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    scheduleDrivers: { type: 'array', items: { type: 'string' } },
    costDrivers: { type: 'array', items: { type: 'string' } },
    recovery: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'scheduleDrivers', 'costDrivers', 'recovery'],
  additionalProperties: false,
} as const;

// STABLE (no per-request data) ⇒ prompt-caches. Persona + language + anti-hallucination grounding
// (mirrors narrative.service) + correct EVM interpretation.
const SYSTEM_PROMPT = [
  'Anda adalah seorang analis PMO senior yang menjelaskan kondisi Earned Value (EVM) sebuah proyek kepada Project Manager, lalu menyarankan langkah pemulihan.',
  'Tulis dalam Bahasa Indonesia manajemen proyek yang natural dan ringkas (bukan terjemahan harfiah).',
  '',
  'ATURAN GROUNDING (WAJIB):',
  '- Hanya nyatakan fakta yang DIDUKUNG oleh angka pada payload data (EVM, forecast, tugas overdue). Jangan mengarang.',
  '- Jangan menyebut angka, tanggal, atau nama yang tidak ada di payload.',
  '- Interpretasikan EVM secara benar: SPI/CPI < 1 = di belakang jadwal / over budget; > 1 = baik. CV/SV negatif = buruk. TCPI > 1 = butuh efisiensi lebih tinggi.',
  '- Bila proyek sehat (SPI & CPI >= 1), katakan demikian secara ringkas dan buat drivers/recovery singkat atau kosong.',
  '',
  'Hasilkan penjelasan terstruktur:',
  '- verdict: 1-2 kalimat kondisi jadwal & biaya berdasarkan SPI/CPI dan forecast (EAC/variance).',
  '- scheduleDrivers: penyebab utama posisi jadwal (mis. tugas kritis overdue), sebagai poin-poin ringkas.',
  '- costDrivers: penyebab utama posisi biaya (mis. CPI rendah, EAC di atas BAC), sebagai poin-poin ringkas.',
  '- recovery: 2-4 langkah pemulihan konkret dan dapat ditindaklanjuti.',
].join('\n');

// Compact the report down to the EVM/forecast figures the explanation needs.
function compactEvmContext(r: Report) {
  const overdue = r.tasks.remaining.filter((t) => t.overdue).slice(0, 10)
    .map((t) => ({ name: t.name, pct: t.pct, due: t.planEnd }));
  return {
    project: { code: r.project.code, name: r.project.name, status: r.project.status, approach: r.project.deliveryApproach },
    health: r.health,
    evm: {
      bac: r.evm.bac, pv: r.evm.pv, ev: r.evm.ev, ac: r.evm.ac,
      spi: r.evm.spi, cpi: r.evm.cpi,
      percentComplete: r.evm.percentComplete, scheduleProgress: r.evm.scheduleProgress,
    },
    forecast: {
      eac: r.forecast.eac,
      etc: r.forecast.etc,
      vac: r.forecast.vac,
      tcpi: r.forecast.tcpi,
      plannedFinish: r.forecast.schedule.plannedFinish,
      forecastFinish: r.forecast.schedule.forecastFinish,
      varianceDays: r.forecast.schedule.varianceDays,
    },
    tasks: {
      total: r.tasks.total,
      completed: r.tasks.completed,
      inProgress: r.tasks.inProgress,
      overdueCount: overdue.length,
      overdue,
    },
    delta: r.delta,
  };
}

// PURE: builds the {system,user} pair. Unit-testable without a DB or the LLM.
export function buildEvmExplainPrompt(report: Report): { system: string; user: string } {
  return { system: SYSTEM_PROMPT, user: JSON.stringify(compactEvmContext(report)) };
}

// Per-tenant opt-in — reuses Tenant.aiNarrativeEnabled (one switch for all AI). Mirrors
// narrative.service.assertTenantOptedIn: applies only when a tenant actually exists.
async function assertTenantOptedIn(projectId: string): Promise<void> {
  const proj = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { tenantId: true, tenant: { select: { aiNarrativeEnabled: true } } },
  });
  if (!proj) throw NotFound('Project not found');
  const hasTenant = Boolean(getTenantStore()?.tenantId || proj.tenantId);
  if (hasTenant && proj.tenant?.aiNarrativeEnabled !== true) {
    throw Forbidden('Fitur AI belum diaktifkan untuk workspace ini.');
  }
}

// Generate an EVM explanation DRAFT for a project. Does NOT persist. Assumes the global env gate
// (aiEnabled) was already checked by the route (→ 503 when off).
export async function generateEvmExplain(projectId: string, asOf: Date): Promise<EvmExplainDraft> {
  await assertTenantOptedIn(projectId);
  const report = await getProjectReport(projectId, 'monthly', asOf);
  const { system, user } = buildEvmExplainPrompt(report);
  const raw = await getAiPort().draftJson({ system, user, jsonSchema: EVM_EXPLAIN_JSON_SCHEMA, maxTokens: 1500 });
  const parsed = raw == null ? null : EvmExplainSchema.safeParse(raw);
  if (!parsed || !parsed.success) {
    throw new AppError(502, 'AI tidak dapat membuat penjelasan EVM saat ini. Silakan analisa secara manual.', 'AI_UNAVAILABLE');
  }
  return parsed.data;
}
