import { describe, it, expect } from 'vitest';
import { selectChips, resolveFollowups, citedLinks, CHIP_POOL, type ChipCtx } from './anettChips';

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

describe('resolveFollowups (contextual follow-up chips)', () => {
  const STATIC = ['Summarize my portfolio', 'What is waiting for my approval?'];
  const codes = new Set(['AI-1', 'AI-2']);
  const base = { accessibleCodes: codes, priorQuestions: [] as string[], lang: 'en' as const, staticFallback: STATIC };

  it('prefers the model suggestions when present and grounded (origin=model)', () => {
    const out = resolveFollowups({ ...base, answer: 'done', modelFollowups: ['Any pending change requests?', 'Next step?'] });
    expect(out).toEqual({ items: ['Any pending change requests?', 'Next step?'], origin: 'model' });
  });

  it('drops a suggestion that names an inaccessible project code (grounding)', () => {
    const out = resolveFollowups({ ...base, answer: 'x', modelFollowups: ['How is `AI-9` doing?', 'How is `AI-1` doing?'] });
    expect(out.items).toEqual(['How is `AI-1` doing?']); // AI-9 is not accessible → dropped
  });

  it('dedups a suggestion already asked earlier in the session', () => {
    const out = resolveFollowups({ ...base, priorQuestions: ['Summarize my portfolio'], answer: 'x', modelFollowups: ['summarize my portfolio', 'Which project is riskiest?'] });
    expect(out.items).toEqual(['Which project is riskiest?']);
  });

  it('falls back to citation-derived follow-ups when the model emits none (origin=derived)', () => {
    const answer = 'PRJ is behind [[cite:AI-1|Schedule|t123]] and a risk is high [[cite:AI-1|Risk|r9]].';
    const out = resolveFollowups({ ...base, answer, modelFollowups: [] });
    expect(out.origin).toBe('derived');
    expect(out.items.some((q) => /critical path/i.test(q))).toBe(true);   // from Schedule cite
    expect(out.items.some((q) => /mitigation/i.test(q))).toBe(true);      // from Risk cite
  });

  it('falls back to the static list when there is nothing contextual (origin=static)', () => {
    const out = resolveFollowups({ ...base, answer: 'A plain answer with no citations.', modelFollowups: [] });
    expect(out).toEqual({ items: STATIC, origin: 'static' });
  });
});

describe('citedLinks (navigational follow-up chips)', () => {
  it('extracts distinct code+source deep-link targets with the row id', () => {
    const answer = 'Behind [[cite:AI-1|Schedule|t123]], risk high [[cite:AI-1|Risk|r9]], aggregate [[cite:AI-2|Cost]].';
    const links = citedLinks(answer, 5);
    expect(links).toEqual([
      { code: 'AI-1', source: 'Schedule', entityId: 't123' },
      { code: 'AI-1', source: 'Risk', entityId: 'r9' },
      { code: 'AI-2', source: 'Cost', entityId: undefined },
    ]);
  });
  it('dedups repeats and caps the count', () => {
    const answer = '[[cite:AI-1|Risk|a]] [[cite:AI-1|Risk|b]] [[cite:AI-2|Cost]] [[cite:AI-3|Schedule|x]]';
    const links = citedLinks(answer, 2);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ code: 'AI-1', source: 'Risk' }); // first wins; duplicate dropped
  });
  it('returns [] when there are no citations', () => {
    expect(citedLinks('a plain answer')).toEqual([]);
  });
});
