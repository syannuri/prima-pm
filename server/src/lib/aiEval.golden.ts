import type { GoldenCase } from './aiEval.js';

// Golden regression set for the AI-output graders (improvement #4 — eval gate). A curated, checked-in
// set of representative Anett answers, each labelled with the verdict the graders MUST produce. It
// pins grader behaviour: if a future tweak to a grader starts passing a known-bad answer (or flagging
// a known-good one), `npm run eval` fails. Deterministic (no model, no key) → runs anywhere, no spend.
// The opt-in live suite (aiEval.live.itest, AI_EVAL=1) complements this by running real model output
// through the same graders.
export const GOLDEN_CASES: GoldenCase[] = [
  // ---- Should PASS (ok: true) — correct, grounded answers ----
  { name: 'plain answer, no codes/tabs', answer: 'The project is progressing well and the team is on schedule.', expectOk: true },
  { name: 'grounded code + valid tab', answer: 'Review the budget for `PRJ-1` in tab Cost.', ctx: { accessibleCodes: ['PRJ-1'], validTabs: ['Cost', 'Schedule'] }, expectOk: true },
  { name: 'correct EVM: SPI below 1 = behind', answer: 'SPI is 0.85, and an SPI < 1 means the project is behind schedule.', expectOk: true },
  { name: 'correct EVM: CPI above 1 = under budget', answer: 'CPI > 1 indicates the project is under budget — good news.', expectOk: true },
  { name: 'bilingual grounded answer (ID)', answer: 'Proyek `AI-2` sesuai jadwal; buka tab Anggaran untuk rinciannya.', ctx: { accessibleCodes: ['AI-2'], validTabs: ['Anggaran', 'Jadwal'] }, expectOk: true },
  { name: 'prose mentioning "tab" generically is not flagged', answer: 'I kept the tab open while reviewing the schedule.', ctx: { validTabs: ['Cost'] }, expectOk: true },

  // ---- Should FAIL (ok: false) — the regressions the gate exists to catch ----
  { name: 'hallucinated / cross-tenant code', answer: 'See project `PRJ-9` for the overrun details.', ctx: { accessibleCodes: ['PRJ-1'] }, expectOk: false },
  { name: 'invented tab name', answer: 'Open tab Wombat to change the baseline.', ctx: { validTabs: ['Cost', 'Schedule'] }, expectOk: false },
  { name: 'inverted EVM: index < 1 called good', answer: 'SPI < 1 here, which is good — the project is on track.', expectOk: false },
  { name: 'inverted EVM: index > 1 called behind', answer: 'CPI > 1, so the project is over budget and late.', expectOk: false },
];
