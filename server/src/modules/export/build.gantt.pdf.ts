// Visual Gantt PDF — A4 landscape, timeline scaled to fit the page width, rows paginated. Renders
// the full tracking Gantt horizontally: frozen left columns (WBS · Task · Start · Finish · %) then
// bars — baseline underlay, plan bar, progress fill, milestone diamonds, critical-path outline and
// a "today" marker. pdfkit only (no browser), so it runs on the VPS like the other exports.
import PDFDocument from 'pdfkit';
import type { GanttExport, GanttRow } from './export.gantt.data.js';

const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

const PLAN = '#bfdbfe';        // plan bar fill
const PLAN_BORDER = '#3b82f6';
const PROGRESS = '#2563eb';     // completed portion
const SUMMARY = '#334155';      // summary (parent) bar
const BASELINE = '#cbd5e1';     // baseline underlay
const CRIT = '#dc2626';         // critical-path outline
const MILE = '#7c3aed';         // milestone diamond
const TODAY = '#f59e0b';
const GRID = '#e5e7eb';
const GRID_MAJOR = '#cbd5e1';
const TEXT = '#0f172a';
const MUTED = '#64748b';
const ACCENT = '#2563eb';
const STRIPE = '#f8fafc';

export function buildGanttPdf(data: GanttExport): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const pageBottom = doc.page.height - doc.page.margins.bottom;

  // Left frozen columns.
  const cWbs = 44, cTask = 150, cStart = 46, cFinish = 46, cPct = 26;
  const leftBlock = cWbs + cTask + cStart + cFinish + cPct;
  const tlLeft = left + leftBlock;
  const tlRight = right;
  const tlW = Math.max(60, tlRight - tlLeft);

  const t0 = +data.domainStart, t1 = +data.domainEnd;
  const span = Math.max(1, t1 - t0);
  const x = (t: number) => tlLeft + Math.min(1, Math.max(0, (t - t0) / span)) * tlW;

  const rowH = 15;
  const headerH = 34; // column titles + axis labels band
  let rowsTop = 0;

  // ---- header band + background gridlines for the current page ----
  const drawHeader = (y: number) => {
    // column title strip
    doc.rect(left, y, right - left, 16).fill(ACCENT);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
    doc.text('WBS', left + 2, y + 4.5, { width: cWbs - 3, lineBreak: false });
    doc.text('Task', left + cWbs + 2, y + 4.5, { width: cTask - 3, lineBreak: false });
    doc.text('Start', left + cWbs + cTask + 2, y + 4.5, { width: cStart - 3, lineBreak: false });
    doc.text('Finish', left + cWbs + cTask + cStart + 2, y + 4.5, { width: cFinish - 3, lineBreak: false });
    doc.text('%', left + cWbs + cTask + cStart + cFinish + 2, y + 4.5, { width: cPct - 3, align: 'right', lineBreak: false });
    // axis labels
    const axY = y + 18;
    doc.font('Helvetica').fontSize(6).fillColor(MUTED);
    for (const b of data.buckets) {
      const bx = x(+b.start);
      if (bx < tlLeft - 0.5 || bx > tlRight + 0.5) continue;
      doc.save().rotate(0);
      doc.fillColor(b.major ? TEXT : MUTED).text(b.label, bx + 1, axY, { width: 46, lineBreak: false });
      doc.restore();
    }
    rowsTop = y + headerH;
    // vertical gridlines + today, spanning the rows band of this page (drawn behind rows)
    for (const b of data.buckets) {
      const bx = x(+b.start);
      if (bx < tlLeft || bx > tlRight) continue;
      doc.moveTo(bx, rowsTop).lineTo(bx, pageBottom).lineWidth(b.major ? 0.6 : 0.3).strokeColor(b.major ? GRID_MAJOR : GRID).stroke();
    }
    const todayX = x(+data.today);
    if (todayX > tlLeft && todayX < tlRight) {
      doc.moveTo(todayX, rowsTop).lineTo(todayX, pageBottom).lineWidth(0.8).dash(2, { space: 2 }).strokeColor(TODAY).stroke().undash();
    }
    // frozen-column separator
    doc.moveTo(tlLeft, rowsTop).lineTo(tlLeft, pageBottom).lineWidth(0.6).strokeColor(GRID_MAJOR).stroke();
  };

  // ---- title block (first page only) ----
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(15).text('Project Schedule — Gantt Chart', left, left);
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10).text(`${data.project.name}`, left, doc.y + 1);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
    `${data.project.code}  ·  ${data.rows.length} tasks  ·  ${data.granularity === 'week' ? 'Weekly' : 'Monthly'} view  ·  ` +
    `${iso(data.domainStart)} → ${iso(data.domainEnd)}  ·  generated ${iso(data.generatedAt)}` +
    (data.baselinedAt ? `  ·  baseline ${iso(data.baselinedAt)}` : ''),
    left, doc.y + 1,
  );
  // legend
  const legendY = doc.y + 6;
  let lx = left;
  const chip = (color: string, label: string, kind: 'bar' | 'diamond' | 'line' = 'bar') => {
    if (kind === 'diamond') {
      doc.save().translate(lx + 4, legendY + 4).rotate(45).rect(-3, -3, 6, 6).fill(color).restore();
    } else if (kind === 'line') {
      doc.moveTo(lx, legendY + 4).lineTo(lx + 12, legendY + 4).lineWidth(1.2).dash(2, { space: 2 }).strokeColor(color).stroke().undash();
    } else {
      doc.rect(lx, legendY + 1, 14, 6).fill(color);
    }
    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(label, lx + 18, legendY, { lineBreak: false });
    lx += 18 + doc.widthOfString(label) + 14;
  };
  chip(PLAN, 'Plan'); chip(PROGRESS, 'Progress'); chip(SUMMARY, 'Summary'); chip(BASELINE, 'Baseline'); chip(MILE, 'Milestone', 'diamond'); chip(CRIT, 'Critical', 'bar'); chip(TODAY, 'Today', 'line');

  drawHeader(legendY + 16);
  let y = rowsTop;

  const drawRow = (r: GanttRow, i: number) => {
    if (y + rowH > pageBottom) {
      doc.addPage();
      drawHeader(left);
      y = rowsTop;
    }
    if (i % 2 === 1) doc.rect(left, y, right - left, rowH).fill(STRIPE);

    // left columns
    const indent = Math.min(r.depth, 6) * 7;
    doc.font(r.isSummary ? 'Helvetica-Bold' : 'Helvetica').fontSize(7).fillColor(r.isCritical ? CRIT : TEXT);
    doc.text(r.wbsCode, left + 2, y + 4, { width: cWbs - 3, lineBreak: false, ellipsis: true });
    doc.text(r.name, left + cWbs + 2 + indent, y + 4, { width: cTask - 3 - indent, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fillColor(MUTED);
    doc.text(iso(r.planStart), left + cWbs + cTask + 2, y + 4, { width: cStart - 3, lineBreak: false });
    doc.text(iso(r.planEnd), left + cWbs + cTask + cStart + 2, y + 4, { width: cFinish - 3, lineBreak: false });
    doc.fillColor(TEXT).text(`${r.progressPct}%`, left + cWbs + cTask + cStart + cFinish + 2, y + 4, { width: cPct - 3, align: 'right', lineBreak: false });

    // ---- bars ----
    const midY = y + rowH / 2;
    // baseline underlay (thin, below the plan bar)
    if (r.baselineStart && r.baselineFinish) {
      const bx0 = x(+r.baselineStart), bx1 = Math.max(x(+r.baselineFinish), bx0 + 1);
      doc.roundedRect(bx0, midY + 2.5, bx1 - bx0, 2.5, 1).fill(BASELINE);
    }
    if (r.isMilestone) {
      const mx = x(+r.planStart);
      doc.save().translate(mx, midY).rotate(45).rect(-3.2, -3.2, 6.4, 6.4).fill(MILE).restore();
    } else {
      const px0 = x(+r.planStart), px1 = Math.max(x(+r.planEnd), px0 + 1.5);
      const barY = midY - 3.5, barH = 5;
      if (r.isSummary) {
        // summary: a slim dark bar with end caps
        doc.rect(px0, barY + 1, px1 - px0, 3).fill(SUMMARY);
      } else {
        doc.roundedRect(px0, barY, px1 - px0, barH, 1.5).fillAndStroke(PLAN, r.isCritical ? CRIT : PLAN_BORDER);
        if (r.isCritical) doc.lineWidth(1); // outline drawn by fillAndStroke stroke color
        // progress fill
        const pct = Math.min(100, Math.max(0, r.progressPct)) / 100;
        if (pct > 0) doc.roundedRect(px0, barY, Math.max(1.5, (px1 - px0) * pct), barH, 1.5).fill(PROGRESS);
      }
    }
    y += rowH;
  };

  data.rows.forEach(drawRow);
  if (!data.rows.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('No scheduled tasks to chart yet.', tlLeft + 8, rowsTop + 8);
  }

  doc.end();
  return done;
}
