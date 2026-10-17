import { describe, it, expect } from 'vitest';
import { isQualityAnswerFeature } from './aiJudgeSample.js';

// Guards the quality-sampling allowlist (#5 phase 1). The choke-point hook in lib/ai.ts samples a
// draftJson answer ONLY when isQualityAnswerFeature is true, so this is the gate that keeps the judge
// from judging itself (recursion/cost) and from scoring non-prose internal calls.
describe('isQualityAnswerFeature', () => {
  it('includes every user-facing answer surface', () => {
    for (const f of [
      'narrative', 'proactive', 'cr_impact', 'evm_explain', 'risk_suggest',
      'portfolio_qa', 'review', 'schedule_suggest', 'whatif', 'resource_realloc',
    ]) {
      expect(isQualityAnswerFeature(f)).toBe(true);
    }
  });

  it('excludes the judge itself (prevents recursion) and non-answer features', () => {
    for (const f of ['eval_judge', 'data_extract', 'memory_distill', 'feedback_distill', 'assistant_qa', 'unknown']) {
      expect(isQualityAnswerFeature(f)).toBe(false);
    }
  });

  it('is false for missing/empty feature', () => {
    expect(isQualityAnswerFeature(undefined)).toBe(false);
    expect(isQualityAnswerFeature(null)).toBe(false);
    expect(isQualityAnswerFeature('')).toBe(false);
  });
});
