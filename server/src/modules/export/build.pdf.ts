import PDFDocument from 'pdfkit';
import { formatIdr } from '../../calc/money.js';
import { categoryLabel, flattenGantt, type ProjectExport } from './export.data.js';

const num = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const ACCENT = '#e34f4a'; // brand coral (matches the app)
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
    doc.fillColor(ACCENT).fontSize(13).font('Helvetica-Bold').text(text);
    doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor(ACCENT).lineWidth(1).stroke();
    doc.moveDown(0.5).fillColor('#0f172a').font('Helvetica').fontSize(9);
  };

  const kv = (label: string, value: string) => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fillColor(GRAY).fontSize(9).text(label, left, y, { width: 140 });
    doc.font('Helvetica').fillColor('#0f172a').text(value, left + 150, y, { width: width - 150 });
    doc.moveDown(0.2);
  };

  // Simple column table. Column widths are auto-scaled down to fit the page
  // content width, so a table can never run off the right margin.
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
    rows.forEach((r) => drawRow(r, false));
    doc.moveDown(0.4);
  };

  // ---------- Header ----------
  doc.fillColor(ACCENT).fontSize(20).font('Helvetica-Bold').text('Prismatix');
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
  // Humanize the enum; append the free-text sub-category for OTHER lines.
  const typeText = (t: string, sub?: string | null) => {
    const base = t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return t === 'OTHER' && sub ? `${base} · ${sub}` : base;
  };
  table(
    [
      { title: 'Type', w: 110 }, { title: 'Item', w: 150 },
      { title: 'Detail', w: 140 }, { title: 'Amount', w: 115, align: 'right' },
    ],
    data.cost.directCosts.map((d) => [
      typeText(d.type, d.subCategory), d.label,
      d.type === 'MANPOWER' ? `${num(d.unitCostPerManday).toLocaleString('id-ID')}/md × ${num(d.planMandays)}` : `${num(d.qty)} × ${num(d.unitCost).toLocaleString('id-ID')}`,
      formatIdr(d.type === 'MANPOWER' ? num(d.manpowerCost) : num(d.amount)),
    ]),
  );
  if (data.cost.indirectCosts.length) {
    table(
      [{ title: 'Indirect Type', w: 150 }, { title: 'Description', w: 250 }, { title: 'Amount', w: 115, align: 'right' }],
      data.cost.indirectCosts.map((i) => [typeText(i.type, i.subCategory), i.description, formatIdr(num(i.amount))]),
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
      ['Budget at Completion / PMB (BAC)', formatIdr(num(b?.costBaseline))],
      ['Total Budget (BAC + Mgmt Reserve)', formatIdr(num(b?.budgetAtCompletion))],
    ],
  );

  // Budget vs actual, split by the budget the spend draws down (matches the Cost/Timesheet
  // "Sisa Direct/Indirect" cards). Direct actual = labour (from timesheets) + direct-category
  // AC; Indirect actual = indirect-category AC. Remaining = budget − actual (can go negative).
  const dBudget = num(b?.directTotal);
  const iBudget = num(b?.indirectTotal);
  const dActual = num(data.cost.directActual);
  const iActual = num(data.cost.indirectActual);
  table(
    [
      { title: 'Budget vs Actual', w: 131 }, { title: 'Budget', w: 128, align: 'right' },
      { title: 'Actual', w: 128, align: 'right' }, { title: 'Remaining', w: 128, align: 'right' },
    ],
    [
      ['Direct (labour + material)', formatIdr(dBudget), formatIdr(dActual), formatIdr(dBudget - dActual)],
      ['Indirect', formatIdr(iBudget), formatIdr(iActual), formatIdr(iBudget - iActual)],
      ['Total', formatIdr(dBudget + iBudget), formatIdr(dActual + iActual), formatIdr(dBudget + iBudget - dActual - iActual)],
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

  // ---------- Issue Log ----------
  heading('4. Issue Log');
  if (data.issues.length) {
    table(
      [
        { title: 'Code', w: 38 }, { title: 'Issue', w: 120 }, { title: 'Category', w: 60 },
        { title: 'Impact', w: 45 }, { title: 'Owner', w: 60 }, { title: 'Status', w: 55 },
        { title: 'Raised', w: 52 }, { title: 'Resolution', w: 120 },
      ],
      data.issues.map((is) => [
        is.code, is.title, is.category ?? '—', is.impact, is.owner?.name ?? '—',
        is.status.replace('_', ' '), iso(is.raisedAt), is.resolution ?? '—',
      ]),
    );
  } else {
    doc.text('No issues logged.');
  }

  // ---------- Schedule ----------
  heading('5. Schedule Management');
  table(
    [
      { title: 'WBS', w: 45 }, { title: 'Task', w: 155 }, { title: 'Plan Start', w: 65 },
      { title: 'Plan End', w: 65 }, { title: 'PIC', w: 65 }, { title: '%', w: 30, align: 'right' }, { title: 'Budget', w: 90, align: 'right' },
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

  // ---------- EVM Trend ----------
  if (data.evmSnapshots.length) {
    heading('6. EVM Trend (status history)');
    table(
      [
        { title: 'Status Date', w: 62 }, { title: '% Compl', w: 38, align: 'right' },
        { title: 'PV', w: 88, align: 'right' }, { title: 'EV', w: 88, align: 'right' },
        { title: 'AC', w: 88, align: 'right' }, { title: 'CPI', w: 35, align: 'right' },
        { title: 'SPI', w: 35, align: 'right' }, { title: 'Note', w: 81 },
      ],
      data.evmSnapshots.map((s) => [
        iso(s.statusDate),
        `${Math.round(s.weightedProgress * 100)}%`,
        formatIdr(s.pv), formatIdr(s.ev), formatIdr(s.ac),
        s.cpi ? s.cpi.toFixed(2) : '—',
        s.spi ? s.spi.toFixed(2) : '—',
        s.note ?? '',
      ]),
    );
  }

  doc.end();
  return done;
}
