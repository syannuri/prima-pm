import { getAiPort, aiConfig } from './ai.js';

// LLM-as-judge eval (round-5 #1). The deterministic graders (aiEval.ts / #4) catch STRUCTURAL faults
// (hallucinated codes, inverted EVM) but can't judge SEMANTIC quality. This scores an answer on a
// rubric via a cheap model (Haiku) so we can measure whether quality actually improves as the learning
// features (memory, PMI, feedback-distill) are armed. It is a MEASUREMENT tool run on demand
// (`npm run eval:judge`) — never in the request path, and non-deterministic ⇒ NOT a CI gate. The judge
// call goes through the normal AiPort, so integration tests inject a fake port (no key, deterministic).

// Overall (mean of the three) at/above this passes. On a 1–5 scale, 3.5 = "solidly acceptable".
export const JUDGE_PASS = Number(process.env.AI_JUDGE_PASS) || 3.5;

export interface JudgeScore {
  groundedness: number; // 1–5: sticks to given/known facts, no fabrication
  helpfulness: number;  // 1–5: actually answers the question, actionable
  clarity: number;      // 1–5: concise, well-structured, appropriate language
  overall: number;      // mean of the three
  pass: boolean;
  rationale: string;
}

// Anthropic's structured-output json_schema subset does NOT support minimum/maximum on integers — the
// 1–5 bound is enforced in the rubric prompt and clamped in code (clampScore) instead.
const RUBRIC_SCHEMA = {
  type: 'object',
  properties: {
    groundedness: { type: 'integer' },
    helpfulness: { type: 'integer' },
    clarity: { type: 'integer' },
    rationale: { type: 'string' },
  },
  required: ['groundedness', 'helpfulness', 'clarity', 'rationale'],
  additionalProperties: false,
} as const;

const RUBRIC_SYSTEM = `You are a strict, fair evaluator of a project-management assistant's answer. Score each dimension as an INTEGER 1–5:
- groundedness: sticks to the facts in the question/context and general PM knowledge; NO fabricated project codes, numbers, or standards. (5 = fully grounded, 1 = clearly fabricated.)
- helpfulness: directly answers what was asked and is actionable. (5 = complete & actionable, 1 = evasive/off-topic.)
- clarity: concise, well-structured, and in the same language as the question. (5 = crisp, 1 = confusing.)
Judge only what is shown. Give a ONE-sentence rationale. Do not reward length.`;

const clampScore = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(1, Math.min(5, v)) : 1;
};

// Score one answer. Returns null when the judge is unavailable / declined (caller treats as "unscored").
export async function judgeAnswer(input: { question: string; answer: string; context?: string }): Promise<JudgeScore | null> {
  const model = aiConfig().proactiveModel; // cheap judge (Haiku)
  const user = `Question:\n${input.question}\n\nAnswer:\n${input.answer}${input.context ? `\n\nContext:\n${input.context}` : ''}`;
  const raw = (await getAiPort().draftJson({
    system: RUBRIC_SYSTEM, user, jsonSchema: RUBRIC_SCHEMA, maxTokens: 400, model, feature: 'eval_judge',
  })) as { groundedness?: unknown; helpfulness?: unknown; clarity?: unknown; rationale?: unknown } | null;
  if (!raw) return null;
  const groundedness = clampScore(raw.groundedness);
  const helpfulness = clampScore(raw.helpfulness);
  const clarity = clampScore(raw.clarity);
  const overall = Math.round(((groundedness + helpfulness + clarity) / 3) * 100) / 100;
  return { groundedness, helpfulness, clarity, overall, pass: overall >= JUDGE_PASS, rationale: String(raw.rationale ?? '') };
}

export interface JudgeCase { name: string; question: string; answer: string; context?: string }
export interface JudgeScorecard {
  total: number;
  scored: number; // cases the judge actually returned a score for
  avg: { groundedness: number; helpfulness: number; clarity: number; overall: number };
  passRate: number; // scored cases passing / scored
  perCase: { name: string; score: JudgeScore | null }[];
}

// Run the judge over a set of (question, answer) cases and aggregate a scorecard. Unscored cases (judge
// declined) are excluded from the averages but counted in `total`.
export async function runJudgeEval(cases: JudgeCase[]): Promise<JudgeScorecard> {
  const perCase: { name: string; score: JudgeScore | null }[] = [];
  for (const c of cases) {
    let score: JudgeScore | null = null;
    try { score = await judgeAnswer({ question: c.question, answer: c.answer, context: c.context }); } catch { score = null; }
    perCase.push({ name: c.name, score });
  }
  const scores = perCase.map((p) => p.score).filter((s): s is JudgeScore => s != null);
  const n = scores.length || 1;
  const sum = (sel: (s: JudgeScore) => number) => scores.reduce((a, s) => a + sel(s), 0);
  const avg = {
    groundedness: Math.round((sum((s) => s.groundedness) / n) * 100) / 100,
    helpfulness: Math.round((sum((s) => s.helpfulness) / n) * 100) / 100,
    clarity: Math.round((sum((s) => s.clarity) / n) * 100) / 100,
    overall: Math.round((sum((s) => s.overall) / n) * 100) / 100,
  };
  const passRate = scores.length ? scores.filter((s) => s.pass).length / scores.length : 0;
  return { total: cases.length, scored: scores.length, avg, passRate, perCase };
}
