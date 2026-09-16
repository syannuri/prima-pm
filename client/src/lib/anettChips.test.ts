import { describe, it, expect } from 'vitest';
import { selectChips, CHIP_POOL, type ChipCtx } from './anettChips';

const base: ChipCtx = { proj: false, propose: false, overdue: 0, approvals: 0, lang: 'id' };

describe('selectChips', () => {
  it('returns the requested count of distinct cards', () => {
    const chips = selectChips(base, 0);
    expect(chips).toHaveLength(3);
    expect(new Set(chips).size).toBe(3);
  });

  it('scopes to project cards when viewing a project', () => {
    const projectLabels = new Set(CHIP_POOL.filter((c) => c.scope === 'project').map((c) => c.label.id));
    for (const text of selectChips({ ...base, proj: true }, 5)) {
      expect(projectLabels.has(text)).toBe(true);
    }
  });

  it('hides the propose card unless actions are available', () => {
    const action = CHIP_POOL.find((c) => c.scope === 'portfolio' && c.propose)!.label.id;
    // Sweep enough seeds that rotation would surface it if it were eligible.
    const withoutPropose = Array.from({ length: 12 }, (_, s) => selectChips(base, s)).flat();
    expect(withoutPropose).not.toContain(action);
    const withPropose = Array.from({ length: 12 }, (_, s) => selectChips({ ...base, propose: true }, s)).flat();
    expect(withPropose).toContain(action);
  });

  it('pins the approval card first when approvals are waiting (intent order)', () => {
    const approval = CHIP_POOL.find((c) => c.intent === 'approval')!.label.id;
    expect(selectChips({ ...base, approvals: 2 }, 0)[0]).toBe(approval);
    expect(selectChips({ ...base, approvals: 2 }, 7)[0]).toBe(approval); // seed-independent lead
  });

  it('pins the overdue-tasks card first when tasks are late', () => {
    const schedule = CHIP_POOL.find((c) => c.scope === 'portfolio' && c.intent === 'schedule')!.label.id;
    expect(selectChips({ ...base, overdue: 4 }, 0)[0]).toBe(schedule);
  });

  it('ranks approvals above overdue when both are urgent', () => {
    const approval = CHIP_POOL.find((c) => c.intent === 'approval')!.label.id;
    expect(selectChips({ ...base, approvals: 1, overdue: 9 }, 0)[0]).toBe(approval);
  });

  it('rotates the non-urgent tail across seeds', () => {
    const a = selectChips(base, 0);
    const varied = Array.from({ length: 8 }, (_, s) => selectChips(base, s).join('|'));
    // At least one seed produces a different ordering/set than seed 0.
    expect(varied.some((v) => v !== a.join('|'))).toBe(true);
  });

  it('honours the language toggle', () => {
    const en = selectChips({ ...base, lang: 'en' }, 0);
    const enLabels = new Set(CHIP_POOL.map((c) => c.label.en));
    for (const text of en) expect(enLabels.has(text)).toBe(true);
  });
});
