import PDFDocument from 'pdfkit';
import { formatIdr } from '../../calc/money.js';
import type { ProjectReport } from '../report/report.service.js';

const ACCENT = '#e34f4a'; // brand coral (matches the app)
const GRAY = '#64748b';
const GREEN = '#16a34a';
const AMBER = '#d97706';
const RED = '#dc2626';
const iso = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const healthColor = (h: string) => (h === 'GREEN' ? GREEN : h === 'AMBER' ? AMBER : h === 'RED' ? RED : GRAY);
const healthLabel = (h: string) => (h === 'NO_DATA' ? 'No data' : h);
const statusLabel = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

// A professional single-project status report PDF (period-aware). Mirrors the in-app
// Reports page: status summary, task completion, EVM, forecast and the EVM S-curve.
export function buildReportPdf(r: ProjectReport): Promise<Buffer> {
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
    doc.fillColor(ACCENT).fontSize(12).font('Helvetica-Bold').text(text);
    doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor(ACCENT).lineWidth(1).stroke();
    doc.moveDown(0.5).fillColor('#0f172a').font('Helvetica').fontSize(9);
  };

  const kv = (label: string, value: string, color?: string) => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fillColor(GRAY).fontSize(9).text(label, left, y, { width: 150 });
    doc.font('Helvetica').fillColor(color ?? '#0f172a').text(value, left + 160, y, { width: width - 160 });
    doc.moveDown(0.25);
  };

  const table = (cols: { title: string; w: number; align?: 'left' | 'right' }[], rows: (string | number)[][]) => {
    const totalW = cols.reduce((s, c) => s + c.w, 0);
    const scale = totalW > width ? width / totalW : 1;
    const cw = cols.map((c) => c.w * scale);
    const tableW = cw.reduce((s, w) => s + w, 0);
    const colX: number[] = [];
    let x = left;
    for (const w of cw) { colX.push(x); x += w; }
    const drawRow = (cells: (string | number)[], bold: boolean, fill?: string) => {
      const rowH = 16;
      if (doc.y > doc.page.height - 60) doc.addPage();
      const y = doc.y;
      if (fill) doc.rect(left, y - 2, tableW, rowH).fill(fill);
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(bold && fill ? '#ffffff' : '#0f172a');
      cols.forEach((c, i) => {
        doc.text(String(cells[i] ?? ''), colX[i] + 2, y, { width: cw[i] - 4, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
      });
      doc.y = y + rowH;
    };
    drawRow(cols.map((c) => c.title), true, ACCENT);
    rows.forEach((row) => drawRow(row, false));
    doc.moveDown(0.4);
  };

  const f = r.forecast;
  const e = r.evm;

  // ---------- Header ----------
  doc.fillColor(ACCENT).fontSize(20).font('Helvetica-Bold').text('Prismatix');
  doc.fillColor(GRAY).fontSize(9).font('Helvetica').text(`Project Status Report · ${r.period === 'weekly' ? 'Weekly' : 'Monthly'}`);
  doc.moveDown(0.5);
  doc.fillColor('#0f172a').fontSize(15).font('Helvetica-Bold').text(`${r.project.code} — ${r.project.name}`);
  doc.fontSize(9).font('Helvetica').fillColor(GRAY)
    .text(`PM: ${r.project.pmName}   |   Lifecycle: ${statusLabel(r.project.status)}   |   Reporting period: ${r.periodLabel}   |   Generated: ${iso(r.asOf)}`);

  // ---------- 1. Status summary ----------
  heading('1. Status Summary');
  kv('Overall health', healthLabel(r.health), healthColor(r.health));
  kv('% Complete (weighted)', `${r.tasks.weightedPct}%`);
  kv('Tasks completed', `${r.tasks.completed} of ${r.tasks.total}  (${r.tasks.inProgress} in progress, ${r.tasks.notStarted} not started)`);
  kv('Schedule (SPI)', e.pv > 0 ? `${e.spi.toFixed(2)}${e.spi >= 1 ? '  (on/ahead)' : '  (behind)'}` : '—', e.pv > 0 ? (e.spi >= 1 ? GREEN : RED) : GRAY);
  kv('Cost (CPI)', e.ac > 0 ? `${e.cpi.toFixed(2)}${e.cpi >= 1 ? '  (on/under)' : '  (over)'}` : '—', e.ac > 0 ? (e.cpi >= 1 ? GREEN : RED) : GRAY);
  kv('Planned finish', iso(f.schedule.plannedFinish));
  kv('Forecast finish', f.schedule.forecastFinish ? `${iso(f.schedule.forecastFinish)}${f.schedule.varianceDays != null ? `  (${f.schedule.varianceDays > 0 ? '+' : ''}${f.schedule.varianceDays}d)` : ''}` : '—',
    f.schedule.varianceDays != null ? (f.schedule.varianceDays > 0 ? RED : GREEN) : undefined);

  // ---------- 2. Task completion ----------
  heading('2. Task Completion');
  kv('Completed', `${r.tasks.completed}`, GREEN);
  kv('In progress', `${r.tasks.inProgress}`, AMBER);
  kv('Not started', `${r.tasks.notStarted}`, GRAY);
  kv('By task count', `${r.tasks.total ? Math.round((r.tasks.completed / r.tasks.total) * 100) : 0}%  (${r.tasks.completed}/${r.tasks.total})`);
  kv('By weighted value', `${r.tasks.weightedPct}%  (EVM roll-up — reflects budget/effort, not task count)`);
  if (r.tasks.remaining.length) {
    doc.moveDown(0.2).font('Helvetica-Bold').fillColor(GRAY).fontSize(9).text('Remaining / uncompleted work:');
    doc.moveDown(0.2);
    table(
      [
        { title: 'Task', w: 210 }, { title: 'Owner', w: 110 }, { title: 'Due', w: 70 },
        { title: '%', w: 35, align: 'right' }, { title: 'Flag', w: 70 },
      ],
      r.tasks.remaining.map((t) => [
        `${t.isMilestone ? '◆ ' : ''}${t.name}`, t.owner ?? '—', iso(t.planEnd), `${t.pct}%`, t.overdue ? 'OVERDUE' : '',
      ]),
    );
  } else {
    doc.text('All work packages complete.');
  }

  // ---------- 3. Earned Value (EVM) ----------
  heading('3. Earned Value (EVM)');
  table(
    [{ title: 'Metric', w: 240 }, { title: 'Value', w: 275, align: 'right' }],
    [
      ['Budget at Completion (BAC)', formatIdr(e.bac)],
      ['Planned Value (PV)', formatIdr(e.pv)],
      ['Earned Value (EV)', formatIdr(e.ev)],
      ['Actual Cost (AC)', formatIdr(e.ac)],
      ['Cost Performance Index (CPI)', e.ac > 0 ? e.cpi.toFixed(3) : '—'],
      ['Schedule Performance Index (SPI)', e.pv > 0 ? e.spi.toFixed(3) : '—'],
      ['% Complete (weighted)', `${r.tasks.weightedPct}%`],
    ],
  );

  // ---------- 4. Forecast ----------
  heading('4. Forecast (Estimate at Completion)');
  table(
    [{ title: 'Forecast', w: 240 }, { title: 'Value', w: 275, align: 'right' }],
    [
      ['EAC — optimistic (to plan)', formatIdr(f.eac.optimistic)],
      ['EAC — likely (BAC / CPI)', formatIdr(f.eac.likely)],
      ['EAC — pessimistic (cost+schedule drag)', formatIdr(f.eac.pessimistic)],
      ['Estimate to Complete (ETC)', formatIdr(f.etc)],
      ['Variance at Completion (VAC)', formatIdr(f.vac)],
      ['To-Complete Performance Index (TCPI)', f.bac > f.ac ? f.tcpi.toFixed(3) : '—'],
      ['Planned finish → Forecast finish', `${iso(f.schedule.plannedFinish)} → ${iso(f.schedule.forecastFinish)}`],
    ],
  );
  if (f.margin.revenue > 0) {
    kv('Contract revenue', formatIdr(f.margin.revenue));
    kv('Planned margin', formatIdr(f.margin.planned));
    kv('Projected margin (at likely EAC)', formatIdr(f.margin.projected), f.margin.projected < 0 ? RED : GREEN);
  }

  // ---------- 5. EVM S-curve (period) ----------
  if (f.sCurve.length) {
    heading(`5. EVM S-curve (${r.period === 'weekly' ? 'weekly' : 'monthly'})`);
    table(
      [
        { title: 'Date', w: 90 }, { title: 'Planned Value (PV)', w: 150, align: 'right' },
        { title: 'Actual Cost (AC)', w: 140, align: 'right' }, { title: 'Forecast', w: 135, align: 'right' },
      ],
      f.sCurve.map((p) => [iso(p.t), formatIdr(p.pv), p.ac != null ? formatIdr(p.ac) : '—', p.forecast != null ? formatIdr(p.forecast) : '—']),
    );
  }

  doc.fillColor(GRAY).fontSize(7.5).font('Helvetica').moveDown(0.5)
    .text('Generated by Prismatix. EVM figures use the project’s delivery methodology (WBS / agile points / hybrid). % complete (weighted) reflects budget & effort, which can differ from a simple task count.', { align: 'left' });

  doc.end();
  return done;
}
