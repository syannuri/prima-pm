import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { aiEnabled, getAiPort, aiNotEnabledError } from '../../lib/ai.js';
import { getProjectReport } from '../report/report.service.js';

// Whether AI features are usable for this project right now: the global env gate (ANTHROPIC_API_KEY)
// AND the per-tenant opt-in (Tenant.aiNarrativeEnabled). Reusable across AI features (drives the
// client's show/hide of AI buttons). Mirrors the aiAvailable logic in report.service.
export async function aiAvailableForProject(projectId: string): Promise<boolean> {
  if (!aiEnabled()) return false;
  const proj = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { tenantId: true, tenant: { select: { aiNarrativeEnabled: true } } },
  });
  if (!proj) return false;
  const hasTenant = Boolean(getTenantStore()?.tenantId || proj.tenantId);
  return hasTenant ? proj.tenant?.aiNarrativeEnabled === true : true;
}

type Report = Awaited<ReturnType<typeof getProjectReport>>;
type ChangeRequest = Awaited<ReturnType<typeof prisma.changeRequest.findFirstOrThrow>>;

// The structured impact analysis the model returns. Advisory only — it informs the human decider
// (ADMIN/PMO); it never auto-decides the CR.
export const CrImpactSchema = z.object({
  scheduleImpact: z.string(),
  costImpact: z.string(),
  riskNarrative: z.string(),
  newRisks: z.array(z.object({
    title: z.string(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  })),
  recommendation: z.enum(['APPROVE', 'REJECT', 'NEEDS_INFO']),
  rationale: z.string(),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
});
export type CrImpactDraft = z.infer<typeof CrImpactSchema>;

// Raw JSON schema (constrains the model output). Hand-authored — see the note in ai.ts on why we
// don't derive it from the zod schema.
const CR_IMPACT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    scheduleImpact: { type: 'string' },
    costImpact: { type: 'string' },
    riskNarrative: { type: 'string' },
    newRisks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        },
        required: ['title', 'severity'],
        additionalProperties: false,
      },
    },
    recommendation: { type: 'string', enum: ['APPROVE', 'REJECT', 'NEEDS_INFO'] },
    rationale: { type: 'string' },
    confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
  },
  required: ['scheduleImpact', 'costImpact', 'riskNarrative', 'newRisks', 'recommendation', 'rationale', 'confidence'],
  additionalProperties: false,
} as const;

// STABLE (no per-request data) so it prompt-caches. Persona + language + the anti-hallucination
// grounding rule (mirrors narrative.service): assertions must be supported by the payload numbers.
const SYSTEM_PROMPT = [
  'Anda adalah seorang analis PMO senior yang menilai dampak sebuah Change Request (CR) terhadap proyek, untuk membantu approver (PMO/Admin) mengambil keputusan.',
  'Tulis dalam Bahasa Indonesia manajemen proyek yang natural dan ringkas (bukan terjemahan harfiah).',
  '',
  'ATURAN GROUNDING (WAJIB):',
  '- Hanya nyatakan fakta yang DIDUKUNG oleh angka pada payload data (baseline, EVM, forecast, isi CR). Jangan mengarang.',
  '- Jangan menyebut angka, tanggal, atau nama yang tidak ada di payload.',
  '- Interpretasikan EVM secara benar: SPI/CPI < 1 = di belakang jadwal / over budget; > 1 = baik.',
  '- Jika CR bersifat chargeable (client-funded), perhitungkan bahwa biayanya menambah revenue, bukan menggerus margin.',
  '- Anda adalah penasihat, BUKAN pengambil keputusan; rekomendasi hanya sebagai masukan.',
  '',
  'Hasilkan analisa terstruktur:',
  '- scheduleImpact: perkiraan dampak ke jadwal (durasi/finish/critical path), berbasis magnitude & impactAreas CR dan posisi jadwal saat ini.',
  '- costImpact: perkiraan dampak ke biaya/BAC/margin (atau revenue jika chargeable).',
  '- riskNarrative: narasi risiko yang muncul/berubah akibat CR ini.',
  '- newRisks: daftar ringkas risiko baru yang perlu didaftarkan (title + severity).',
  '- recommendation: APPROVE, REJECT, atau NEEDS_INFO (bila data tidak cukup).',
  '- rationale: 1-2 kalimat alasan rekomendasi.',
  '- confidence: LOW/MEDIUM/HIGH sesuai kelengkapan data.',
].join('\n');

