import { describe, it, expect } from 'vitest';
import { bundleConflicts, type Contribution } from '../resourceConflicts.service.js';
import type { CapacityReport, ResourceRow, PeriodCell } from '../resource.helpers.js';

// Pure bundling: over-allocated resource-period → conflict with sorted contributions + eligible peers.
// The DB wiring + AI grounding are covered by resourceConflicts.itest.

const cell = (period: string, allocated: number, capacity: number): PeriodCell => ({
  period, allocated, capacity, utilization: capacity ? allocated / capacity : 0, over: allocated > capacity + 1e-6,
});
const row = (key: string, name: string, personnelRole: string | null, cells: PeriodCell[]): ResourceRow => ({
  key, name, personnelRole, totalPlanMandays: 0, earnedMandays: 0, consumedMandays: 0, scheduledMandays: 0,
  unscheduledMandays: 0, projects: [], cells, peakUtilization: Math.max(0, ...cells.map((c) => c.utilization)),
  overAllocated: cells.some((c) => c.over),
});
const report = (resources: ResourceRow[]): CapacityReport => ({
  from: '2026-03-01', to: '2026-03-31', granularity: 'month', periods: ['2026-03'], resources,
  summary: { resourceCount: resources.length, overAllocatedCount: 0, totalPlanMandays: 0, totalEarnedMandays: 0, totalConsumedMandays: 0 },
});

describe('bundleConflicts', () => {
  const contribs = new Map<string, Contribution[]>([
    ['R:a|2026-03', [
      { costItemId: 'ci1', taskName: 'Big task', projectId: 'p1', projectCode: 'P1', planMandaysInPeriod: 20 },
      { costItemId: 'ci2', taskName: 'Small task', projectId: 'p2', projectCode: 'P2', planMandaysInPeriod: 10 },
    ]],
  ]);

  it('flags the over-period with contributions (sorted) + eligible master-resource candidates', () => {
    const rep = report([
      row('R:a', 'Andi', 'PROJECT_PERSONNEL', [cell('2026-03', 30, 22)]),   // over
      row('R:b', 'Budi', 'PROJECT_PERSONNEL', [cell('2026-03', 5, 22)]),     // under-loaded peer → candidate
      row('U:c', 'Citra', 'PROJECT_PERSONNEL', [cell('2026-03', 1, 22)]),    // user-keyed → NOT a reassign target
    ]);
    const [c] = bundleConflicts(rep, contribs);
    expect(c.resourceKey).toBe('R:a');
    expect(c.overBy).toBeCloseTo(8);
    expect(c.contributions.map((x) => x.costItemId)).toEqual(['ci1', 'ci2']); // sorted by mandays desc
    expect(c.candidates.map((x) => x.resourceId)).toEqual(['b']);            // only the R: peer, U: excluded
    expect(c.candidates[0].spareCapacity).toBeCloseTo(17);
  });

  it('excludes peers at/above the slack threshold and non-over resources', () => {
    const rep = report([
      row('R:a', 'Andi', null, [cell('2026-03', 30, 22)]),
      row('R:busy', 'Busy', null, [cell('2026-03', 21, 22)]), // util 0.95 > 0.85 slack → not a candidate
    ]);
    const [c] = bundleConflicts(rep, contribs);
    expect(c.candidates).toHaveLength(0);
  });

  it('prefers a same-role candidate over a higher-slack different-role one', () => {
    const rep = report([
      row('R:a', 'Andi', 'PM', [cell('2026-03', 30, 22)]),
      row('R:same', 'SameRole', 'PM', [cell('2026-03', 11, 22)]),        // same role, spare 11
      row('R:diff', 'DiffRole', 'PROJECT_PERSONNEL', [cell('2026-03', 2, 22)]), // more spare but wrong role
    ]);
    const [c] = bundleConflicts(rep, new Map());
    expect(c.candidates[0].resourceId).toBe('same'); // same role wins over raw spare
  });

  it('returns nothing when no resource is over-allocated', () => {
    const rep = report([row('R:a', 'Andi', null, [cell('2026-03', 10, 22)])]);
    expect(bundleConflicts(rep, contribs)).toHaveLength(0);
  });
});
