import { describe, it, expect } from 'vitest';
import {
  autoSchedule,
  addWorkingDays,
  workingDaysBetween,
  isWorkingDay,
  type AutoTaskInput,
  type CpmEdgeInput,
} from './schedule.helpers.js';

// Anchor dates on known weekdays (all UTC midnight):
//   2026-06-01 = Monday. Weekend = 2026-06-06 (Sat) / 2026-06-07 (Sun).
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ms = (iso: string) => +d(iso);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const task = (id: string, start: string, end: string): AutoTaskInput => ({ id, planStart: d(start), planEnd: d(end) });
const edge = (predecessorId: string, successorId: string, type: CpmEdgeInput['type'] = 'FS', lagDays = 0): CpmEdgeInput =>
  ({ predecessorId, successorId, type, lagDays });

describe('working-day date helpers', () => {
  it('flags Mon–Fri as working and the weekend as not', () => {
    expect(isWorkingDay(ms('2026-06-01'))).toBe(true);  // Mon
    expect(isWorkingDay(ms('2026-06-05'))).toBe(true);  // Fri
    expect(isWorkingDay(ms('2026-06-06'))).toBe(false); // Sat
    expect(isWorkingDay(ms('2026-06-07'))).toBe(false); // Sun
  });

  it('addWorkingDays skips the weekend', () => {
    expect(iso(addWorkingDays(ms('2026-06-05'), 1))).toBe('2026-06-08'); // Fri +1 → Mon
    expect(iso(addWorkingDays(ms('2026-06-01'), 5))).toBe('2026-06-08'); // Mon +5 → next Mon
    expect(iso(addWorkingDays(ms('2026-06-06'), 1))).toBe('2026-06-08'); // Sat +1 → Mon
    expect(iso(addWorkingDays(ms('2026-06-01'), 0))).toBe('2026-06-01'); // +0 keeps the base
  });

  it('addWorkingDays goes backward too', () => {
    expect(iso(addWorkingDays(ms('2026-06-08'), -1))).toBe('2026-06-05'); // Mon -1 → Fri
    expect(iso(addWorkingDays(ms('2026-06-08'), -5))).toBe('2026-06-01'); // Mon -5 → prev Mon
  });

  it('workingDaysBetween counts the half-open span', () => {
    expect(workingDaysBetween(ms('2026-06-01'), ms('2026-06-04'))).toBe(3); // Mon,Tue,Wed
    expect(workingDaysBetween(ms('2026-06-05'), ms('2026-06-08'))).toBe(1); // Fri only ([Fri,Mon))
    expect(workingDaysBetween(ms('2026-06-01'), ms('2026-06-01'))).toBe(0); // milestone
  });

  // DoS guard (security M1): out-of-range inputs must NOT loop unboundedly. These finish instantly
  // because of the hard iteration caps; a regression would hang the test (and the event loop).
  it('caps addWorkingDays so a huge lag cannot spin the event loop', () => {
    const r = addWorkingDays(ms('2026-06-01'), 1_000_000_000);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBe(addWorkingDays(ms('2026-06-01'), 100_000)); // both clamp to the same cap
  });
  it('caps workingDaysBetween so an out-of-range span cannot spin the event loop', () => {
    const r = workingDaysBetween(ms('2026-06-01'), +new Date('9999-01-01T00:00:00.000Z'));
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeLessThanOrEqual(420_000);
  });
});

