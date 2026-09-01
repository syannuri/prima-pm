import { describe, it, expect } from 'vitest';
import {
  planScheduleRows,
  planDependencies,
  fitDraftToWindow,
  buildScheduleSuggestPrompt,
  ScheduleDraftSchema,
  ApplyScheduleDraftSchema,
  type ScheduleDraft,
} from '../scheduleSuggest.service.js';

const sumDur = (d: ScheduleDraft) => d.phases.reduce((s, p) => s + p.tasks.reduce((t, tk) => t + tk.durationDays, 0), 0);

const DAY = 86_400_000;
const draft: ScheduleDraft = {
  phases: [
    { name: 'Planning', tasks: [
      { name: 'Requirements', durationDays: 5, deliverable: 'SRS' },
      { name: 'Design', durationDays: 5 },
    ] },
    { name: 'Execution', tasks: [
      { name: 'Kick-off', durationDays: 0, isMilestone: true },
      { name: 'Build', durationDays: 10, weight: 30 },
    ] },
  ],
};

describe('planScheduleRows — deterministic materialiser', () => {
  const start = new Date('2026-01-05T00:00:00.000Z');
  const { rows, projectedEnd } = planScheduleRows('proj-1', draft, start, 0, -1);
  const byName = (n: string) => rows.find((r) => r.name === n)!;

  it('emits 2 phases + 4 work packages, parents before children', () => {
    const parents = rows.filter((r) => r.parentTaskId === null);
    const children = rows.filter((r) => r.parentTaskId !== null);
    expect(parents).toHaveLength(2);
    expect(children).toHaveLength(4);
    expect(rows.slice(0, 2).every((r) => r.parentTaskId === null)).toBe(true); // parents first (FK order)
  });

  it('sequences calendar-day dates; a phase spans its work packages', () => {
    expect(byName('Requirements').planStart).toEqual(start);
    expect(+byName('Requirements').planEnd).toBe(+start + 5 * DAY);
    expect(+byName('Design').planStart).toBe(+start + 5 * DAY);
    expect(+byName('Design').planEnd).toBe(+start + 10 * DAY);
    // Phase parent spans first child start .. last child end.
    expect(byName('Planning').planStart).toEqual(start);
    expect(+byName('Planning').planEnd).toBe(+start + 10 * DAY);
    // Milestone has zero duration and does not advance the cursor.
    expect(byName('Kick-off').isMilestone).toBe(true);
    expect(+byName('Kick-off').planStart).toBe(+start + 10 * DAY);
    expect(+byName('Kick-off').planEnd).toBe(+start + 10 * DAY);
    expect(+byName('Build').planEnd).toBe(+start + 20 * DAY);
    expect(+projectedEnd).toBe(+start + 20 * DAY);
  });

  it('wires children to their phase and carries deliverable/weight/progress', () => {
    expect(byName('Requirements').parentTaskId).toBe(byName('Planning').id);
    expect(byName('Requirements').deliverable).toBe('SRS');
    expect(byName('Build').weight).toBe(30);
    expect(byName('Design').weight).toBeNull();
    expect(rows.every((r) => r.progressPct === 0)).toBe(true);
  });

  it('phase takes the first WBS code, then its work packages, in outline order', () => {
    expect(byName('Planning').wbsCode).toBe('T-001');
    expect(byName('Requirements').wbsCode).toBe('T-002');
    expect(byName('Design').wbsCode).toBe('T-003');
    expect(byName('Execution').wbsCode).toBe('T-004');
    // sortOrder is monotonic in outline order so buildGanttTree renders the nesting correctly.
    expect(byName('Planning').sortOrder).toBeLessThan(byName('Requirements').sortOrder);
    expect(byName('Requirements').sortOrder).toBeLessThan(byName('Execution').sortOrder);
  });

  it('appends: WBS codes and sortOrder continue from the existing schedule', () => {
    const appended = planScheduleRows('proj-1', draft, start, 6, 5); // 6 existing tasks, max sort 5
    expect(appended.rows.find((r) => r.name === 'Planning')!.wbsCode).toBe('T-007');
    expect(appended.rows.every((r) => r.sortOrder > 5)).toBe(true);
  });
});

