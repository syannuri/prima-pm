import { describe, it, expect } from 'vitest';
import { runJudgeEval } from '../../lib/aiJudge.js';
import { JUDGE_GOLDEN } from '../../lib/aiJudge.golden.js';

// LIVE LLM-as-judge scorecard (round-5 #1). SKIPPED unless AI_EVAL=1 AND ANTHROPIC_API_KEY is set — so
// it never runs (or spends) in normal CI. Run it to measure answer quality with the cheap judge:
//   npm run eval:judge   (= AI_EVAL=1 npm run test:integration -- --run aiJudge.live)
// Prints an aggregate scorecard + per-case verdict. Track the numbers across runs to see whether the
// learning features (memory / PMI / feedback-distill) actually move quality.
const LIVE = process.env.AI_EVAL === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!LIVE)('LLM-as-judge — live scorecard (AI_EVAL=1)', () => {
  it('scores the golden set and prints a scorecard', async () => {
    const card = await runJudgeEval(JUDGE_GOLDEN);
    // eslint-disable-next-line no-console
    console.log(`\n[ai-judge] scored ${card.scored}/${card.total} · avg overall ${card.avg.overall}/5 (G ${card.avg.groundedness} · H ${card.avg.helpfulness} · C ${card.avg.clarity}) · pass ${(card.passRate * 100).toFixed(0)}%`);
    for (const p of card.perCase) {
      // eslint-disable-next-line no-console
      console.log(`  ${p.score?.pass ? '✓' : '✗'} ${p.name} — ${p.score ? `${p.score.overall}/5` : 'unscored'} ${p.score?.rationale ?? ''}`);
    }
    expect(card.scored, 'the judge returned at least one score').toBeGreaterThan(0);
    // Sanity: a correct answer should outscore a deliberately-inverted one.
    const good = card.perCase.find((p) => p.name.startsWith('good: correct EVM'))?.score?.overall ?? 0;
    const bad = card.perCase.find((p) => p.name.startsWith('weak: inverted EVM'))?.score?.overall ?? 5;
    expect(good, 'a correct answer outscores an inverted one').toBeGreaterThan(bad);
  }, 180_000);
});
