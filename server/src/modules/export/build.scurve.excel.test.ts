import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildScurveWorkbook } from './build.scurve.excel.js';
import type { ScurveExport } from './export.scurve.data.js';

// A 1×1 transparent PNG — enough to exercise the image-embed path.
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const base = {
  project: { code: 'PRJ-1', name: 'Test Project', pm: 'Alice' },
  statusDate: new Date('2026-09-01T00:00:00Z'),
  mode: 'cost' as const,
  evm: { bac: 1000, pv: 500, ev: 400, ac: 450, cv: -50, sv: -100, spi: 0.8, cpi: 0.89, etc: 620, vac: -70, tcpi: 1.1, percentComplete: 0.4, health: 'AMBER' },
  forecast: {
    schedule: { plannedStart: '2026-01-01', plannedFinish: '2026-12-31', forecastFinish: '2027-01-15', varianceDays: 15 },
    eac: { likely: 1070, optimistic: 1020, pessimistic: 1150 },
    sCurve: [{ t: '2026-08-01', pv: 400, ac: 380, forecast: null }, { t: '2026-09-01', pv: 500, ac: 450, forecast: 1070 }],
  },
  snapshots: [{ statusDate: '2026-08-01', pv: 400, ev: 380, ac: 390, spi: 0.95, cpi: 0.97, weightedProgress: 0.38, note: 'week 1' }],
  chartPng: PNG_1x1,
} as unknown as ScurveExport;

const cellsOf = (ws: ExcelJS.Worksheet): string[] => {
  const out: string[] = [];
  ws.eachRow((r) => r.eachCell((c) => out.push(String(c.value ?? ''))));
  return out;
};

describe('buildScurveWorkbook', () => {
  it('produces a valid xlsx with both sheets, EVM summary + series + snapshots', async () => {
    const buf = Buffer.from(await buildScurveWorkbook(base));
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 2).toString()).toBe('PK'); // xlsx = zip

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sc = wb.getWorksheet('S-Curve');
    const sn = wb.getWorksheet('EVM Snapshots');
    expect(sc).toBeTruthy();
    expect(sn).toBeTruthy();

    const scCells = cellsOf(sc!);
    expect(scCells.some((v) => v.includes('Budget at Completion'))).toBe(true);
    expect(scCells.some((v) => v.includes('SPI'))).toBe(true);
    expect(scCells.some((v) => v.startsWith('Interpretation'))).toBe(true);
    expect(scCells).toContain('Planned (PV)'); // series header
    expect(wb.model.media.length).toBeGreaterThan(0); // the chart image was embedded

    const snCells = cellsOf(sn!);
    expect(snCells).toContain('week 1'); // the snapshot note
  });

  it('builds without a chart image and with no series (baseline not locked)', async () => {
    const noChart = { ...base, chartPng: null, forecast: { ...base.forecast, sCurve: [] }, snapshots: [] } as unknown as ScurveExport;
    const buf = Buffer.from(await buildScurveWorkbook(noChart));
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(cellsOf(wb.getWorksheet('S-Curve')!).some((v) => v.includes('No S-curve data'))).toBe(true);
    expect(wb.model.media.length).toBe(0);
  });
});
