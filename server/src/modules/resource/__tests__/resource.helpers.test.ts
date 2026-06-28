import { describe, it, expect } from 'vitest';
import {
  businessDaysBetween,
  eachBusinessDay,
  periodKey,
  periodsInRange,
  buildCapacityReport,
  effectiveDayRate,
  type AllocationInput,
} from '../resource.helpers.js';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('resource — effective day rate', () => {
  it('uses the explicit override when positive', () => {
    expect(effectiveDayRate(1_500_000, 1_000_000)).toBe(1_500_000);
  });
  it('inherits the rate card when no override', () => {
    expect(effectiveDayRate(0, 1_000_000)).toBe(1_000_000);
    expect(effectiveDayRate(null, 1_000_000)).toBe(1_000_000);
    expect(effectiveDayRate(undefined, 1_000_000)).toBe(1_000_000);
  });
  it('falls back to 0 when neither is available', () => {
    expect(effectiveDayRate(null, null)).toBe(0);
  });
});

const item = (over: Partial<AllocationInput> = {}): AllocationInput => ({
  resourceKey: 'U:1',
  resourceName: 'Alice',
  personnelRole: 'PROJECT_PERSONNEL',
  projectId: 'p1',
  projectCode: 'PRJ-001',
  projectName: 'Alpha',
  planMandays: 10,
  taskStart: d('2026-03-02'), // Monday
  taskEnd: d('2026-03-13'), // Friday (2 work weeks = 10 business days)
  ...over,
});

describe('resource — business-day math', () => {
  it('counts only Mon–Fri, inclusive', () => {
    // 2026-03-02 (Mon) .. 2026-03-13 (Fri) = 10 business days
    expect(businessDaysBetween(d('2026-03-02'), d('2026-03-13'))).toBe(10);
    // a single weekend yields zero
    expect(businessDaysBetween(d('2026-03-07'), d('2026-03-08'))).toBe(0);
    // order tolerant
    expect(businessDaysBetween(d('2026-03-13'), d('2026-03-02'))).toBe(0);
  });

  it('enumerates business days', () => {
    expect(eachBusinessDay(d('2026-03-02'), d('2026-03-06')).length).toBe(5);
  });
});

describe('resource — period keys', () => {
  it('months are YYYY-MM', () => {
    expect(periodKey(d('2026-03-15'), 'month')).toBe('2026-03');
  });
  it('weeks key off their Monday', () => {
    // Sunday 2026-03-08 belongs to the week starting Monday 2026-03-02
    expect(periodKey(d('2026-03-08'), 'week')).toBe('2026-03-02');
    expect(periodKey(d('2026-03-09'), 'week')).toBe('2026-03-09');
  });
  it('spans an inclusive range of months', () => {
    expect(periodsInRange(d('2026-01-15'), d('2026-03-02'), 'month')).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});

describe('resource — capacity report', () => {
  it('spreads man-days evenly and never over-allocates a perfectly-sized task', () => {
    // 10 mandays across exactly 10 business days = 1.0/day → full but not over.
    const r = buildCapacityReport([item()], 'month');
    expect(r.resources).toHaveLength(1);
    const res = r.resources[0];
    expect(res.totalPlanMandays).toBe(10);
    expect(res.scheduledMandays).toBe(10);
    expect(res.overAllocated).toBe(false);
    // Window defaults to the data span (10 business days), so a 10-manday task is fully booked at 1.0.
    expect(res.peakUtilization).toBe(1);
  });

  it('drops to partial utilization when a wider window is given', () => {
    // Same 10-manday task, but report the whole of March 2026 (22 business days).
    const r = buildCapacityReport([item()], 'month', d('2026-03-01'), d('2026-03-31'));
    expect(r.resources[0].peakUtilization).toBe(0.45); // 10/22, rounded to 2dp
    expect(r.resources[0].overAllocated).toBe(false);
  });

  it('flags over-allocation when mandays exceed available business days', () => {
    // 15 mandays squeezed into 5 business days → 3.0/day, way over capacity.
    const r = buildCapacityReport(
      [item({ planMandays: 15, taskStart: d('2026-03-02'), taskEnd: d('2026-03-06') })],
      'week',
    );
    const res = r.resources[0];
    expect(res.overAllocated).toBe(true);
    const cell = res.cells.find((c) => c.period === '2026-03-02')!;
    expect(cell.allocated).toBe(15);
    expect(cell.capacity).toBe(5);
    expect(cell.over).toBe(true);
    expect(cell.utilization).toBe(3);
  });

  it('scales capacity by capacityPerDay — a crew absorbs more before over-allocation', () => {
    const r = buildCapacityReport(
      [item({ planMandays: 15, taskStart: d('2026-03-02'), taskEnd: d('2026-03-06'), capacityPerDay: 3 })],
      'week',
    );
    const cell = r.resources[0].cells.find((c) => c.period === '2026-03-02')!;
    expect(cell.capacity).toBe(15); // 5 business days × 3 mandays/day
    expect(cell.utilization).toBe(1);
    expect(r.resources[0].overAllocated).toBe(false);
  });

  it('aggregates one resource across multiple projects', () => {
    const r = buildCapacityReport(
      [
        item({ projectId: 'p1', projectCode: 'PRJ-001', planMandays: 10 }),
        item({ projectId: 'p2', projectCode: 'PRJ-002', projectName: 'Beta', planMandays: 6 }),
      ],
      'month',
    );
    expect(r.resources).toHaveLength(1);
    const res = r.resources[0];
    expect(res.totalPlanMandays).toBe(16);
    expect(res.projects).toHaveLength(2);
    expect(res.projects.map((p) => p.code).sort()).toEqual(['PRJ-001', 'PRJ-002']);
  });

  it('separates distinct unnamed lines and counts undated work as unscheduled', () => {
    const r = buildCapacityReport(
      [
        item({ resourceKey: 'L:p1:Dev', resourceName: 'Dev', taskStart: null, taskEnd: null, planMandays: 8 }),
        item({ resourceKey: 'L:p1:QA', resourceName: 'QA', planMandays: 5 }),
      ],
      'month',
    );
    expect(r.resources).toHaveLength(2);
    const dev = r.resources.find((x) => x.name === 'Dev')!;
    expect(dev.unscheduledMandays).toBe(8);
    expect(dev.scheduledMandays).toBe(0);
  });

  it('returns an empty, well-formed report when there is nothing to schedule', () => {
    const r = buildCapacityReport([], 'month');
    expect(r.periods).toEqual([]);
    expect(r.resources).toEqual([]);
    expect(r.summary).toEqual({ resourceCount: 0, overAllocatedCount: 0, totalPlanMandays: 0 });
  });
});
