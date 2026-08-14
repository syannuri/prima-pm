import { prisma } from '../../lib/prisma.js';
import { AppError, Forbidden, NotFound } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { getAiNarrativePort, type NarrativeDraft } from '../../lib/ai.js';
import { getProjectReport } from './report.service.js';
import type { ReportPeriod } from './report.service.js';

type Report = Awaited<ReturnType<typeof getProjectReport>>;

// The system prompt is STABLE (no per-request data) so it prompt-caches. It sets the persona,
// language, and — critically — the anti-hallucination grounding rule: the model may only assert
// facts the payload's numbers support.
const SYSTEM_PROMPT = [
  'Anda adalah seorang analis PMO senior yang menulis narasi status proyek untuk laporan manajemen.',
  'Tulis dalam Bahasa Indonesia manajemen proyek yang natural dan ringkas (bukan terjemahan harfiah).',
  '',
  'ATURAN GROUNDING (WAJIB):',
  '- Hanya nyatakan fakta yang DIDUKUNG oleh angka pada payload data. Jangan mengarang.',
  '- Jangan menyebut angka, tanggal, atau nama yang tidak ada di payload.',
  '- Jika sebuah bagian tidak punya data yang relevan, buat singkat atau nyatakan "tidak ada".',
  '- Interpretasikan EVM secara benar: SPI/CPI < 1 = di belakang jadwal / over budget; > 1 = baik.',
  '',
  'Hasilkan empat bagian:',
  '- executiveSummary: 2-3 kalimat verdict kesehatan proyek (jadwal, biaya, risiko utama).',
  '- highlights: pencapaian & progres positif periode ini.',
  '- lowlights: hambatan, keterlambatan, tugas overdue, dan kekhawatiran biaya/jadwal.',
  '- nextFocus: prioritas yang direkomendasikan untuk periode berikutnya.',
].join('\n');

// Compact the (large) getProjectReport payload down to the figures the narrative actually needs.
// Smaller payload = fewer tokens + a sharper focus for the model.
function compactReport(r: Report) {
  const overdue = r.tasks.remaining
    .filter((t) => t.overdue)
    .slice(0, 10)
    .map((t) => ({ name: t.name, pct: t.pct, due: t.planEnd, owner: t.owner }));
  return {
    project: {
      code: r.project.code,
      name: r.project.name,
      pm: r.project.pmName,
      status: r.project.status,
      approach: r.project.deliveryApproach,
    },
    period: r.period,
    periodLabel: r.periodLabel,
    health: r.health,
    evm: {
      bac: r.evm.bac,
      pv: r.evm.pv,
      ev: r.evm.ev,
      ac: r.evm.ac,
      spi: r.evm.spi,
      cpi: r.evm.cpi,
      percentComplete: r.evm.percentComplete,
      weightedProgress: r.evm.weightedProgress,
      scheduleProgress: r.evm.scheduleProgress,
    },
    tasks: {
      total: r.tasks.total,
      completed: r.tasks.completed,
      inProgress: r.tasks.inProgress,
      notStarted: r.tasks.notStarted,
      weightedPct: r.tasks.weightedPct,
      overdueCount: overdue.length,
      overdue,
    },
    forecast: {
      eac: r.forecast.eac, // { optimistic, likely, pessimistic }
      plannedFinish: r.forecast.schedule.plannedFinish,
      forecastFinish: r.forecast.schedule.forecastFinish,
      varianceDays: r.forecast.schedule.varianceDays,
    },
    // Trend vs the prior captured status (null when there is no earlier snapshot).
    delta: r.delta,
  };
}

// PURE: builds the {system,user} pair from a report. Unit-testable without a DB or the LLM.
export function buildNarrativePrompt(report: Report): { system: string; user: string } {
  return { system: SYSTEM_PROMPT, user: JSON.stringify(compactReport(report)) };
}

// Resolve the per-tenant opt-in. Tenant is a global (non-scoped) model. When there is no tenant at
// all (single-tenant deploy with enforcement off + null tenantId), the per-tenant gate does not
// apply and the global env gate alone governs. When a tenant exists, it MUST have opted in.
async function assertTenantOptedIn(projectId: string): Promise<void> {
  const proj = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { tenantId: true, tenant: { select: { aiNarrativeEnabled: true } } },
  });
  if (!proj) throw NotFound('Project not found');
  const hasTenant = Boolean(getTenantStore()?.tenantId || proj.tenantId);
  if (hasTenant && proj.tenant?.aiNarrativeEnabled !== true) {
    throw Forbidden('AI Status Narrative belum diaktifkan untuk workspace ini.');
  }
}

// Generate a narrative DRAFT for a project/period. Does NOT persist — the caller (PM) reviews/edits
// and saves via the existing saveCommentary. Assumes the global env gate (aiEnabled) was already
// checked by the route (→ 503 when off).
export async function generateNarrative(
  projectId: string,
  period: ReportPeriod,
  asOf: Date,
): Promise<NarrativeDraft> {
  await assertTenantOptedIn(projectId);
  const report = await getProjectReport(projectId, period, asOf);
  const { system, user } = buildNarrativePrompt(report);
  const draft = await getAiNarrativePort().draftNarrative({ system, user });
  if (!draft) {
    // Refusal or empty output — surface gracefully so the PM can fill the commentary manually.
    throw new AppError(502, 'AI tidak dapat membuat draft saat ini. Silakan isi commentary secara manual.', 'AI_UNAVAILABLE');
  }
  return draft;
}