describe('autoSchedule', () => {
  it('no edges → nothing moves', () => {
    const r = autoSchedule([task('A', '2026-06-01', '2026-06-03'), task('B', '2026-06-01', '2026-06-02')], []);
    expect(r.moved).toEqual([]);
    expect(r.cyclic).toBe(false);
  });

  it('does nothing when a satisfied FS link is honoured (push-only leaves slack alone)', () => {
    // A: Mon–Wed (dur 2), B: Fri–Mon. A finishes Wed; B already starts Fri → legal, no push.
    const r = autoSchedule(
      [task('A', '2026-06-01', '2026-06-03'), task('B', '2026-06-05', '2026-06-08')],
      [edge('A', 'B')],
    );
    expect(r.moved).toEqual([]);
    expect(iso(r.tasks.B.start)).toBe('2026-06-05');
  });

  it('pushes a violating FS successor to the predecessor finish (weekend-aware)', () => {
    // A: Mon–Fri (dur 4, finishes Fri 06-05). B starts Mon 06-01 (violates) → push to Fri, keep 2-day dur.
    const r = autoSchedule(
      [task('A', '2026-06-01', '2026-06-05'), task('B', '2026-06-01', '2026-06-03')],
      [edge('A', 'B')],
    );
    expect(r.moved).toEqual(['B']);
    expect(iso(r.tasks.B.start)).toBe('2026-06-05'); // = A's finish
    expect(iso(r.tasks.B.end)).toBe('2026-06-09');   // Fri +2 wd = Tue (skips the weekend)
  });

  it('applies a finish-to-start lag in working days', () => {
    // A finishes Wed 06-03; +2 wd lag → B starts Fri 06-05.
    const r = autoSchedule(
      [task('A', '2026-06-01', '2026-06-03'), task('B', '2026-06-01', '2026-06-02')],
      [edge('A', 'B', 'FS', 2)],
    );
    expect(iso(r.tasks.B.start)).toBe('2026-06-05');
  });

  it('cascades a push through a chain A→B→C', () => {
    // A grows to finish Fri 06-05; B (dur1) → Fri..Mon; C (dur1) → Mon..Tue.
    const r = autoSchedule(
      [
        task('A', '2026-06-01', '2026-06-05'),
        task('B', '2026-06-01', '2026-06-02'),
        task('C', '2026-06-02', '2026-06-03'),
      ],
      [edge('A', 'B'), edge('B', 'C')],
    );
    expect(r.moved.sort()).toEqual(['B', 'C']);
    expect(iso(r.tasks.B.start)).toBe('2026-06-05');
    expect(iso(r.tasks.C.start)).toBe('2026-06-08'); // Fri +1wd = Mon
  });

  it('honours a start-to-start link', () => {
    // SS: B cannot start before A starts (+0 lag). A at Wed, B at Mon → push B to Wed.
    const r = autoSchedule(
      [task('A', '2026-06-03', '2026-06-05'), task('B', '2026-06-01', '2026-06-02')],
      [edge('A', 'B', 'SS')],
    );
    expect(iso(r.tasks.B.start)).toBe('2026-06-03');
  });

  it('honours a finish-to-finish link', () => {
    // FF: B must finish no earlier than A. A finishes Fri 06-05. B dur1 → must end Fri → start Thu.
    const r = autoSchedule(
      [task('A', '2026-06-01', '2026-06-05'), task('B', '2026-06-01', '2026-06-02')],
      [edge('A', 'B', 'FF')],
    );
    expect(iso(r.tasks.B.end)).toBe('2026-06-05');
    expect(iso(r.tasks.B.start)).toBe('2026-06-04'); // Fri -1 wd = Thu
  });

  it('asap mode pulls a successor EARLIER to close a gap (compact)', () => {
    // A: Mon–Wed (finishes Wed 06-03). B sits far out at Fri 06-12 with slack.
    // push leaves B alone; asap pulls B back to hug A's finish (Wed).
    const tasks = [task('A', '2026-06-01', '2026-06-03'), task('B', '2026-06-12', '2026-06-15')];
    const edges = [edge('A', 'B')];
    expect(autoSchedule(tasks, edges, 'push').moved).toEqual([]);
    const asap = autoSchedule(tasks, edges, 'asap');
    expect(asap.moved).toEqual(['B']);
    expect(iso(asap.tasks.B.start)).toBe('2026-06-03'); // pulled back to A's finish
  });

  it('asap keeps a task with no predecessors anchored', () => {
    // Only B has a predecessor; A (root) must not be dragged to some project epoch.
    const tasks = [task('A', '2026-06-08', '2026-06-10'), task('B', '2026-06-15', '2026-06-17')];
    const asap = autoSchedule(tasks, [], 'asap');
    expect(asap.moved).toEqual([]); // no edges → nothing moves in either mode
    // with a link A→B, A stays put and B hugs A
    const withEdge = autoSchedule(tasks, [edge('A', 'B')], 'asap');
    expect(iso(withEdge.tasks.A.start)).toBe('2026-06-08'); // anchored
    expect(iso(withEdge.tasks.B.start)).toBe('2026-06-10'); // pulled to A's finish
  });

  it('leaves a cyclic network untouched and flags it', () => {
    const r = autoSchedule(
      [task('A', '2026-06-01', '2026-06-02'), task('B', '2026-06-01', '2026-06-02')],
      [edge('A', 'B'), edge('B', 'A')],
    );
    expect(r.cyclic).toBe(true);
    expect(r.moved).toEqual([]);
  });
});
