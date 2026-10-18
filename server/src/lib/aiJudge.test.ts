import { describe, it, expect, afterEach } from 'vitest';
import { __setAiPort, type AiPort } from './ai.js';
import { judgeAnswer, runJudgeEval, runJudgeEvalByFeature } from './aiJudge.js';
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
    expect(card.passRate).toBeGreaterThan(0.5); // mostly strong reference answers
    // The deliberately-weak answers fail; the matching strong one passes.
    expect(card.perCase.find((p) => p.name.startsWith('good: correct EVM'))?.score?.pass).toBe(true);
    expect(card.perCase.find((p) => p.name.startsWith('weak: inverted EVM'))?.score?.pass).toBe(false);
  });

  it('rolls up a per-feature report (phase 4): each surface gets its own scorecard', async () => {
    __setAiPort(gradingPort);
    const report = await runJudgeEvalByFeature(JUDGE_GOLDEN);
    // Overall matches the flat run.
    expect(report.overall.total).toBe(JUDGE_GOLDEN.length);
    // Every tagged feature in the golden set shows up as its own scorecard.
    expect(Object.keys(report.byFeature)).toEqual(
      expect.arrayContaining(['assistant_qa', 'proactive', 'review', 'evm_explain', 'portfolio_qa']),
    );
    // assistant_qa: 5 cases (3 strong, 2 weak) → 0.6 pass; proactive: 2 (1 strong, 1 weak) → 0.5.
    expect(report.byFeature.assistant_qa.total).toBe(5);
    expect(report.byFeature.assistant_qa.passRate).toBeCloseTo(0.6, 5);
    expect(report.byFeature.proactive.total).toBe(2);
    expect(report.byFeature.proactive.passRate).toBeCloseTo(0.5, 5);
    // A single all-strong surface scores 100%.
    expect(report.byFeature.evm_explain.passRate).toBe(1);
    // Sum of per-feature totals equals the overall total (every case counted once).
    const summed = Object.values(report.byFeature).reduce((n, c) => n + c.total, 0);
    expect(summed).toBe(report.overall.total);
  });
});
