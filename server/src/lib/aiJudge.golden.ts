import type { JudgeCase } from './aiJudge.js';

// Golden Q&A set for the LLM-as-judge eval (round-5 #1). A mix of strong answers and deliberately weak
// ones, so `npm run eval:judge` produces a meaningful spread — and a sanity check that the judge scores
// good answers high and bad ones low. Extend as representative cases are found. These are the ANSWERS
// being judged (not Anett's live output) — the point is to measure the judge + track quality over runs.
export const JUDGE_GOLDEN: JudgeCase[] = [
  {
    name: 'good: correct EVM reading',
    question: 'My project has SPI 0.85 and CPI 0.92. How is it doing?',
    answer: 'SPI 0.85 (< 1) means you are behind schedule, and CPI 0.92 (< 1) means you are over budget. Focus on the critical path to recover the schedule and review the cost variance drivers.',
  },
  {
    name: 'good: grounded how-to',
    question: 'How do I lock the cost baseline?',
    answer: 'Open the project → Cost tab → Baseline → click "Lock baseline". This freezes schedule and cost together as the EVM reference.',
  },
  {
    name: 'good: concise bilingual',
    question: 'Apa arti SPI di bawah 1?',
    answer: 'SPI di bawah 1 berarti proyek berjalan lebih lambat dari rencana (di belakang jadwal).',
  },
  {
    name: 'weak: inverted EVM (should score low on groundedness)',
    question: 'My project has SPI 0.7. Is that good?',
    answer: 'Yes, SPI 0.7 is good — the project is ahead of schedule and running efficiently.',
  },
  {
    name: 'weak: evasive/unhelpful (should score low on helpfulness)',
    question: 'Which of my projects are over budget?',
    answer: 'There are many factors that affect a budget, and every project is different, so it depends.',
  },
];
