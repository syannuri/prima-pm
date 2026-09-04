import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { getAiPort, aiNotEnabledError } from '../../lib/ai.js';

// A single suggested risk — qualitative only. EMV (probabilityPct / impactCostIdr) is left to the PM
// on accept, so the model never fabricates money figures. Response strategy follows the PMBOK enum
// (threats: AVOID/MITIGATE/TRANSFER/ACCEPT; opportunities: EXPLOIT/ENHANCE/SHARE/ACCEPT).
export const RiskSuggestionSchema = z.object({
  title: z.string(),
  description: z.string(),
  category: z.string(),
  kind: z.enum(['THREAT', 'OPPORTUNITY']),
  probabilityScore: z.number().int().min(1).max(5),
  impactScore: z.number().int().min(1).max(5),
  responseStrategy: z.enum(['AVOID', 'MITIGATE', 'TRANSFER', 'ACCEPT', 'EXPLOIT', 'ENHANCE', 'SHARE']).nullable().optional(),
});
export const RiskSuggestSchema = z.object({ risks: z.array(RiskSuggestionSchema) });
export type RiskSuggestion = z.infer<typeof RiskSuggestionSchema>;
export type RiskSuggestDraft = z.infer<typeof RiskSuggestSchema>;

const RISK_SUGGEST_JSON_SCHEMA = {
  type: 'object',
  properties: {
    risks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          kind: { type: 'string', enum: ['THREAT', 'OPPORTUNITY'] },
          probabilityScore: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          impactScore: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          responseStrategy: { type: 'string', enum: ['AVOID', 'MITIGATE', 'TRANSFER', 'ACCEPT', 'EXPLOIT', 'ENHANCE', 'SHARE'] },
        },
        required: ['title', 'description', 'category', 'kind', 'probabilityScore', 'impactScore'],
        additionalProperties: false,
      },
    },
  },
  required: ['risks'],
  additionalProperties: false,
} as const;

// Both STABLE ⇒ prompt-cache per language. Persona + language + grounding (only from the charter/WBS,
// no duplicates, realistic qualitative scoring, PMBOK response strategies). One prompt per app language
// so the generated risk text matches the language the PM is working in.
const SYSTEM_PROMPT_ID = [
  'Anda adalah seorang manajer risiko PMO senior yang menyusun draft daftar risiko (risk register) dari Project Charter dan WBS sebuah proyek.',
  'Tulis dalam Bahasa Indonesia manajemen proyek yang natural dan ringkas (bukan terjemahan harfiah).',
  '',
  'ATURAN (WAJIB):',
  '- Usulkan risiko yang RELEVAN dengan lingkup, deliverable, dan tugas pada payload. Jangan mengarang konteks yang tidak ada.',
  '- JANGAN mengusulkan risiko yang sudah ada di daftar existingRiskTitles (hindari duplikat).',
  '- Sertakan campuran ancaman (THREAT) dan, bila relevan, peluang (OPPORTUNITY).',
  '- Beri skor probabilitas & dampak 1-5 yang realistis (1=sangat rendah, 5=sangat tinggi).',
  '- responseStrategy mengikuti PMBOK: THREAT → AVOID/MITIGATE/TRANSFER/ACCEPT; OPPORTUNITY → EXPLOIT/ENHANCE/SHARE/ACCEPT.',
  '- Usulkan maksimal 8 risiko paling penting. Jika data charter/WBS terlalu tipis, usulkan lebih sedikit.',
  '',
  'Untuk setiap risiko hasilkan: title (ringkas), description (1-2 kalimat), category (mis. Teknis, Jadwal, Biaya, Sumber Daya, Eksternal, Mutu), kind, probabilityScore, impactScore, responseStrategy.',
].join('\n');

