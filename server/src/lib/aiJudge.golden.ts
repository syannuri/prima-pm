import type { JudgeCase } from './aiJudge.js';

// Golden Q&A set for the LLM-as-judge eval (round-5 #1; per-feature in phase 4). A mix of strong answers
// and deliberately weak ones so `npm run eval:judge` / `eval:report` produce a meaningful spread — and a
// sanity check that the judge scores good answers high and bad ones low. These are the ANSWERS being
// judged (reference cases, NOT Anett's live output) — the point is a pre-ship quality signal per
// generative surface that doesn't depend on live traffic. Each case is tagged with the `feature` it
// represents so runJudgeEvalByFeature can roll up a scorecard per surface. The `context` mirrors the
// grounding data the feature would have had, so groundedness is judged fairly. Extend as gaps appear.
export const JUDGE_GOLDEN: JudgeCase[] = [
  // ---- assistant_qa (Anett chat) ----
  {
    name: 'good: correct EVM reading',
    feature: 'assistant_qa',
    question: 'My project has SPI 0.85 and CPI 0.92. How is it doing?',
    answer: 'SPI 0.85 (< 1) means you are behind schedule, and CPI 0.92 (< 1) means you are over budget. Focus on the critical path to recover the schedule and review the cost variance drivers.',
  },
  {
    name: 'good: grounded how-to',
    feature: 'assistant_qa',
    question: 'How do I lock the cost baseline?',
    answer: 'Open the project → Cost tab → Baseline → click "Lock baseline". This freezes schedule and cost together as the EVM reference.',
  },
  {
    name: 'good: concise bilingual',
    feature: 'assistant_qa',
    question: 'Apa arti SPI di bawah 1?',
    answer: 'SPI di bawah 1 berarti proyek berjalan lebih lambat dari rencana (di belakang jadwal).',
  },
  {
    name: 'weak: inverted EVM (should score low on groundedness)',
    feature: 'assistant_qa',
    question: 'My project has SPI 0.7. Is that good?',
    answer: 'Yes, SPI 0.7 is good — the project is ahead of schedule and running efficiently.',
  },
  {
    name: 'weak: evasive/unhelpful (should score low on helpfulness)',
    feature: 'assistant_qa',
    question: 'Which of my projects are over budget?',
    answer: 'There are many factors that affect a budget, and every project is different, so it depends.',
  },

  // ---- proactive (weekly status briefing) ----
  {
    name: 'good: grounded weekly briefing',
    feature: 'proactive',
    question: 'Draft a weekly status briefing for project DRC-1.',
    context: 'DRC-1: SPI=0.88 CPI=1.04 BAC=4,200,000,000 EV=2,310,000,000 % complete=55. 2 tasks slipped on the critical path this week.',
    answer: 'DRC-1 is slightly behind schedule but on budget. SPI 0.88 (< 1) reflects two critical-path tasks that slipped this week; CPI 1.04 shows spend is tracking plan. At 55% complete the priority is recovering the critical path — re-sequence the two slipped tasks and confirm resourcing before the slip compounds.',
  },
  {
    name: 'weak: briefing ignores the numbers (low groundedness)',
    feature: 'proactive',
    question: 'Draft a weekly status briefing for project DRC-1.',
    context: 'DRC-1: SPI=0.88 CPI=1.04 BAC=4,200,000,000 % complete=55. 2 tasks slipped on the critical path.',
    answer: 'DRC-1 is going great — everything is ahead of schedule and well under budget, no concerns at all this week.',
  },

  // ---- review (project audit narrative) ----
  {
    name: 'good: prioritized review narrative',
    feature: 'review',
    question: 'Summarize the audit findings for project NET-2 and what to do first.',
    context: 'Findings: (1) cost baseline not locked; (2) 3 high risks without mitigation owners; (3) charter missing success criteria.',
    answer: 'Top priority: lock the cost baseline so EVM has a reference. Next, assign mitigation owners to the three high risks — unowned high risks are the most likely to turn into issues. Finally, add measurable success criteria to the charter so scope and acceptance are testable.',
  },

  // ---- evm_explain (EVM explainer) ----
  {
    name: 'good: EVM explainer grounded in the figures',
    feature: 'evm_explain',
    question: "Explain this project's EVM status in plain language.",
    context: 'EV=1,800,000,000 AC=2,000,000,000 PV=2,100,000,000 BAC=3,600,000,000 → SPI=0.857 CPI=0.9 VAC negative.',
    answer: 'You have delivered Rp 1.8B of value (EV) against Rp 2.1B planned (PV), so SPI 0.86 means you are behind schedule. You spent Rp 2.0B to earn that value, so CPI 0.90 means you are over budget. If the current cost efficiency holds, the estimate at completion exceeds the Rp 3.6B budget — expect an overrun unless efficiency improves.',
  },

  // ---- cr_impact (change-request impact) ----
  {
    name: 'good: CR impact assessment',
    feature: 'cr_impact',
    question: 'Assess the schedule and cost impact of adding a new integration work package.',
    context: 'CR adds 20 person-days on the critical path; current finish 2026-12-01; budget remaining Rp 300,000,000; new WP est. Rp 180,000,000.',
    answer: 'The CR lands on the critical path, so the 20 person-days push the finish date out by roughly four weeks unless the work is parallelized or fast-tracked. Cost impact is about Rp 180M against Rp 300M remaining — affordable, but it leaves little contingency. Recommend approving only with a re-baseline and a fast-tracking plan for the dependent tasks.',
  },

  // ---- risk_suggest (risk register suggestions) ----
  {
    name: 'good: actionable risk suggestions',
    feature: 'risk_suggest',
    question: 'Suggest risks for a greenfield network rollout across 12 sites.',
    context: 'Category: network/infra. No existing register entries. Vendor hardware lead time historically long.',
    answer: 'Key risks: (1) vendor hardware lead-time slippage delaying site cutovers — mitigate with early ordering and a buffer stock; (2) site-readiness dependencies (power/cabling) not complete before install crews arrive — mitigate with a per-site readiness gate; (3) configuration drift across 12 sites — mitigate with a golden config template and automated validation.',
  },

  // ---- schedule_suggest (schedule / WBS draft) ----
  {
    name: 'good: phased WBS draft',
    feature: 'schedule_suggest',
    question: 'Draft a high-level WBS for a data-center migration.',
    context: 'Charter goals: migrate 40 workloads, zero data loss, 8-week window.',
    answer: 'Phase 1 Discovery & dependency mapping (1 wk). Phase 2 Target build & network readiness (2 wks). Phase 3 Pilot migration of low-risk workloads + validation (1 wk). Phase 4 Wave migrations in batches with rollback points (3 wks). Phase 5 Decommission & hypercare (1 wk). Sequencing keeps the 8-week window with validation gates between waves to protect the zero-data-loss goal.',
  },

  // ---- whatif (forecast what-if) ----
  {
    name: 'good: what-if narrative on real numbers',
    feature: 'whatif',
    question: 'What happens to the finish date if we add two developers next sprint?',
    context: 'Remaining effort 160 person-days; current team 4; CPI 0.95; critical path is development-bound.',
    answer: 'Because the critical path is development-bound, adding two developers raises capacity from 4 to 6, cutting remaining duration by roughly a third if onboarding is quick. Expect the finish date to pull in by about two to three weeks. Note the CPI of 0.95 means cost will rise proportionally — the trade is schedule recovery for added labour cost.',
  },

  // ---- resource_realloc (resource reallocation) ----
  {
    name: 'good: resource reallocation proposal',
    feature: 'resource_realloc',
    question: 'How should I resolve the over-allocation of the lead engineer next month?',
    context: 'Lead engineer at 140% in November across PRJ-A (critical path) and PRJ-B (float 15 days).',
    answer: "The lead engineer is 40% over capacity in November. PRJ-B has 15 days of float, so shift its non-urgent tasks later or reassign them to a second engineer, keeping the lead focused on PRJ-A's critical path. That brings the allocation back under 100% without affecting either finish date, since PRJ-B's float absorbs the delay.",
  },

  // ---- portfolio_qa (portfolio attention / Q&A) ----
  {
    name: 'good: portfolio attention summary',
    feature: 'portfolio_qa',
    question: 'Which projects need attention this week and why?',
    context: 'PRJ-A SPI 0.78 (behind); PRJ-C CPI 0.85 (over budget); PRJ-D high risk unmitigated; others green.',
    answer: 'Three need attention. PRJ-A is behind schedule (SPI 0.78) — check the critical path. PRJ-C is over budget (CPI 0.85) — review cost drivers and forecast. PRJ-D has an unmitigated high risk — assign an owner and a mitigation. The remaining projects are green and need no action this week.',
  },
];
