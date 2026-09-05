import { describe, it, expect, afterEach } from 'vitest';
import { __setAiPort, type AiPort } from './ai.js';
import { judgeAnswer, runJudgeEval } from './aiJudge.js';
import { JUDGE_GOLDEN } from './aiJudge.golden.js';

// Deterministic tests for the judge aggregation/parsing (fake AiPort → no key, no network). The live
// judge run against the real model lives in aiJudge.live.itest (AI_EVAL=1).
const gradingPort: AiPort = {
  async draftJson({ user }) {
    // Deliberately-weak answers in the golden set score low; everything else scores high.
    const weak = /ahead of schedule|it depends|so it depends|depends\./i.test(user);
    return weak
      ? { groundedness: 2, helpfulness: 2, clarity: 4, rationale: 'weak' }
      : { groundedness: 5, helpfulness: 5, clarity: 5, rationale: 'strong' };
  },
  async draftNarrative() { return null; },
};

afterEach(() => __setAiPort(null));

describe('aiJudge', () => {
  it('scores one answer and computes overall + pass', async () => {
    __setAiPort(gradingPort);
    const good = await judgeAnswer({ question: 'q', answer: 'a solid grounded answer' });
    expect(good).not.toBeNull();
    expect(good!.overall).toBe(5);
    expect(good!.pass).toBe(true);
    const bad = await judgeAnswer({ question: 'q', answer: 'SPI 0.7 is good, you are ahead of schedule' });
    expect(bad!.overall).toBeCloseTo(2.67, 1);
    expect(bad!.pass).toBe(false);
  });

  it('returns null when the judge declines', async () => {
    __setAiPort({ async draftJson() { return null; }, async draftNarrative() { return null; } });
    expect(await judgeAnswer({ question: 'q', answer: 'a' })).toBeNull();
  });

  it('aggregates a scorecard over the golden set (good outscore weak)', async () => {
    __setAiPort(gradingPort);
    const card = await runJudgeEval(JUDGE_GOLDEN);
    expect(card.total).toBe(JUDGE_GOLDEN.length);
    expect(card.scored).toBe(JUDGE_GOLDEN.length);
    expect(card.passRate).toBeCloseTo(0.6, 5); // 3 good pass, 2 weak fail
    expect(card.avg.groundedness).toBe(3.8);   // (5·3 + 2·2)/5
    expect(card.perCase.find((p) => p.name.startsWith('good: correct EVM'))?.score?.pass).toBe(true);
    expect(card.perCase.find((p) => p.name.startsWith('weak: inverted EVM'))?.score?.pass).toBe(false);
  });
});