// Compact the CR + the (large) getProjectReport payload down to the figures the analysis needs.
function compactCrContext(cr: ChangeRequest, r: Report) {
  const overdue = r.tasks.remaining.filter((t) => t.overdue).slice(0, 10)
    .map((t) => ({ name: t.name, pct: t.pct, due: t.planEnd }));
  return {
    changeRequest: {
      type: cr.type,
      title: cr.title,
      description: cr.description,
      magnitude: cr.magnitude,
      impactAreas: cr.impactAreas,
      chargeable: cr.chargeable,
      amountIdr: cr.amountIdr != null ? Number(cr.amountIdr) : null,
    },
    project: {
      code: r.project.code,
      name: r.project.name,
      status: r.project.status,
      approach: r.project.deliveryApproach,
    },
    health: r.health,
    evm: {
      bac: r.evm.bac,
      pv: r.evm.pv,
      ev: r.evm.ev,
      ac: r.evm.ac,
      spi: r.evm.spi,
      cpi: r.evm.cpi,
      percentComplete: r.evm.percentComplete,
    },
    forecast: {
      eac: r.forecast.eac,
      plannedFinish: r.forecast.schedule.plannedFinish,
      forecastFinish: r.forecast.schedule.forecastFinish,
      varianceDays: r.forecast.schedule.varianceDays,
    },
    tasks: {
      total: r.tasks.total,
      completed: r.tasks.completed,
      overdueCount: overdue.length,
      overdue,
    },
  };
}

// PURE: builds the {system,user} pair. Unit-testable without a DB or the LLM.
export function buildCrImpactPrompt(cr: ChangeRequest, report: Report): { system: string; user: string } {
  return { system: SYSTEM_PROMPT, user: JSON.stringify(compactCrContext(cr, report)) };
}

// Per-tenant opt-in — reuses Tenant.aiNarrativeEnabled (one switch for all AI features). Mirrors
// narrative.service.assertTenantOptedIn: the gate applies only when a tenant actually exists.
async function assertTenantOptedIn(projectId: string): Promise<void> {
  const proj = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { tenantId: true, tenant: { select: { aiNarrativeEnabled: true } } },
  });
  if (!proj) throw NotFound('Project not found');
  const hasTenant = Boolean(getTenantStore()?.tenantId || proj.tenantId);
  if (hasTenant && proj.tenant?.aiNarrativeEnabled !== true) {
    throw aiNotEnabledError();
  }
}

// Generate an impact DRAFT for a CR. Does NOT persist and does NOT change the CR status — the
// decider reviews it and decides via the existing decideChangeRequest. Assumes the global env gate
// (aiEnabled) was already checked by the route (→ 503 when off).
export async function generateCrImpact(projectId: string, crId: string): Promise<CrImpactDraft> {
  await assertTenantOptedIn(projectId);
  const cr = await prisma.changeRequest.findFirst({ where: { id: crId, projectId } });
  if (!cr) throw NotFound('Change request not found');
  // Baseline + current EVM snapshot as of now (period only scopes trend deltas we don't use here).
  const report = await getProjectReport(projectId, 'monthly', new Date());
  const { system, user } = buildCrImpactPrompt(cr, report);
  const raw = await getAiPort().draftJson({ system, user, jsonSchema: CR_IMPACT_JSON_SCHEMA, maxTokens: 2000, feature: 'cr_impact' });
  const parsed = raw == null ? null : CrImpactSchema.safeParse(raw);
  if (!parsed || !parsed.success) {
    throw new AppError(502, 'AI tidak dapat membuat analisa dampak saat ini. Silakan nilai CR secara manual.', 'AI_UNAVAILABLE');
  }
  return parsed.data;
}
