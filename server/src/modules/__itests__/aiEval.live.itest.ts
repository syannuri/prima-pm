import { describe, it, expect } from 'vitest';
import { getAiPort } from '../../lib/ai.js';
import { evmInversions } from '../../lib/aiEval.js';

// LIVE AI eval harness (#7). SKIPPED unless AI_EVAL=1 AND ANTHROPIC_API_KEY is set — so it never runs
// (or spends) in normal CI. Run it before a deploy to catch model-quality regressions:
//   AI_EVAL=1 ANTHROPIC_API_KEY=sk-... npm run test:integration -- --run aiEval.live
// Each case sends a real question to the model and grades the CONCLUSION (correct EVM direction),
// plus the structural evmInversions grader. Add cases as new regressions are found.
const LIVE = process.env.AI_EVAL === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

const SYSTEM = 'You are a project-management assistant. EVM rule: SPI/CPI < 1 = behind schedule / over budget; > 1 = ahead / under budget. Answer in ONE sentence.';

const cases: { name: string; q: string; expect: RegExp; forbid: RegExp }[] = [
  { name: 'SPI 0.8, CPI 0.9 → behind + over', q: 'A project has SPI 0.8 and CPI 0.9. Is it ahead or behind schedule, and over or under budget?', expect: /behind|over budget/i, forbid: /\bahead\b|under budget/i },
  { name: 'SPI 1.2, CPI 1.1 (ID) → cepat + hemat', q: 'Sebuah proyek punya SPI 1.2 dan CPI 1.1. Apakah lebih cepat atau terlambat, dan hemat atau boros?', expect: /lebih cepat|hemat|di depan/i, forbid: /terlambat|boros/i },
];

describe.skipIf(!LIVE)('AI eval — live EVM interpretation (AI_EVAL=1)', () => {
  for (const c of cases) {
    it(c.name, async () => {
      const port = getAiPort();
      const ans = await port.runToolLoop!({
        system: SYSTEM,
        messages: [{ role: 'user', content: c.q }],
        tools: [], executeTool: async () => '{}', maxSteps: 1, feature: 'assistant_qa',
      });
      expect(ans, 'model returned an answer').toBeTruthy();
      expect(ans!, 'reaches the correct conclusion').toMatch(c.expect);
      expect(ans!, 'does not state the opposite').not.toMatch(c.forbid);
      expect(evmInversions(ans!), 'no structural EVM inversion').toEqual([]);
    }, 60_000);
  }
});
