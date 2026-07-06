import ExcelJS from 'exceljs';
import type { PortfolioExport } from './export.portfolio.data.js';

const IDR = '"Rp"#,##0;[Red]-"Rp"#,##0';

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    c.alignment = { vertical: 'middle' };
  });
}

// Portfolio-wide workbook: a summary sheet (totals + per-project EVM) and the
// rolled-up EVM trend sheet.
export async function buildPortfolioWorkbook(data: PortfolioExport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Prismatix';
  wb.created = data.generatedAt;

  const t = data.summary.totals;

  // --- Portfolio Summary ---
  const ov = wb.addWorksheet('Portfolio Summary');
  ov.columns = [{ width: 30 }, { width: 22 }];
  ov.addRow(['Status date', new Date(data.statusDate).toISOString().slice(0, 10)]);
  ov.addRow(['Generated', data.generatedAt.toISOString().slice(0, 10)]);
  ov.addRow(['Projects', t.count]);
  const numRows: [string, number, boolean][] = [
    ['Budget at Completion (BAC)', t.bac, true],
    ['Planned Value (PV)', t.pv, true],
    ['Earned Value (EV)', t.ev, true],
    ['Actual Cost (AC)', t.ac, true],
    ['Portfolio CPI', t.cpi, false],
    ['Portfolio SPI', t.spi, false],
    ['% Complete (EV / BAC)', t.percentComplete, false],
    ['Schedule progress (WBS)', t.scheduleProgress, false],
  ];
  numRows.forEach(([label, val, money]) => {
    const row = ov.addRow([label, val]);
    row.getCell(2).numFmt = money ? IDR : label.includes('%') || label.includes('progress') ? '0%' : '0.000';
  });
  ov.getColumn(1).font = { bold: true };
  ov.addRow([]);

  // Per-project table.
  styleHeader(ov.addRow(['Code', 'Project', 'PM', 'Status', 'BAC (IDR)', 'EV (IDR)', 'AC (IDR)', 'CPI', 'SPI', 'Health']));
  ov.getColumn(1).width = 16; ov.getColumn(2).width = 34;
  for (const c of [3, 4, 5, 6, 7]) ov.getColumn(c).width = 16;
  for (const p of data.summary.projects) {
    const row = ov.addRow([p.code, p.name, p.pm, p.status, p.bac, p.ev, p.ac, p.cpi, p.spi, p.health]);
    row.getCell(5).numFmt = IDR; row.getCell(6).numFmt = IDR; row.getCell(7).numFmt = IDR;
    row.getCell(8).numFmt = '0.00'; row.getCell(9).numFmt = '0.00';
  }

  // --- EVM Trend (rolled up) ---
  const tr = wb.addWorksheet('EVM Trend');
  tr.columns = [{ width: 14 }, { width: 10 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 8 }, { width: 8 }];
  styleHeader(tr.addRow(['Status Date', 'Projects', 'PV (IDR)', 'EV (IDR)', 'AC (IDR)', 'CPI', 'SPI']));
  for (const s of data.trend.series) {
    const row = tr.addRow([new Date(s.statusDate).toISOString().slice(0, 10), s.projectCount, s.pv, s.ev, s.ac, s.cpi, s.spi]);
    row.getCell(3).numFmt = IDR; row.getCell(4).numFmt = IDR; row.getCell(5).numFmt = IDR;
    row.getCell(6).numFmt = '0.00'; row.getCell(7).numFmt = '0.00';
  }
  if (!data.trend.series.length) tr.addRow(['—', 'No portfolio snapshots captured yet']);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