describe('planDependencies — hybrid FS graph', () => {
  const start = new Date('2026-01-05T00:00:00.000Z');

  it('honours the AI graph (parallel branches + merge), mapped to created ids', () => {
    const linked: ScheduleDraft = {
      phases: [
        { name: 'P1', tasks: [
          { name: 'A', durationDays: 5, ref: 'a' },
          { name: 'B', durationDays: 5, ref: 'b', deps: ['a'] },
        ] },
        { name: 'P2', tasks: [
          { name: 'C', durationDays: 3, ref: 'c', deps: ['a'] }, // parallel with B
          { name: 'D', durationDays: 2, ref: 'd', deps: ['b', 'c'] }, // merge
        ] },
      ],
    };
    const { refToId, orderedLeafIds } = planScheduleRows('proj-1', linked, start, 0, -1);
    const edges = planDependencies(linked, refToId, orderedLeafIds);
    const has = (p: string, s: string) => edges.some((e) => e.predecessorId === refToId.get(p) && e.successorId === refToId.get(s));
    expect(edges).toHaveLength(4);
    expect(has('a', 'b')).toBe(true);
    expect(has('a', 'c')).toBe(true);
    expect(has('b', 'd')).toBe(true);
    expect(has('c', 'd')).toBe(true);
  });

  it('falls back to a sequential chain when the AI supplies no links', () => {
    const { refToId, orderedLeafIds } = planScheduleRows('proj-1', draft, start, 0, -1); // draft has no refs/deps
    const edges = planDependencies(draft, refToId, orderedLeafIds);
    expect(edges).toHaveLength(orderedLeafIds.length - 1); // 4 leaves → 3 links
    edges.forEach((e, i) => {
      expect(e.predecessorId).toBe(orderedLeafIds[i]);
      expect(e.successorId).toBe(orderedLeafIds[i + 1]);
    });
  });

  it('drops edges that would create a cycle, and dangling/self refs', () => {
    const cyclic: ScheduleDraft = {
      phases: [{ name: 'P', tasks: [
        { name: 'X', durationDays: 1, ref: 'x', deps: ['y', 'ghost', 'x'] }, // ghost dangling, x self
        { name: 'Y', durationDays: 1, ref: 'y', deps: ['x'] },
      ] }],
    };
    const { refToId, orderedLeafIds } = planScheduleRows('proj-1', cyclic, start, 0, -1);
    const edges = planDependencies(cyclic, refToId, orderedLeafIds);
    expect(edges).toHaveLength(1); // one of y→x / x→y kept, the cycle-closing one dropped
    expect(edges.every((e) => e.predecessorId !== e.successorId)).toBe(true);
  });
});

describe('fitDraftToWindow — hard-fit to the charter window', () => {
  const d: ScheduleDraft = {
    phases: [{ name: 'P', tasks: [
      { name: 'T1', durationDays: 10 },
      { name: 'MS', durationDays: 0, isMilestone: true },
      { name: 'T2', durationDays: 10 },
    ] }],
  };

  it('shrinks proportionally to exactly the window; milestones stay 0', () => {
    const out = fitDraftToWindow(d, 10); // half of 20
    expect(out.phases[0].tasks.map((t) => t.durationDays)).toEqual([5, 0, 5]);
    expect(sumDur(out)).toBe(10);
  });

  it('stretches to fill a larger window and folds the rounding residual (Σ == window)', () => {
    expect(sumDur(fitDraftToWindow(d, 30))).toBe(30);
    expect(sumDur(fitDraftToWindow(d, 11))).toBe(11); // 5.5→6,6 then −1 residual folded back
  });

  it('keeps every scaled task >= 1 day even for a tiny window', () => {
    const out = fitDraftToWindow(d, 1);
    out.phases[0].tasks.filter((t) => !t.isMilestone).forEach((t) => expect(t.durationDays).toBeGreaterThanOrEqual(1));
  });

  it('is a no-op for a non-positive window or an all-milestone draft', () => {
    expect(fitDraftToWindow(d, 0)).toBe(d);
    const allMs: ScheduleDraft = { phases: [{ name: 'P', tasks: [{ name: 'M', durationDays: 0, isMilestone: true }] }] };
    expect(fitDraftToWindow(allMs, 30)).toBe(allMs);
  });
});

describe('buildScheduleSuggestPrompt — language selection', () => {
  const ctx = {
    project: { code: 'P-1', name: 'Proj', approach: 'PREDICTIVE' },
    charter: {
      description: 'd', goals: 'g', category: 'IT', scope: 'scope text', deliverables: 'a, b',
      scheduleStart: new Date('2026-01-01'), scheduleEnd: new Date('2026-03-01'),
    },
    scheduleWorkingDaysBudget: 59,
  };

  it('English by default; Indonesian when lang="id"; payload is language-independent', () => {
    const en = buildScheduleSuggestPrompt(ctx, 'en');
    const id = buildScheduleSuggestPrompt(ctx, 'id');
    expect(en.system).toContain('project-management English');
    expect(id.system).toContain('Bahasa Indonesia');
    expect(en.system).not.toBe(id.system);
    expect(en.user).toBe(id.user);
    const payload = JSON.parse(en.user);
    expect(payload.scheduleWorkingDaysBudget).toBe(59);
    expect(payload.charter.scope).toBe('scope text');
  });
});

describe('draft schemas — bounds', () => {
  it('accepts a valid draft and rejects an over-cap one', () => {
    expect(ScheduleDraftSchema.safeParse(draft).success).toBe(true);
    const tooMany = { phases: Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, tasks: [{ name: 'x', durationDays: 1 }] })) };
    expect(ScheduleDraftSchema.safeParse(tooMany).success).toBe(false); // > 8 phases
  });

  it('apply schema carries an optional startDate', () => {
    const ok = ApplyScheduleDraftSchema.safeParse({ ...draft, startDate: '2026-01-05' });
    expect(ok.success).toBe(true);
  });
});
