// Quality-trend sampling (round-6 #5). A fraction of LIVE Anett answers are scored by the LLM judge
// (lib/aiJudge) in the background and stored as AiJudgeSample rows, so an admin can watch real answer
// quality over time — the offline eval (npm run eval:judge) only scores a STATIC golden set, which
// measures the judge's stability, not the assistant's real output. Dormant by default: with
// AI_JUDGE_SAMPLE_RATE unset (or 0) nothing is sampled and there is zero extra spend.
import { prisma } from './prisma.js';
import { aiConfig, aiEnabled } from './ai.js';
import { judgeAnswer } from './aiJudge.js';
import { getTenantStore, runWithTenant } from './tenant/context.js';
import { logger } from './observability.js';

const SNIPPET = 500; // question/answer/rationale are clipped to this many chars (privacy + row size)
const clip = (s: string): string => (s.length > SNIPPET ? s.slice(0, SNIPPET) : s);

// Features whose draftJson output is a user-facing "answer" worth judging for quality. Wired at the
// single lib/ai.ts choke point (sampleDraftQuality) so EVERY answer-like surface is measured, not just
// Anett chat (which self-samples via runToolLoop). Deliberately EXCLUDES: 'eval_judge' (the judge must
// never judge itself → recursion + cost blow-up), 'data_extract' (structured extraction, not prose),
// and 'memory_distill'/'feedback_distill' (internal learning steps, never shown to a user).
const QUALITY_ANSWER_FEATURES = new Set<string>([
  'narrative', 'proactive', 'cr_impact', 'evm_explain', 'risk_suggest',
  'portfolio_qa', 'review', 'schedule_suggest', 'whatif', 'resource_realloc',
]);

// Is this feature one whose generated answer we sample for quality? (allowlist above)
export function isQualityAnswerFeature(feature?: string | null): boolean {
  return !!feature && QUALITY_ANSWER_FEATURES.has(feature);
}

// Fire-and-forget quality sampling for a structured (draftJson) generative call. The model's JSON
// output is the `answer`; the user prompt is the `question`; the system prompt (which carries the
// grounding data) is the judge `context`. No-op for non-answer features (allowlist) or when sampling is
// disarmed (sampleAnswerQuality re-checks shouldSampleJudge). Keeps all sampling POLICY here so the
// lib/ai.ts choke point stays a one-liner.
export function sampleDraftQuality(input: { feature?: string | null; system: string; user: string; answer: string }): void {
  if (!isQualityAnswerFeature(input.feature)) return;
  sampleAnswerQuality({ question: input.user, answer: input.answer, context: input.system, feature: input.feature! });
}

// Fraction of answers to sample, clamped to [0, 1]. 0 (default) ⇒ feature off.
export function judgeSampleRate(): number {
  const r = Number(process.env.AI_JUDGE_SAMPLE_RATE);
  return Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0;
}

// Roll the dice for this answer. Needs the AI key (the judge calls the model) and a positive rate.
export function shouldSampleJudge(): boolean {
  const rate = judgeSampleRate();
  if (rate <= 0 || !aiEnabled()) return false;
  return Math.random() < rate;
}

// Judge one answer and store the score. Awaitable core (used by tests); returns true when a row was
// written, false when the judge declined/failed. Must run inside a tenant context (the create is
// tenant-scoped). `tenantId` is passed explicitly too — the extension injects the same value under
// context; explicit covers the no-context path (mirrors recordAiUsage).
export async function recordJudgeSample(input: { question: string; answer: string; context?: string; feature?: string; userId?: string; tenantId?: string | null }): Promise<boolean> {
  // Pass the tool-gathered context so the judge can VERIFY facts (fair groundedness) instead of scoring
  // data-heavy answers blind. Context is used transiently by the judge; it is NOT stored on the row.
  const score = await judgeAnswer({ question: input.question, answer: input.answer, context: input.context });
  if (!score) return false;
  await prisma.aiJudgeSample.create({
    data: {
      tenantId: input.tenantId ?? getTenantStore()?.tenantId ?? null,
      feature: input.feature ?? 'assistant_qa',
      model: aiConfig().proactiveModel,
      question: clip(input.question),
      answer: clip(input.answer),
      groundedness: score.groundedness,
      helpfulness: score.helpfulness,
      clarity: score.clarity,
      overall: score.overall,
      pass: score.pass,
      rationale: clip(score.rationale),
      userId: input.userId ?? null,
    },
  });
  return true;
}

// Fire-and-forget: judge one live answer and store the score. NEVER blocks the caller or throws into
// it (best-effort, like recordAiUsage). The tenant id is captured synchronously and re-bound for the
// detached work so the judge's own usage-recording + the DB write stay tenant-scoped after the request
// handler returns. No-op unless shouldSampleJudge() passes.
export function sampleAnswerQuality(input: { question: string; answer: string; context?: string; feature?: string; userId?: string }): void {
  if (!shouldSampleJudge()) return;
  if (!input.question.trim() || !input.answer.trim()) return;
  const tenantId = getTenantStore()?.tenantId ?? null;
  const run = async (): Promise<void> => {
    try {
      await recordJudgeSample({ ...input, tenantId });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[ai-judge-sample] background judge failed');
    }
  };
  void (tenantId ? runWithTenant(tenantId, run) : run());
}
