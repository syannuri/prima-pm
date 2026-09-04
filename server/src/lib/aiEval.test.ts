import { describe, it, expect } from 'vitest';
import { citedCodes, ungroundedCodes, ungroundedTabs, evmInversions, gradeAnswer } from './aiEval.js';

// Graders for the AI eval harness (#7) — deterministic, no model. Proves each grader catches the
// regression it targets and doesn't over-flag correct answers.
describe('aiEval graders', () => {
  it('extracts and grounds cited project codes', () => {
    expect(citedCodes('Look at `AI-1` and `PRJ-12`, ignore prose-1 and lowercase `ai-2`.')).toEqual(['AI-1', 'PRJ-12']);
    expect(ungroundedCodes('`AI-1` and `PRJ-9`', ['AI-1', 'AI-2'])).toEqual(['PRJ-9']);
    expect(ungroundedCodes('`AI-1`', ['ai-1'])).toEqual([]); // case-insensitive
  });

  it('flags invented tab names only on the explicit "tab X" pattern', () => {
    expect(ungroundedTabs('Go to tab Cost then tab Bogus.', ['Cost', 'Schedule'])).toEqual(['Bogus']);
    expect(ungroundedTabs('The cost of the tab was high.', ['Cost'])).toEqual([]); // lowercase prose after "tab" is not flagged
    expect(ungroundedTabs('Open tab Schedule.', ['Cost', 'Schedule'])).toEqual([]);
  });

  it('catches inverted EVM interpretation (both directions, EN + ID)', () => {
    expect(evmInversions('Since SPI < 1 the project is ahead of schedule.')).toHaveLength(1);
    expect(evmInversions('CPI > 1 means you are over budget.')).toHaveLength(1);
    expect(evmInversions('Karena SPI < 1 proyek berjalan baik.')).toHaveLength(1);
    // Correct interpretation → no issue.
    expect(evmInversions('SPI < 1 means behind schedule; CPI > 1 means under budget.')).toEqual([]);
  });

  it('gradeAnswer returns ok only when nothing fires', () => {
    const good = gradeAnswer('Project `AI-1` has SPI < 1, so it is behind schedule. Check tab Cost.', { accessibleCodes: ['AI-1'], validTabs: ['Cost'] });
    expect(good.ok).toBe(true);
    const bad = gradeAnswer('Project `ZZ-9` has SPI < 1 so it is on track. See tab Bogus.', { accessibleCodes: ['AI-1'], validTabs: ['Cost'] });
    expect(bad.ok).toBe(false);
    expect(bad.issues.length).toBeGreaterThanOrEqual(3); // ungrounded code + invented tab + EVM inversion
  });
});
