import 'dotenv/config'; // load server/.env so the live judge/eval sees the real ANTHROPIC_API_KEY
import { defineConfig } from 'vitest/config';

// Live LLM-judge / eval runner (eval:live, eval:judge, eval:report). SEPARATE from the integration
// config on purpose: that one's setup force-blanks ANTHROPIC_API_KEY to keep the DB-backed suite
// dormant, which also made these live-eval suites skip forever. These *.live.itest files only need the
// AI port + golden set (no DB, no app), so here we DON'T blank the key — we load .env and run them.
// Still gated by AI_EVAL=1 (set in the npm script) + the key being present; each file skips otherwise,
// so this never runs or spends in CI. The judge is the cheap model (Haiku) — a full run is a few cents.
export default defineConfig({
  test: {
    include: ['src/modules/__itests__/*.live.itest.ts'],
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 30_000,
  },
});
