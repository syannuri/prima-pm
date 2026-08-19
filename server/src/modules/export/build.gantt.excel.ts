// Visual Gantt workbook — the schedule laid out horizontally: frozen left columns (WBS · Task ·
// Start · Finish · %) then one narrow column per time bucket (weekly/monthly, auto). Cells inside a
// task's plan span are filled to form the bar; the completed fraction is a darker tone, milestones
// are a ◆ marker, the baseline span gets an underline border, and critical tasks read in red.
import ExcelJS from 'exceljs';
import type { GanttExport, GanttRow, GanttBucket } from './export.gantt.data.js';

const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

const PLAN = 'FFBFDBFE';
const PROGRESS = 'FF2563EB';
const SUMMARY = 'FF334155';
const MILE = 'FF7C3AED';
const BASELINE = 'FFCBD5E1';
const CRIT = 'FFDC2626';
const HEADER = 'FF4F46E5';
const FIXED = 5; // WBS, Task, Start, Finish, %

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const overlaps = (b: GanttBucket, s: Date, e: Date) => +b.start <= +e && +b.end > +s;

export async function buildGanttWorkbook(data: GanttExport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Prismatix';
  wb.created = data.generatedAt;

  const ws = wb.addWorksheet('Gantt', { views: [{ state: 'frozen', xSplit: FIXED, ySplit: 3, zoomScale: 90 }] });

  // Column widths — narrow bucket columns so the filled cells read as a bar.
  ws.columns = [
    { width: 12 }, { width: 38 }, { width: 12 }, { width: 12 }, { width: 6 },
    ...data.buckets.map(() => ({ width: 3.6 })),
  ];

  // Row 1: title. Row 2: legend. Row 3: column headers.
  const lastCol = FIXED + data.buckets.length;
  ws.mergeCells(1, 1, 1, Math.min(lastCol, FIXED + 12));
  const title = ws.getCell(1, 1);
  title.value = `Gantt — ${data.project.name} (${data.project.code})  ·  ${data.granularity === 'week' ? 'Weekly' : 'Monthly'}  ·  generated ${iso(data.generatedAt)}`;
  title.font = { bold: true, size: 12 };

  const legend = ws.getCell(2, 1);
  legend.value = 'Legend:  ▮ Plan   ▮ Progress   ▮ Summary   ▁ Baseline   ◆ Milestone   red = Critical';
  legend.font = { size: 9, color: { argb: 'FF64748B' } };
  ws.mergeCells(2, 1, 2, Math.min(lastCol, FIXED + 16));

  // Header row (row 3).
  const header = ws.getRow(3);
  header.getCell(1).value = 'WBS';
  header.getCell(2).value = 'Task';
  header.getCell(3).value = 'Start';
  header.getCell(4).value = 'Finish';
  header.getCell(5).value = '%';
  data.buckets.forEach((b, i) => {
    const c = header.getCell(FIXED + 1 + i);
    c.value = b.label;
    c.alignment = { textRotation: 90, vertical: 'bottom', horizontal: 'center' };
    c.font = { size: 7, bold: b.major, color: { argb: b.major ? 'FF0F172A' : 'FF64748B' } };
  });
  for (let c = 1; c <= FIXED; c++) {
    const cell = header.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(HEADER);
    cell.alignment = { vertical: 'middle' };
  }
  header.height = 46;

  // Data rows.
  const drawRow = (r: GanttRow) => {
    const excelRow = ws.addRow([
      r.wbsCode,
      `${'  '.repeat(Math.min(r.depth, 6))}${r.name}`,
      iso(r.planStart),
      iso(r.planEnd),
      r.progressPct / 100,
    ]);
    excelRow.getCell(1).font = { color: { argb: r.isCritical ? CRIT : 'FF0F172A' }, bold: r.isSummary };
    excelRow.getCell(2).font = { color: { argb: r.isCritical ? CRIT : 'FF0F172A' }, bold: r.isSummary };
    excelRow.getCell(5).numFmt = '0%';
    excelRow.getCell(5).alignment = { horizontal: 'right' };

    const spanMs = Math.max(1, +r.planEnd - +r.planStart);
    const completedUntil = +r.planStart + (Math.min(100, Math.max(0, r.progressPct)) / 100) * spanMs;

    data.buckets.forEach((b, i) => {
      const cell = excelRow.getCell(FIXED + 1 + i);
      if (r.isMilestone) {
        if (overlaps(b, r.planStart, r.planStart)) {
          cell.value = '◆';
          cell.font = { color: { argb: MILE }, size: 8 };
          cell.alignment = { horizontal: 'center' };
        }
      } else if (overlaps(b, r.planStart, r.planEnd)) {
        const done = +b.start < completedUntil;
        cell.fill = fill(r.isSummary ? SUMMARY : done ? PROGRESS : PLAN);
      }
      // baseline underline
      if (r.baselineStart && r.baselineFinish && overlaps(b, r.baselineStart, r.baselineFinish)) {
        cell.border = { ...(cell.border ?? {}), bottom: { style: 'medium', color: { argb: BASELINE } } };
      }
      // critical outline on plan cells
      if (r.isCritical && !r.isMilestone && overlaps(b, r.planStart, r.planEnd)) {
        cell.border = { ...(cell.border ?? {}), top: { style: 'thin', color: { argb: CRIT } }, bottom: { style: 'thin', color: { argb: CRIT } } };
      }
    });
  };

  data.rows.forEach(drawRow);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
