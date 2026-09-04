// AI-output graders (improvement #7). Deterministic checks that flag the regressions that matter most
// for Anett: inverted EVM interpretation, hallucinated project codes, and made-up menu/tab names. Pure
// functions — no model, no I/O — so they're CI-safe unit-testable AND reusable by the opt-in live-eval
// suite (aiEval.live.itest) that runs real questions through the model when AI_EVAL=1.

// Project codes the answer cites in `backticks`, normalized. Matches PRJ-1 / AI-12 style tokens only.
export function citedCodes(answer: string): string[] {
  const out = new Set<string>();
  for (const m of answer.matchAll(/`([A-Z][A-Z0-9]*-\d+)`/g)) out.add(m[1].toUpperCase());
  return [...out];
}

// Codes the answer cites that are NOT in the accessible set → hallucinated / cross-tenant leak signal.
export function ungroundedCodes(answer: string, accessibleCodes: string[]): string[] {
  const ok = new Set(accessibleCodes.map((c) => c.toUpperCase()));
  return citedCodes(answer).filter((c) => !ok.has(c));
}

// Tab/menu names the answer references ("tab Cost", "tab Anggaran") that aren't real tabs → invented
// navigation. `validTabs` is the caller's allowlist (case-insensitive). Only fires on the explicit
// "tab X" pattern so prose isn't over-flagged.
export function ungroundedTabs(answer: string, validTabs: string[]): string[] {
  const ok = new Set(validTabs.map((t) => t.toLowerCase()));
  const out = new Set<string>();
  // Tab names are proper nouns (Cost, Schedule, Anggaran) → require a Capitalized word after "tab",
  // so ordinary prose like "the tab was open" isn't flagged.
  for (const m of answer.matchAll(/\b[Tt]ab\s+([A-Z][\w-]*)/g)) {
    const name = m[1];
    if (!ok.has(name.toLowerCase())) out.add(name);
  }
  return [...out];
}

// Blatantly inverted EVM statements. EVM truth: SPI/CPI < 1 = behind/over; > 1 = good. We flag the
// clear contradictions (a "< 1 … good" or "> 1 … behind" within a short span). Heuristic — tuned to
// avoid false positives on normal prose, not to catch every phrasing.
const GOOD_WORDS = 'ahead|on track|on-track|good|healthy|under budget|di depan|lebih cepat|sesuai|baik|sehat|hemat';
const BAD_WORDS = 'behind|over budget|over-budget|late|delayed|bad|di belakang|terlambat|boros|melebihi';
export function evmInversions(answer: string): string[] {
  const issues: string[] = [];
  // Stop the window at clause boundaries (. ; newline) and keep it short, so a correct compound
  // sentence like "SPI < 1 = behind; CPI > 1 = under budget" doesn't cross-match the other clause.
  const below = new RegExp(`(SPI|CPI)\\s*<\\s*1[^.\\n;]{0,30}\\b(${GOOD_WORDS})\\b`, 'i');
  const above = new RegExp(`(SPI|CPI)\\s*>\\s*1[^.\\n;]{0,30}\\b(${BAD_WORDS})\\b`, 'i');
  if (below.test(answer)) issues.push('EVM inverted: an index < 1 described as good/ahead');
  if (above.test(answer)) issues.push('EVM inverted: an index > 1 described as behind/over-budget');
  return issues;
}

export interface GradeContext {
  accessibleCodes?: string[];
  validTabs?: string[];
}

// Combine the graders into a single verdict. `ok` is true when no issue fired.
export function gradeAnswer(answer: string, ctx: GradeContext = {}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (ctx.accessibleCodes) {
    const bad = ungroundedCodes(answer, ctx.accessibleCodes);
    if (bad.length) issues.push(`Ungrounded project code(s): ${bad.join(', ')}`);
  }
  if (ctx.validTabs) {
    const bad = ungroundedTabs(answer, ctx.validTabs);
    if (bad.length) issues.push(`Invented tab name(s): ${bad.join(', ')}`);
  }
  issues.push(...evmInversions(answer));
  return { ok: issues.length === 0, issues };
}
