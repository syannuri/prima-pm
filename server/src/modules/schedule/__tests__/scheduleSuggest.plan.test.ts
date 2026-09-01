import { describe, it, expect } from 'vitest';
import {
  planScheduleRows,
  buildScheduleSuggestPrompt,
  ScheduleDraftSchema,
  ApplyScheduleDraftSchema,
  type ScheduleDraft,
} from '../scheduleSuggest.service.js';

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
