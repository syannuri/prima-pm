import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { getAiPort, aiNotEnabledError } from '../../lib/ai.js';
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
  'You are a senior PMO analyst explaining a project\'s Earned Value (EVM) picture to a Project Manager, then recommending recovery steps.',
  'Write in natural, concise project-management English (not a literal translation).',
  '',
  'GROUNDING RULES (MANDATORY):',
  '- Only state facts SUPPORTED by the numbers in the data payload (EVM, forecast, overdue tasks). Do not make things up.',
  '- Do not cite numbers, dates, or names that are not in the payload.',
  '- Interpret EVM correctly: SPI/CPI < 1 = behind schedule / over budget; > 1 = good. Negative CV/SV = bad. TCPI > 1 = needs higher efficiency.',
  '- If the project is healthy (SPI & CPI >= 1), say so briefly and keep drivers/recovery short or empty.',
  '',
  'Produce a structured explanation:',
  '- verdict: 1-2 sentences on schedule & cost condition based on SPI/CPI and the forecast (EAC/variance).',
  '- scheduleDrivers: the main causes of the schedule position (e.g. overdue critical tasks), as short bullet points.',
  '- costDrivers: the main causes of the cost position (e.g. low CPI, EAC above BAC), as short bullet points.',
  '- recovery: 2-4 concrete, actionable recovery steps.',
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
    throw aiNotEnabledError();
  }
}

// Generate an EVM explanation DRAFT for a project. Does NOT persist. Assumes the global env gate
// (aiEnabled) was already checked by the route (→ 503 when off).
export async function generateEvmExplain(projectId: string, asOf: Date): Promise<EvmExplainDraft> {
  await assertTenantOptedIn(projectId);
  const report = await getProjectReport(projectId, 'monthly', asOf);
  const { system, user } = buildEvmExplainPrompt(report);
  const raw = await getAiPort().draftJson({ system, user, jsonSchema: EVM_EXPLAIN_JSON_SCHEMA, maxTokens: 1500, feature: 'evm_explain' });
  const parsed = raw == null ? null : EvmExplainSchema.safeParse(raw);
  if (!parsed || !parsed.success) {
    throw new AppError(502, 'AI tidak dapat membuat penjelasan EVM saat ini. Silakan analisa secara manual.', 'AI_UNAVAILABLE');
  }
  return parsed.data;
}
