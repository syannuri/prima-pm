import PDFDocument from 'pdfkit';
import { formatIdr } from '../../calc/money.js';
import { categoryLabel, flattenGantt, type ProjectExport } from './export.data.js';

const num = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const INDIGO = '#4F46E5';
const GRAY = '#64748b';

export function buildProjectPdf(data: ProjectExport): Promise<Buffer> {
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
    doc.fillColor(INDIGO).fontSize(13).font('Helvetica-Bold').text(text);
    doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor(INDIGO).lineWidth(1).stroke();
    doc.moveDown(0.5).fillColor('#0f172a').font('Helvetica').fontSize(9);
  };

  const kv = (label: string, value: string) => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fillColor(GRAY).fontSize(9).text(label, left, y, { width: 140 });
    doc.font('Helvetica').fillColor('#0f172a').text(value, left + 150, y, { width: width - 150 });
    doc.moveDown(0.2);
  };

  // Simple fixed-column table.
  const table = (cols: { title: string; w: number; align?: 'left' | 'right' }[], rows: (string | number)[][]) => {
    const colX: number[] = [];
    let x = left;
    for (const c of cols) { colX.push(x); x += c.w; }
    const drawRow = (cells: (string | number)[], bold: boolean, fill?: string) => {
      const rowH = 16;
      if (doc.y > doc.page.height - 60) doc.addPage();
      const y = doc.y;
      if (fill) doc.rect(left, y - 2, width, rowH).fill(fill);
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(bold && fill ? '#ffffff' : '#0f172a');
      cols.forEach((c, i) => {
        doc.text(String(cells[i] ?? ''), colX[i] + 2, y, { width: c.w - 4, align: c.align ?? 'left', lineBreak: false });
      });
      doc.y = y + rowH;
    };
    drawRow(cols.map((c) => c.title), true, INDIGO);
    rows.forEach((r) => drawRow(r, false));
    doc.moveDown(0.4);
  };

  // ---------- Header ----------
  doc.fillColor(INDIGO).fontSize(20).font('Helvetica-Bold').text('PRIMA-PM');
  doc.fillColor(GRAY).fontSize(9).font('Helvetica').text('Project Management Report');
  doc.moveDown(0.5);
  doc.fillColor('#0f172a').fontSize(15).font('Helvetica-Bold').text(`${data.project.code} — ${data.project.name}`);
  doc.fontSize(9).font('Helvetica').fillColor(GRAY)
    .text(`Client: ${data.project.clientName ?? '—'}   |   Status: ${data.project.status}   |   PM: ${data.project.pm?.name ?? '—'}   |   Generated: ${iso(data.generatedAt)}`);

  // ---------- Charter ----------
  heading('1. Project Charter');
  const c = data.charter;
  if (c) {
    kv('Category', categoryLabel(c.category));
    kv('Description', c.description);
    kv('Goals', c.goals);
    kv('Scope of Work', c.hiScope);
    kv('High-Level Cost', formatIdr(num(c.hiCostIdr)));
    kv('Schedule', `${iso(c.hiScheduleStart)} → ${iso(c.hiScheduleEnd)}`);
    kv('Deliverables', c.hiDeliverables);
    kv('Charter Status', c.locked ? `Committed (v${c.version})` : 'Draft');
  } else {
    doc.text('Charter not created yet.');
  }

  // ---------- Cost ----------
  heading('2. Cost Management');
  table(
    [
      { title: 'Type', w: 110 }, { title: 'Item', w: 150 },
      { title: 'Detail', w: 140 }, { title: 'Amount', w: 115, align: 'right' },
    ],
    data.cost.directCosts.map((d) => [
      d.type, d.label,
      d.type === 'MANPOWER' ? `${num(d.unitCostPerManday).toLocaleString('id-ID')}/md × ${num(d.planMandays)}` : `${num(d.qty)} × ${num(d.unitCost).toLocaleString('id-ID')}`,
      formatIdr(d.type === 'MANPOWER' ? num(d.manpowerCost) : num(d.amount)),
    ]),
  );
  if (data.cost.indirectCosts.length) {
    table(
      [{ title: 'Indirect Type', w: 150 }, { title: 'Description', w: 250 }, { title: 'Amount', w: 115, align: 'right' }],
      data.cost.indirectCosts.map((i) => [i.type, i.description, formatIdr(num(i.amount))]),
    );
  }
  const b = data.cost.baseline;
  table(
    [{ title: 'Baseline', w: 300 }, { title: 'Amount', w: 215, align: 'right' }],
    [
      ['Direct Total', formatIdr(num(b?.directTotal))],
      ['Indirect Total', formatIdr(num(b?.indirectTotal))],
      ['Contingency Reserve (from Risk)', formatIdr(num(b?.contingencyReserve))],
      ['Management Reserve', formatIdr(num(b?.managementReserve))],
      ['Cost Baseline', formatIdr(num(b?.costBaseline))],
      ['Budget at Completion (BAC)', formatIdr(num(b?.budgetAtCompletion))],
    ],
  );

  // ---------- Risk ----------
  heading('3. Risk Management');
  table(
    [
      { title: 'Code', w: 40 }, { title: 'Title', w: 150 }, { title: 'Kind', w: 60 },
      { title: 'P×I', w: 45 }, { title: 'Severity', w: 60 }, { title: 'EMV', w: 80, align: 'right' }, { title: 'Residual', w: 80, align: 'right' },
    ],
    data.risks.map((r) => [
      r.code, r.title, r.kind, `${r.probabilityScore}×${r.impactScore}`, r.severity,
      formatIdr(num(r.emv)), r.residualEmv ? formatIdr(num(r.residualEmv)) : '—',
    ]),
  );
  kv('Contingency Reserve', formatIdr(data.riskAnalysis.reserve.contingencyReserve));
  kv('Severity breakdown', Object.entries(data.riskAnalysis.bySeverity).map(([k, v]) => `${k}:${v}`).join('  '));

  // ---------- Schedule ----------
  heading('4. Schedule Management');
  table(
    [
      { title: 'WBS', w: 50 }, { title: 'Task', w: 180 }, { title: 'Plan Start', w: 70 },
      { title: 'Plan End', w: 70 }, { title: 'PIC', w: 80 }, { title: '%', w: 35, align: 'right' }, { title: 'Budget', w: 90, align: 'right' },
    ],
    flattenGantt(data.gantt.tree).map((t) => [
      t.wbsCode, `${'  '.repeat(t.depth)}${t.name}`, iso(t.planStart), iso(t.planEnd), t.pic, `${t.progressPct}%`, formatIdr(t.budgetCost),
    ]),
  );
  const e = data.evm;
  table(
    [{ title: 'EVM Metric', w: 200 }, { title: 'Value', w: 315, align: 'right' }],
    [
      ['Planned Value (PV)', formatIdr(e.pv)],
      ['Earned Value (EV)', formatIdr(e.ev)],
      ['Actual Cost (AC)', formatIdr(e.ac)],
      ['Cost Performance Index (CPI)', e.cpi.toFixed(3)],
      ['Schedule Performance Index (SPI)', e.spi.toFixed(3)],
      ['Estimate at Completion (EAC)', formatIdr(e.eac)],
      ['Project Health', e.health],
    ],
  );

  doc.end();
  return done;
}