const SYSTEM_PROMPT_EN = [
  'You are a senior PMO risk manager drafting a risk register from a project Project Charter and WBS.',
  'Write in natural, concise project-management English (not a literal translation).',
  '',
  'RULES (MANDATORY):',
  '- Suggest risks that are RELEVANT to the scope, deliverables, and tasks in the payload. Do not invent context that is not present.',
  '- Do NOT suggest risks that already exist in the existingRiskTitles list (avoid duplicates).',
  '- Include a mix of THREATs and, where relevant, OPPORTUNITIES.',
  '- Give realistic probability & impact scores 1-5 (1=very low, 5=very high).',
  '- responseStrategy follows PMBOK: THREAT → AVOID/MITIGATE/TRANSFER/ACCEPT; OPPORTUNITY → EXPLOIT/ENHANCE/SHARE/ACCEPT.',
  '- Suggest at most 8 of the most important risks. If the charter/WBS data is too thin, suggest fewer.',
  '',
  'For each risk produce: title (concise), description (1-2 sentences), category (e.g. Technical, Schedule, Cost, Resource, External, Quality), kind, probabilityScore, impactScore, responseStrategy.',
].join('\n');

interface SuggestContext {
  charter: Awaited<ReturnType<typeof prisma.projectCharter.findUnique>>;
  project: { code: string; name: string; approach: string } | null;
  taskNames: string[];
  existingRiskTitles: string[];
}

export type SuggestLang = 'id' | 'en';

// PURE: builds the {system,user} pair. Unit-testable without a DB or the LLM. The system prompt
// (and therefore the generated risk text) follows the caller's app language.
export function buildRiskSuggestPrompt(ctx: SuggestContext, lang: SuggestLang = 'en'): { system: string; user: string } {
  const c = ctx.charter;
  const payload = {
    project: ctx.project,
    charter: c
      ? {
          description: c.description,
          goals: c.goals,
          category: c.category,
          scope: c.hiScope,
          deliverables: c.hiDeliverables,
          budgetIdr: Number(c.hiCostIdr),
          scheduleStart: c.hiScheduleStart,
          scheduleEnd: c.hiScheduleEnd,
        }
      : null,
    wbsTasks: ctx.taskNames,
    existingRiskTitles: ctx.existingRiskTitles,
  };
  return { system: lang === 'id' ? SYSTEM_PROMPT_ID : SYSTEM_PROMPT_EN, user: JSON.stringify(payload) };
}

// Per-tenant opt-in — reuses Tenant.aiNarrativeEnabled (one switch for all AI).
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

// Generate risk SUGGESTIONS for a project. Does NOT persist anything — the PM reviews the checklist
// and creates the ones they keep via the existing POST /risk. Assumes the global env gate (aiEnabled)
// was already checked by the route (→ 503 when off).
export async function generateRiskSuggestions(projectId: string, lang: SuggestLang = 'en'): Promise<RiskSuggestDraft> {
  await assertTenantOptedIn(projectId);
  const [charter, project, tasks, risks] = await Promise.all([
    prisma.projectCharter.findUnique({ where: { projectId } }),
    prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { code: true, name: true, deliveryApproach: true } }),
    prisma.task.findMany({ where: { projectId }, select: { name: true }, take: 60, orderBy: { wbsCode: 'asc' } }),
    prisma.risk.findMany({ where: { projectId }, select: { title: true } }),
  ]);
  if (!project) throw NotFound('Project not found');
  const ctx: SuggestContext = {
    charter,
    project: { code: project.code, name: project.name, approach: project.deliveryApproach },
    taskNames: tasks.map((t) => t.name).slice(0, 40),
    existingRiskTitles: risks.map((r) => r.title),
  };
  const { system, user } = buildRiskSuggestPrompt(ctx, lang);
  const raw = await getAiPort().draftJson({ system, user, jsonSchema: RISK_SUGGEST_JSON_SCHEMA, maxTokens: 2500, feature: 'risk_suggest' });
  const parsed = raw == null ? null : RiskSuggestSchema.safeParse(raw);
  if (!parsed || !parsed.success) {
    throw new AppError(
      502,
      lang === 'id'
        ? 'AI tidak dapat menyusun saran risiko saat ini. Silakan tambah risiko secara manual.'
        : 'AI could not compose risk suggestions right now. Please add risks manually.',
      'AI_UNAVAILABLE',
    );
  }
  return parsed.data;
}
