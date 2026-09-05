import ExcelJS from 'exceljs';
import type { ScurveExport } from './export.scurve.data.js';

const IDR = '"Rp"#,##0;[Red]-"Rp"#,##0';

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    c.alignment = { vertical: 'middle' };
  });
}

const d10 = (v: unknown): string => {
  if (!v) return '—';
  const dt = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toISOString().slice(0, 10);
};

function interpret(e: ScurveExport['evm']): string {
  const sched = e.spi >= 1 ? 'on/ahead of schedule' : e.spi >= 0.9 ? 'slightly behind schedule' : 'behind schedule';
  const cost = e.cpi >= 1 ? 'on/under budget' : e.cpi >= 0.9 ? 'slightly over budget' : 'over budget';
  const vac = e.vac >= 0 ? 'positive (projected savings)' : 'negative (projected overrun)';
  return `Interpretation — SPI ${e.spi.toFixed(2)}: ${sched}. CPI ${e.cpi.toFixed(2)}: ${cost}. VAC ${vac}. % complete ${Math.round((e.percentComplete ?? 0) * 100)}%.`;
}

// Build the S-Curve workbook: a "S-Curve" sheet (header + full EVM summary + interpretation + the
// embedded chart image + the per-period series table) and an "EVM Snapshots" sheet (the captured EV
// data points). exceljs has no native charts, so the chart is embedded as an image (from the app).
export async function buildScurveWorkbook(d: ScurveExport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Prismatix';
  wb.created = new Date();

  const ws = wb.addWorksheet('S-Curve');
  ws.columns = [{ width: 30 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 18 }];

  ws.mergeCells('A1:E1');
  const title = ws.getCell('A1');
  title.value = `S-Curve — ${d.project.code} · ${d.project.name}`;
  title.font = { bold: true, size: 14 };
  ws.addRow([]);

  // Header info.
  const f = d.forecast;
  const info: [string, string | number][] = [
    ['Project', `${d.project.code} — ${d.project.name}`],
    ['PM', d.project.pm ?? '—'],
    ['Status date', d10(d.statusDate)],
    ['Variant', d.mode === 'progress' ? 'Plan vs Actual — Progress (% of BAC)' : d.mode === 'cost' ? 'Plan vs Actual — Cost (money)' : 'Combined (PV / EV / AC / Forecast)'],
    ['Planned start', d10(f.schedule.plannedStart)],
    ['Planned finish', d10(f.schedule.plannedFinish)],
    ['Forecast finish', d10(f.schedule.forecastFinish)],
    ['Finish variance (days)', f.schedule.varianceDays ?? '—'],
  ];
  info.forEach(([k, v]) => { const r = ws.addRow([k, v]); r.getCell(1).font = { bold: true }; });
  ws.addRow([]);

  // EVM summary.
  styleHeader(ws.addRow(['EVM summary', 'Value']));
  const e = d.evm;
  const summary: [string, number | string, 'idr' | 'num' | 'pct' | 'txt'][] = [
    ['Budget at Completion (BAC)', e.bac, 'idr'],
    ['Planned Value (PV / BCWS)', e.pv, 'idr'],
    ['Earned Value (EV / BCWP)', e.ev, 'idr'],
    ['Actual Cost (AC / ACWP)', e.ac, 'idr'],
    ['Cost Variance (CV = EV − AC)', e.cv, 'idr'],
    ['Schedule Variance (SV = EV − PV)', e.sv, 'idr'],
    ['SPI (EV / PV)', e.spi, 'num'],
    ['CPI (EV / AC)', e.cpi, 'num'],
    ['EAC — likely', f.eac.likely, 'idr'],
    ['EAC — best case', f.eac.optimistic, 'idr'],
    ['EAC — worst case', f.eac.pessimistic, 'idr'],
    ['ETC (estimate to complete)', e.etc, 'idr'],
    ['VAC (BAC − EAC)', e.vac, 'idr'],
    ['TCPI', e.tcpi, 'num'],
    ['% Complete', e.percentComplete, 'pct'],
    ['Health', e.health, 'txt'],
  ];
  summary.forEach(([label, val, kind]) => {
    const r = ws.addRow([label, val]);
    r.getCell(1).font = { bold: true };
    if (kind === 'idr') r.getCell(2).numFmt = IDR;
    else if (kind === 'num') r.getCell(2).numFmt = '0.00';
    else if (kind === 'pct') r.getCell(2).numFmt = '0%';
  });
  ws.addRow([]);

  const ir = ws.addRow([interpret(e)]);
  ws.mergeCells(ir.number, 1, ir.number, 5);
  ir.getCell(1).alignment = { wrapText: true, vertical: 'top' };
  ir.height = 30;
  ws.addRow([]);

  // Embedded chart image (from the client). exceljs has no native charts.
  if (d.chartPng && d.chartPng.length) {
    const imgId = wb.addImage({ base64: d.chartPng.toString('base64'), extension: 'png' });
    const anchorRow = ws.rowCount; // 0-indexed top-left for the image
    ws.addImage(imgId, { tl: { col: 0, row: anchorRow }, ext: { width: 660, height: 330 } });
    for (let i = 0; i < 18; i++) ws.addRow([]); // reserve space so the table below doesn't overlap
  }
  ws.addRow([]);

  // S-Curve series (per period): planned PV, actual AC, forecast.
  styleHeader(ws.addRow(['Date', 'Planned (PV)', 'Actual (AC)', 'Forecast']));
  for (const p of f.sCurve) {
    const r = ws.addRow([d10(p.t), p.pv, p.ac, p.forecast]);
    r.getCell(2).numFmt = IDR; r.getCell(3).numFmt = IDR; r.getCell(4).numFmt = IDR;
  }
  if (!f.sCurve.length) ws.addRow(['—', 'No S-curve data (baseline not locked yet)']);

  // EVM Snapshots sheet — the captured earned-value data points.
  const sn = wb.addWorksheet('EVM Snapshots');
  sn.columns = [{ width: 14 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 30 }];
  styleHeader(sn.addRow(['Date', 'PV', 'EV', 'AC', 'SPI', 'CPI', '% complete', 'Note']));
  for (const s of d.snapshots) {
    const r = sn.addRow([d10(s.statusDate), s.pv, s.ev, s.ac, s.spi, s.cpi, s.weightedProgress ?? 0, s.note ?? '']);
    r.getCell(2).numFmt = IDR; r.getCell(3).numFmt = IDR; r.getCell(4).numFmt = IDR;
    r.getCell(5).numFmt = '0.00'; r.getCell(6).numFmt = '0.00'; r.getCell(7).numFmt = '0%';
  }
  if (!d.snapshots.length) sn.addRow(['—', 'No EVM snapshots captured yet']);

  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}
