import { describe, it, expect } from 'vitest';
import { runJudgeEvalByFeature } from '../../lib/aiJudge.js';
import { JUDGE_GOLDEN } from '../../lib/aiJudge.golden.js';

// LIVE per-feature quality report (phase 4). SKIPPED unless AI_EVAL=1 AND ANTHROPIC_API_KEY is set — so
// it never runs (or spends) in normal CI. Run it to get a pre-ship quality signal PER generative surface
// (briefings, review, EVM explainer, …) that does NOT depend on live traffic:
//   npm run eval:report   (= AI_EVAL=1 npm run test:integration -- --run aiJudgeReport.live)
// Prints an overall scorecard + one row per feature. Track the per-feature numbers across runs / before
// vs after a prompt change to see which surface moved — the offline complement to the live judge-trend
// dashboard (getJudgeTrend byFeature).
const LIVE = process.env.AI_EVAL === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!LIVE)('LLM-as-judge — live per-feature report (AI_EVAL=1)', () => {
  it('scores the golden set grouped by feature and prints a table', async () => {
    const report = await runJudgeEvalByFeature(JUDGE_GOLDEN);
    const o = report.overall;
    /* eslint-disable no-console */
    console.log(`\n[ai-eval:report] overall ${o.scored}/${o.total} · avg ${o.avg.overall}/5 (G ${o.avg.groundedness} · H ${o.avg.helpfulness} · C ${o.avg.clarity}) · pass ${(o.passRate * 100).toFixed(0)}%`);
    console.log('  feature              n   avg   pass   (G / H / C)');
    for (const [feature, c] of Object.entries(report.byFeature).sort((a, b) => b[1].total - a[1].total)) {
      const row = `${feature.padEnd(20)} ${String(c.total).padStart(2)}  ${c.avg.overall.toFixed(2)}  ${(c.passRate * 100).toFixed(0).padStart(3)}%  (${c.avg.groundedness.toFixed(1)} / ${c.avg.helpfulness.toFixed(1)} / ${c.avg.clarity.toFixed(1)})`;
      console.log(`  ${row}`);
    }
    /* eslint-enable no-console */
    expect(o.scored, 'the judge returned at least one score').toBeGreaterThan(0);
    // Sanity: the strong-answer surfaces should clearly outscore the deliberately-weak chat cases.
    const strong = report.byFeature.evm_explain?.avg.overall ?? 0;
    expect(strong, 'a grounded EVM explainer scores solidly').toBeGreaterThan(3);
  }, 300_000);
});
