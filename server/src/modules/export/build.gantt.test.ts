import { describe, it, expect } from 'vitest';
import { buildGanttPdf } from './build.gantt.pdf.js';
import { buildGanttWorkbook } from './build.gantt.excel.js';
import { flatten, type GanttExport, type GanttRow, type TreeNode } from './export.gantt.data.js';

const d = (s: string) => new Date(s);

function row(over: Partial<GanttRow>): GanttRow {
  return {
    id: 'x', depth: 0, wbsCode: '1', name: 'Task', isMilestone: false, isCritical: false,
    isSummary: false, planStart: d('2026-01-05'), planEnd: d('2026-02-02'),
    baselineStart: d('2026-01-05'), baselineFinish: d('2026-01-26'), actualStart: null,
    actualFinish: null, progressPct: 40, pic: 'A', ...over,
  };
}

function mockExport(granularity: 'week' | 'month'): GanttExport {
  const buckets = granularity === 'week'
    ? Array.from({ length: 6 }, (_, i) => ({ start: new Date(+d('2026-01-05') + i * 7 * 86400000), end: new Date(+d('2026-01-12') + i * 7 * 86400000), label: `${5 + i * 7} Jan`, major: i === 0 }))
    : Array.from({ length: 3 }, (_, i) => ({ start: new Date(Date.UTC(2026, i, 1)), end: new Date(Date.UTC(2026, i + 1, 1)), label: 'Mon', major: i === 0 }));
  return {
    project: { code: 'PRJ-1', name: 'Demo Project' },
    rows: [
      row({ wbsCode: '1', name: 'Phase A', isSummary: true, depth: 0 }),
      row({ wbsCode: '1.1', name: 'Design', depth: 1, isCritical: true, progressPct: 100 }),
      row({ wbsCode: '1.2', name: 'Kickoff', depth: 1, isMilestone: true, planEnd: d('2026-01-05'), progressPct: 0 }),
      row({ wbsCode: '1.3', name: 'Build', depth: 1, progressPct: 0 }),
    ],
    domainStart: d('2026-01-05'), domainEnd: granularity === 'week' ? d('2026-02-16') : d('2026-04-01'),
    granularity, buckets, today: d('2026-01-20'), baselinedAt: d('2026-01-01'), generatedAt: d('2026-01-20'),
  };
}

describe('gantt exports', () => {
  it('builds a PDF (weekly + monthly) with the PDF signature', async () => {
    for (const g of ['week', 'month'] as const) {
      const buf = await buildGanttPdf(mockExport(g));
      expect(buf.length).toBeGreaterThan(500);
      expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    }
  });

  it('builds an XLSX workbook with the zip signature', async () => {
    for (const g of ['week', 'month'] as const) {
      const buf = await buildGanttWorkbook(mockExport(g));
      expect(buf.length).toBeGreaterThan(500);
      expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
    }
  });

  it('rolls a weight-weighted progress % up onto summary (Main Task) rows', () => {
    // Two leaves under a summary: 100% (weight 3) + 0% (weight 1) → parent = round(300/4) = 75%.
    const leaf = (over: Partial<TreeNode>): TreeNode => ({
      id: 'l', wbsCode: '1.1', name: 'Leaf', isMilestone: false,
      planStart: d('2026-01-05'), planEnd: d('2026-02-02'),
      baselineStart: null, baselineFinish: null, actualStart: null, actualFinish: null,
      progressPct: 0, effectiveWeightPct: 0, durationDays: 1, owners: [], picResource: null, pic: null,
      children: [], ...over,
    } as unknown as TreeNode);
    const tree: TreeNode[] = [{
      ...leaf({ id: 'p', wbsCode: '1', name: 'Phase A' }),
      children: [
        leaf({ id: 'a', wbsCode: '1.1', progressPct: 100, effectiveWeightPct: 30, durationDays: 3 }),
        leaf({ id: 'b', wbsCode: '1.2', progressPct: 0, effectiveWeightPct: 10, durationDays: 1 }),
      ],
    } as unknown as TreeNode];
    const rows = flatten(tree, new Set());
    const parent = rows.find((r) => r.id === 'p')!;
    expect(parent.isSummary).toBe(true);
    expect(parent.progressPct).toBe(75);
  });

  it('handles an empty schedule without throwing', async () => {
    const empty = { ...mockExport('week'), rows: [] };
    expect((await buildGanttPdf(empty)).subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect((await buildGanttWorkbook(empty)).subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
