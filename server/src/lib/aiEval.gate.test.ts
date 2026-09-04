import { describe, it, expect } from 'vitest';
import { scoreGoldenSet } from './aiEval.js';
import { GOLDEN_CASES } from './aiEval.golden.js';

// The eval GATE (improvement #4): fails the build if the graders regress against the checked-in golden
// set. Deterministic + CI-safe (no model, no key). `npm run eval` runs exactly this file and prints a
// scorecard. The bar is 100% — every curated example must be graded as labelled; a drift is a bug.
const PASS_THRESHOLD = 1.0;

describe('AI eval gate — grader golden set', () => {
  it(`classifies the golden set at ≥ ${PASS_THRESHOLD * 100}% (no regression)`, () => {
    const score = scoreGoldenSet(GOLDEN_CASES);
    // Scorecard — surfaced in the eval run output.
    // eslint-disable-next-line no-console
    console.log(`\n[ai-eval] scorecard: ${score.passed}/${score.total} (${(score.rate * 100).toFixed(0)}%)`);
    if (score.failures.length) {
      // eslint-disable-next-line no-console
      console.error('[ai-eval] regressions:\n' + score.failures.map((f) => `  ✗ ${f.name} — expected ok=${f.expectedOk}, got ok=${f.gotOk} [${f.issues.join('; ')}]`).join('\n'));
    }
    expect(score.rate).toBeGreaterThanOrEqual(PASS_THRESHOLD);
  });

  it('the golden set actually exercises every grader (has both pass and fail cases)', () => {
    expect(GOLDEN_CASES.some((c) => c.expectOk)).toBe(true);
    expect(GOLDEN_CASES.some((c) => !c.expectOk)).toBe(true);
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(8);
  });
});
