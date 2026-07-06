import PDFDocument from 'pdfkit';
import { formatIdr } from '../../calc/money.js';
import type { PortfolioExport } from './export.portfolio.data.js';

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const ACCENT = '#e34f4a'; // brand coral (matches the app + per-project report)
const GRAY = '#64748b';
const pct = (f: number) => `${Math.round(f * 100)}%`;

// Portfolio-wide PDF report: totals, a per-project EVM table, and the rolled-up EVM
// trend. Mirrors the per-project build.pdf.ts helpers so the two reports read alike.
export function buildPortfolioPdf(data: PortfolioExport): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  const heading = (text: string) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.6);
    doc.fillColor(ACCENT).fontSize(13).font('Helvetica-Bold').text(text);
    doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor(ACCENT).lineWidth(1).stroke();
    doc.moveDown(0.5).fillColor('#0f172a').font('Helvetica').fontSize(9);
  };

  const kv = (label: string, value: string) => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fillColor(GRAY).fontSize(9).text(label, left, y, { width: 160 });
    doc.font('Helvetica').fillColor('#0f172a').text(value, left + 170, y, { width: width - 170 });
    doc.moveDown(0.2);
  };

  const table = (cols: { title: string; w: number; align?: 'left' | 'right' }[], rows: (string | number)[][]) => {
    const tableW = cols.reduce((s, c) => s + c.w, 0);
    const scale = tableW > width ? width / tableW : 1;
    const cw = cols.map((c) => c.w * scale);
    const colX: number[] = [];
    let x = left;
    for (const w of cw) { colX.push(x); x += w; }
    const rowH = 14;
    const drawRow = (cells: (string | number)[], bold: boolean, fill?: string) => {
      if (doc.y > doc.page.height - 60) doc.addPage();
      const y = doc.y;
      if (fill) doc.rect(left, y - 2, tableW * scale, rowH).fill(fill);
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(bold && fill ? '#ffffff' : '#0f172a');
      cols.forEach((c, i) => {
        doc.text(String(cells[i] ?? ''), colX[i] + 2, y, { width: cw[i] - 4, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
      });
      doc.y = y + rowH;
    };
    drawRow(cols.map((c) => c.title), true, ACCENT);
    for (const r of rows) drawRow(r, false);
    doc.moveDown(0.4);
  };

  // ---------- Header ----------
  doc.fillColor(ACCENT).fontSize(20).font('Helvetica-Bold').text('Prismatix');
  doc.fillColor(GRAY).fontSize(9).font('Helvetica').text('Portfolio Management Report');
  doc.moveDown(0.5);
  doc.fillColor('#0f172a').fontSize(15).font('Helvetica-Bold').text('Portfolio EVM Overview');
  doc.fontSize(9).font('Helvetica').fillColor(GRAY)
    .text(`Projects: ${data.summary.totals.count}   |   Status date: ${iso(data.statusDate)}   |   Generated: ${iso(data.generatedAt)}`);
  doc.moveDown(0.3);

  // ---------- Totals ----------
  const t = data.summary.totals;
  heading('1. Portfolio Totals');
  kv('Budget at Completion (BAC)', formatIdr(t.bac));
  kv('Planned Value (PV)', formatIdr(t.pv));
  kv('Earned Value (EV)', formatIdr(t.ev));
  kv('Actual Cost (AC)', formatIdr(t.ac));
  kv('Portfolio CPI', t.cpi ? t.cpi.toFixed(3) : '—');
  kv('Portfolio SPI', t.spi ? t.spi.toFixed(3) : '—');
  kv('% Complete (EV / BAC)', pct(t.percentComplete));
  kv('Schedule progress (WBS)', pct(t.scheduleProgress));

  // ---------- Per-project EVM ----------
  heading('2. Projects');
  table(
    [
      { title: 'Code', w: 70 }, { title: 'Project', w: 120 }, { title: 'PM', w: 70 },
      { title: 'Status', w: 55 }, { title: 'BAC', w: 80, align: 'right' }, { title: 'EV', w: 80, align: 'right' },
      { title: 'CPI', w: 30, align: 'right' }, { title: 'SPI', w: 30, align: 'right' }, { title: 'Health', w: 55 },
    ],
    data.summary.projects.map((p) => [
      p.code, p.name, p.pm, p.status, formatIdr(p.bac), formatIdr(p.ev),
      p.cpi ? p.cpi.toFixed(2) : '—', p.spi ? p.spi.toFixed(2) : '—', p.health,
    ]),
  );

  // ---------- Portfolio EVM trend ----------
  heading('3. EVM Trend (portfolio status history)');
  if (data.trend.series.length) {
    table(
      [
        { title: 'Status Date', w: 70 }, { title: 'Projects', w: 55, align: 'right' },
        { title: 'PV', w: 90, align: 'right' }, { title: 'EV', w: 90, align: 'right' },
        { title: 'AC', w: 90, align: 'right' }, { title: 'CPI', w: 35, align: 'right' },
        { title: 'SPI', w: 35, align: 'right' },
      ],
      data.trend.series.map((s) => [
        iso(s.statusDate), String(s.projectCount),
        formatIdr(s.pv), formatIdr(s.ev), formatIdr(s.ac),
        s.cpi ? s.cpi.toFixed(2) : '—', s.spi ? s.spi.toFixed(2) : '—',
      ]),
    );
  } else {
    doc.text('No portfolio snapshots captured yet.');
  }

  doc.end();
  return done;
}
