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
